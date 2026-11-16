// Study engine: queue building (§5, §6) and answer processing.
import { getDb, tx } from './db.ts';
import { loadActiveCards, loadCard, type CardRow } from './store.ts';
import { buildQuestion, evaluate, TRACKS, type BuildCtx, type Question, type Track } from '../shared/cards.ts';
import { gradeFor, schedule, LEECH_LAPSES, type Grade } from '../shared/srs.ts';
import { studyDay } from '../shared/time.ts';
import type { Item } from '../shared/pack.ts';
import { getSettings } from './settings.ts';

export type Mode = 'daily' | 'sprint' | 'topic' | 'errors' | 'mini';
const DAY = 86_400_000;
const DEFAULT_MEDIAN: Record<string, number> = { artikel: 5000, choice: 8000, type: 15000, selfcheck: 12000 };

// ---------- helpers ----------
export function medians(): Record<string, number> {
  const rows = getDb().prepare('SELECT qk, ms FROM reviews WHERE correct=1 AND hint=0 ORDER BY id DESC LIMIT 600').all() as { qk: string; ms: number }[];
  const by: Record<string, number[]> = {};
  for (const r of rows) (by[r.qk] ??= []).push(r.ms);
  const out = { ...DEFAULT_MEDIAN };
  for (const [k, v] of Object.entries(by)) {
    if (v.length >= 8) { v.sort((a, b) => a - b); out[k] = Math.max(1500, v[Math.floor(v.length / 2)]); }
  }
  return out;
}

const qkOf = (q: Question) => (q.track === 'artikel' ? 'artikel' : q.kind);

function makeCtx(row: CardRow, all: CardRow[], rng: () => number): BuildCtx {
  return {
    stage: row.state.stage, interval_days: row.state.interval_days, unit: row.unit, rng,
    distractors: (item: Item, n: number) => {
      const tr = (item as { tr?: string[] }).tr ?? [];
      const mine = new Set(tr.map((t) => t.toLowerCase()));
      const pick = (pred: (r: CardRow) => boolean) => {
        const seen = new Set<string>();
        const out: string[] = [];
        for (const r of all) {
          const it = r.item as { tr?: string[]; id: string; kind: string };
          if (it.id === item.id || !it.tr?.length || r.variant !== 'detr' || !pred(r)) continue;
          const t = it.tr[0];
          if (mine.has(t.toLowerCase()) || seen.has(t.toLowerCase())) continue;
          if (it.tr.some((x) => mine.has(x.toLowerCase()))) continue;
          seen.add(t.toLowerCase());
          out.push(t);
        }
        return out;
      };
      let pool = pick((r) => r.item.kind === item.kind && r.unit === row.unit);
      if (pool.length < n) pool = pool.concat(pick((r) => r.item.kind === item.kind && r.unit !== row.unit));
      if (pool.length < n) pool = pool.concat(pick((r) => r.item.kind !== item.kind));
      pool = [...new Set(pool)];
      for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
      return pool.slice(0, n);
    },
  };
}

/** Arrange: siblings (same item) as far apart as possible (target gap), max same-track run. */
export function arrange(cards: CardRow[], opts: { siblingGap: number; maxRun: number }): CardRow[] {
  const pool = cards.slice();
  const out: CardRow[] = [];
  const dist = (c: CardRow) => {
    for (let k = 1; k <= opts.siblingGap && k <= out.length; k++) if (out[out.length - k].item_id === c.item_id) return k;
    return opts.siblingGap + 1;
  };
  while (pool.length) {
    const last = out.slice(-opts.maxRun);
    const runFull = opts.maxRun > 0 && last.length === opts.maxRun && last.every((c) => c.track === last[0].track);
    let best = -1, bestD = -1;
    for (let i = 0; i < pool.length; i++) {
      if (runFull && pool[i].track === last[0].track) continue;
      const d = dist(pool[i]);
      if (d > bestD) { best = i; bestD = d; if (d > opts.siblingGap) break; }
    }
    if (best < 0) best = 0; // only same-track cards left: relax the run rule
    out.push(pool.splice(best, 1)[0]);
  }
  return out;
}

const shuffled = <T,>(a: T[], rng: () => number) => {
  const r = a.slice();
  for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; }
  return r;
};

export function errorCardIds(now: number): Set<string> {
  const rows = getDb().prepare("SELECT DISTINCT card_id FROM reviews WHERE grade='again' AND at > ?").all(now - 14 * DAY) as { card_id: string }[];
  return new Set(rows.map((r) => r.card_id));
}

const isDue = (c: CardRow, now: number) => c.state.stage !== 'new' && c.state.due <= now;
const newOrder = (a: CardRow, b: CardRow) =>
  a.taught_on.localeCompare(b.taught_on) || a.pack_id.localeCompare(b.pack_id) || a.ord - b.ord || a.card_id.localeCompare(b.card_id);

export function introducedToday(now: number): number {
  return (getDb().prepare('SELECT COUNT(*) n FROM card_state WHERE introduced_day=?').get(studyDay(now)) as { n: number }).n;
}

export interface QueueOpts { mode: Mode; track?: Track; unit?: string; minutes?: number }
export interface QueueResult { questions: Question[]; meta: { mode: Mode; budget_s?: number; est_s: number; total_due: number; counts: Record<string, number> } }

export function buildQueue(opts: QueueOpts, now = Date.now(), rng: () => number = Math.random): QueueResult {
  const all = loadActiveCards();
  const settings = getSettings();
  const med = medians();
  const errs = errorCardIds(now);
  const newLeft = Math.max(0, settings.daily_new - introducedToday(now));
  const totalDue = all.filter((c) => isDue(c, now)).length;
  const estOf = (c: CardRow) => {
    const q = buildQuestion(c.item, c.variant, makeCtx(c, all, () => 0.5));
    return (med[qkOf(q)] ?? 10000) / 1000 + 2;
  };
  const counts: Record<string, number> = {};
  let picked: CardRow[] = [];
  let budget: number | undefined;

  const dueSorted = (list: CardRow[]) =>
    list.filter((c) => isDue(c, now)).sort((a, b) => {
      const ra = (now - a.state.due) / DAY / Math.max(1, a.state.interval_days);
      const rb = (now - b.state.due) / DAY / Math.max(1, b.state.interval_days);
      return rb - ra;
    });
  const errList = () => all.filter((c) => c.state.stage !== 'new' && (errs.has(c.card_id) || c.state.lapses >= LEECH_LAPSES))
    .sort((a, b) => b.state.lapses - a.state.lapses);

  if (opts.mode === 'daily') {
    const due = dueSorted(all).slice(0, 300);
    const fresh = all.filter((c) => c.state.stage === 'new').sort(newOrder).slice(0, newLeft);
    counts.due = due.length; counts.new = fresh.length;
    picked = arrange([...due, ...fresh], { siblingGap: 5, maxRun: 0 });
  } else if (opts.mode === 'mini') {
    const e = errList().filter((c) => isDue(c, now));
    const due = dueSorted(all);
    const fresh = all.filter((c) => c.state.stage === 'new').sort(newOrder).slice(0, newLeft);
    const seen = new Set<string>();
    for (const c of [...e, ...due, ...fresh]) { if (picked.length >= 10) break; if (!seen.has(c.card_id)) { seen.add(c.card_id); picked.push(c); } }
    picked = arrange(picked, { siblingGap: 5, maxRun: 0 });
  } else if (opts.mode === 'topic') {
    const scope = all.filter((c) => (!opts.track || c.track === opts.track) && (!opts.unit || c.unit === opts.unit));
    const due = dueSorted(scope);
    const fresh = scope.filter((c) => c.state.stage === 'new').sort(newOrder).slice(0, 10);
    picked = [...due, ...fresh];
    if (picked.length === 0) {
      picked = scope.filter((c) => c.state.stage !== 'new').sort((a, b) => a.state.ease - b.state.ease || a.state.due - b.state.due).slice(0, 15);
    }
    counts.due = due.length; counts.new = fresh.length;
    picked = arrange(picked, { siblingGap: 5, maxRun: 0 });
  } else if (opts.mode === 'errors') {
    picked = errList().slice(0, 60);
    picked = arrange(picked, { siblingGap: 5, maxRun: 0 });
  } else {
    // sprint (§6)
    const minutes = opts.minutes ?? settings.sprint_minutes;
    budget = minutes * 60;
    const chosen = new Map<string, CardRow>();
    let spent = 0;
    const add = (c: CardRow, cap: number) => {
      if (chosen.has(c.card_id)) return false;
      const e = estOf(c);
      if (spent + e > cap) return false;
      chosen.set(c.card_id, c); spent += e; return true;
    };
    for (const c of dueSorted(all)) if (!add(c, budget * 0.6)) break;
    counts.due = chosen.size;
    let n0 = chosen.size;
    for (const c of errList()) if (!add(c, budget * 0.8)) break;
    counts.errors = chosen.size - n0;
    // coverage guarantee: >=2 per track that has introduced (non-new) cards
    n0 = chosen.size;
    for (const t of TRACKS) {
      const have = [...chosen.values()].filter((c) => c.track === t).length;
      if (have >= 2) continue;
      const cand = all.filter((c) => c.track === t && c.state.stage !== 'new' && !chosen.has(c.card_id))
        .sort((a, b) => a.state.ease - b.state.ease || a.state.due - b.state.due);
      for (const c of cand.slice(0, 2 - have)) add(c, budget * 1.05);
    }
    counts.coverage = chosen.size - n0;
    if (settings.sprint_new && newLeft > 0) {
      // optional new cards: at most ~25% of the time budget, never beyond the daily limit
      n0 = chosen.size;
      let newSpent = 0;
      for (const c of all.filter((c) => c.state.stage === 'new').sort(newOrder).slice(0, newLeft)) {
        const e = estOf(c);
        if (newSpent + e > budget * 0.25) break;
        chosen.set(c.card_id, c); newSpent += e; spent += e;
      }
      counts.new = chosen.size - n0;
    }
    n0 = chosen.size;
    const weak = all.filter((c) => c.state.stage !== 'new' && !chosen.has(c.card_id))
      .sort((a, b) => a.state.ease - b.state.ease || a.state.interval_days - b.state.interval_days || a.state.due - b.state.due);
    for (const c of weak) { if (spent >= budget) break; add(c, budget); }
    counts.fill = chosen.size - n0;
    picked = arrange(shuffled([...chosen.values()], rng), { siblingGap: 5, maxRun: 3 });
  }

  const questions: Question[] = [];
  let est = 0;
  for (const c of picked) {
    try {
      const q = buildQuestion(c.item, c.variant, makeCtx(c, all, rng));
      est += (med[qkOf(q)] ?? 10000) / 1000 + 2;
      questions.push(q);
    } catch { /* skip malformed */ }
  }
  return { questions, meta: { mode: opts.mode, budget_s: budget, est_s: Math.round(est), total_due: totalDue, counts } };
}

// ---------- answering ----------
export interface AnswerInput { card_id: string; answer: string; ms: number; hint: boolean; mode: Mode }

export function answer(inp: AnswerInput, now = Date.now(), rng: () => number = Math.random) {
  const row = loadCard(inp.card_id);
  if (!row) throw new Error('not_found');
  const ev = evaluate(row.item, row.variant, inp.answer);
  const q = buildQuestion(row.item, row.variant, { stage: row.state.stage, interval_days: row.state.interval_days, unit: row.unit, rng: () => 0.5, distractors: () => [] });
  const qk = qkOf(q);
  const med = medians()[qk] ?? 10000;
  const ms = Math.max(0, Math.min(600_000, Math.round(inp.ms)));
  const grade: Grade = gradeFor({ correct: ev.correct, hintUsed: inp.hint, caseOnly: ev.caseOnly, ms, median: med, streak: row.state.streak });
  const wasDue = row.state.stage === 'new' || row.state.due <= now;
  const db = getDb();
  const early = row.state.stage === 'review' && !wasDue && grade !== 'again';
  const next = early ? { ...row.state, streak: row.state.streak + 1 } : schedule(row.state, grade, now, rng);
  tx(db, () => {
    db.prepare(`UPDATE card_state SET ease=?,interval_days=?,reps=?,lapses=?,due=?,stage=?,step=?,streak=?,last_review=?,
      introduced_day=COALESCE(introduced_day, ?) WHERE card_id=?`)
      .run(next.ease, next.interval_days, next.reps, next.lapses, next.due, next.stage, next.step, next.streak, now, row.state.stage === 'new' ? studyDay(now) : null, row.card_id);
    db.prepare('INSERT INTO reviews(card_id,at,grade,correct,ms,mode,track,qk,hint,was_due) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(row.card_id, now, grade, ev.correct ? 1 : 0, ms, inp.mode, row.track, qk, inp.hint ? 1 : 0, wasDue ? 1 : 0);
  });
  const learning = next.stage === 'learning' || next.stage === 'relearning';
  return {
    correct: ev.correct,
    partial: ev.correct && (ev.caseOnly || ev.notes.length > 0),
    grade,
    expected: ev.expected,
    user_line: ev.userLine,
    expected_line: ev.expectedLine,
    notes: ev.notes,
    reveal: ev.reveal,
    leech: next.lapses >= LEECH_LAPSES,
    next: { stage: next.stage, interval_days: next.interval_days, due: next.due },
    requeue_ms: learning ? Math.max(0, next.due - now) : null,
  };
}
