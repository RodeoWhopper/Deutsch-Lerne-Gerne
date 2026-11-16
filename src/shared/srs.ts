// SM-2 derivative. Pure functions, deterministic given rng.
import { dayStartMs, studyDay } from './time.ts';

export type Stage = 'new' | 'learning' | 'review' | 'relearning';
export type Grade = 'again' | 'hard' | 'good' | 'easy';

export interface CardState {
  ease: number;
  interval_days: number;
  reps: number;
  lapses: number;
  due: number; // epoch ms (UTC)
  stage: Stage;
  step: number;
  streak: number; // consecutive non-again answers
}

export const LEARN_STEPS_MIN = [1, 10];
export const MIN_EASE = 1.3;
export const LEECH_LAPSES = 8;

export const newState = (now = 0): CardState => ({
  ease: 2.5, interval_days: 0, reps: 0, lapses: 0, due: now, stage: 'new', step: 0, streak: 0,
});

const jitter = (days: number, rng: () => number) =>
  days >= 5 ? Math.max(1, Math.round(days * (0.95 + rng() * 0.1))) : days;

const dueInDays = (now: number, days: number) => dayStartMs(studyDay(now) + days);

export function schedule(s: CardState, grade: Grade, now: number, rng: () => number = Math.random): CardState {
  const n: CardState = { ...s };
  n.streak = grade === 'again' ? 0 : s.streak + 1;
  const steps = LEARN_STEPS_MIN;
  const graduate = (days: number) => {
    n.stage = 'review';
    n.step = 0;
    n.interval_days = days;
    n.due = dueInDays(now, days);
  };

  if (s.stage === 'new' || s.stage === 'learning') {
    const cur = s.stage === 'new' ? 0 : s.step;
    n.stage = 'learning';
    if (grade === 'again') { n.step = 0; n.due = now + steps[0] * 60_000; }
    else if (grade === 'hard') { n.step = cur; n.due = now + steps[cur] * 60_000; }
    else if (grade === 'good') {
      if (cur + 1 < steps.length) { n.step = cur + 1; n.due = now + steps[cur + 1] * 60_000; }
      else { n.reps = s.reps + 1; graduate(1); }
    } else { n.reps = s.reps + 1; graduate(3); }
    return n;
  }

  if (s.stage === 'relearning') {
    if (grade === 'again' || grade === 'hard') { n.step = 0; n.due = now + steps[0] * 60_000; return n; }
    n.stage = 'review';
    n.step = 0;
    n.due = dueInDays(now, Math.max(1, s.interval_days));
    return n;
  }

  // review
  if (grade === 'again') {
    n.lapses = s.lapses + 1;
    n.ease = Math.max(MIN_EASE, s.ease - 0.2);
    n.stage = 'relearning';
    n.step = 0;
    n.interval_days = Math.max(1, Math.round(s.interval_days * 0.5));
    n.due = now + steps[0] * 60_000;
    return n;
  }
  n.reps = s.reps + 1;
  let iv: number;
  if (grade === 'hard') {
    n.ease = Math.max(MIN_EASE, s.ease - 0.15);
    iv = Math.max(s.interval_days + 1, Math.round(s.interval_days * 1.2));
  } else if (grade === 'good') {
    iv = s.interval_days <= 1 ? 3 : Math.round(s.interval_days * s.ease);
  } else {
    n.ease = s.ease + 0.15;
    iv = Math.max(s.interval_days + 2, Math.round(s.interval_days * s.ease * 1.3));
  }
  iv = Math.max(s.interval_days + 1, jitter(iv, rng));
  n.interval_days = iv;
  n.due = dueInDays(now, iv);
  return n;
}

export interface GradeInput {
  correct: boolean;
  hintUsed: boolean;
  caseOnly: boolean;
  ms: number;
  median: number; // personal median ms for this question kind
  streak: number; // consecutive correct before this answer
}

export function gradeFor(i: GradeInput): Grade {
  if (!i.correct) return 'again';
  if (i.hintUsed || i.caseOnly || i.ms > 2.5 * i.median) return 'hard';
  if (i.ms < 0.6 * i.median && i.streak >= 3) return 'easy';
  return 'good';
}
