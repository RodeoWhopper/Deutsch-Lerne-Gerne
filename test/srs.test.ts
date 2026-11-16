import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gradeFor, newState, schedule, type CardState } from '../src/shared/srs.ts';
import { dayStartMs, studyDay } from '../src/shared/time.ts';

const NOW = Date.UTC(2026, 10, 17, 12, 0, 0);
const rng = () => 0.5;

test('gün sınırı 04:00 Europe/Istanbul', () => {
  const before = Date.UTC(2026, 10, 17, 0, 59); // 03:59 TR -> still previous study day
  const after = Date.UTC(2026, 10, 17, 1, 1); // 04:01 TR
  assert.equal(studyDay(after), studyDay(before) + 1);
  assert.equal(dayStartMs(studyDay(after)), Date.UTC(2026, 10, 17, 1, 0));
});
test('yeni kart: good -> 10 dk -> good -> 1 gün', () => {
  let s = schedule(newState(NOW), 'good', NOW, rng);
  assert.equal(s.stage, 'learning'); assert.equal(s.due, NOW + 10 * 60_000);
  s = schedule(s, 'good', NOW + 600_000, rng);
  assert.equal(s.stage, 'review'); assert.equal(s.interval_days, 1);
  assert.ok(s.due > NOW + 3600_000 && s.due <= NOW + 2 * 86400_000);
});
test('yeni kart: again -> 1 dk', () => {
  const s = schedule(newState(NOW), 'again', NOW, rng);
  assert.equal(s.due, NOW + 60_000); assert.equal(s.step, 0);
});
test('mezuniyet: 1 gün, sonra 3 gün, sonra interval x ease', () => {
  let s: CardState = { ...newState(NOW), stage: 'review', interval_days: 1, reps: 1 };
  s = schedule(s, 'good', NOW, rng); assert.equal(s.interval_days, 3);
  s = schedule(s, 'good', NOW, rng); assert.equal(s.interval_days, Math.round(3 * 2.5));
});
test('review again: lapse, ease düşer (alt sınır 1.3), relearning', () => {
  let s: CardState = { ...newState(NOW), stage: 'review', interval_days: 10, reps: 3, ease: 1.35 };
  s = schedule(s, 'again', NOW, rng);
  assert.equal(s.lapses, 1); assert.equal(s.ease, 1.3); assert.equal(s.stage, 'relearning');
  assert.equal(s.due, NOW + 60_000);
  s = schedule(s, 'good', NOW + 60_000, rng);
  assert.equal(s.stage, 'review'); assert.ok(s.interval_days >= 1);
});
test('hard/easy ease değişimi', () => {
  const base = { ...newState(NOW), stage: 'review' as const, interval_days: 10, reps: 3 };
  assert.ok(schedule(base, 'hard', NOW, rng).ease < 2.5);
  assert.ok(schedule(base, 'easy', NOW, rng).ease > 2.5);
  assert.ok(schedule(base, 'easy', NOW, rng).interval_days > schedule(base, 'good', NOW, rng).interval_days);
});
test('±5% sapma sınırı', () => {
  const base = { ...newState(NOW), stage: 'review' as const, interval_days: 40, reps: 5 };
  for (const r of [0, 0.999]) {
    const iv = schedule(base, 'good', NOW, () => r).interval_days;
    assert.ok(iv >= 95 && iv <= 105, String(iv));
  }
});
test('not üretimi', () => {
  const b = { correct: true, hintUsed: false, caseOnly: false, ms: 5000, median: 5000, streak: 0 };
  assert.equal(gradeFor({ ...b, correct: false }), 'again');
  assert.equal(gradeFor(b), 'good');
  assert.equal(gradeFor({ ...b, hintUsed: true }), 'hard');
  assert.equal(gradeFor({ ...b, caseOnly: true }), 'hard');
  assert.equal(gradeFor({ ...b, ms: 13000 }), 'hard');
  assert.equal(gradeFor({ ...b, ms: 2500, streak: 3 }), 'easy');
  assert.equal(gradeFor({ ...b, ms: 2500, streak: 2 }), 'good');
});
