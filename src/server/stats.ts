import { getDb } from './db.ts';
import { loadActiveCards } from './store.ts';
import { TRACKS, deDisplay } from '../shared/cards.ts';
import { dayLabel, dayStartMs, studyDay } from '../shared/time.ts';
import { LEECH_LAPSES } from '../shared/srs.ts';
import { errorCardIds, introducedToday } from './engine.ts';
import { getSettings } from './settings.ts';

const strength = (interval: number, stage: string) => (stage === 'new' ? 0 : Math.min(1, interval / 21));

export function home(now = Date.now()) {
  const cards = loadActiveCards();
  const s = getSettings();
  const due = cards.filter((c) => c.state.stage !== 'new' && c.state.due <= now);
  const byTrack: Record<string, { cards: number; due: number; strength: number; new: number }> = {};
  for (const t of TRACKS) byTrack[t] = { cards: 0, due: 0, strength: 0, new: 0 };
  const units: Record<string, { unit: string; cards: number; due: number; strength: number; title: string }> = {};
  const packTitles = new Map((getDb().prepare('SELECT unit,title FROM packs WHERE active=1').all() as { unit: string; title: string }[]).map((p) => [p.unit, p.title]));
  for (const c of cards) {
    const t = byTrack[c.track];
    t.cards++; t.strength += strength(c.state.interval_days, c.state.stage);
    if (c.state.stage === 'new') t.new++;
    const u = (units[c.unit] ??= { unit: c.unit, cards: 0, due: 0, strength: 0, title: packTitles.get(c.unit) ?? c.unit });
    u.cards++; u.strength += strength(c.state.interval_days, c.state.stage);
  }
  for (const c of due) { byTrack[c.track].due++; units[c.unit].due++; }
  for (const t of Object.values(byTrack)) t.strength = t.cards ? t.strength / t.cards : 0;
  for (const u of Object.values(units)) u.strength = u.cards ? u.strength / u.cards : 0;
  const today = studyDay(now);
  const days = getDb().prepare('SELECT at FROM reviews WHERE at >= ?').all(dayStartMs(today - 6)) as { at: number }[];
  const last7 = Array.from({ length: 7 }, (_, i) => days.filter((r) => studyDay(r.at) === today - 6 + i).length);
  const last = getDb().prepare('SELECT MAX(at) a FROM reviews').get() as { a: number | null };
  return {
    due: due.length,
    new_available: Math.max(0, s.daily_new - introducedToday(now)),
    new_cards: cards.filter((c) => c.state.stage === 'new').length,
    active_packs: (getDb().prepare('SELECT COUNT(*) n FROM packs WHERE active=1').get() as { n: number }).n,
    total_packs: (getDb().prepare('SELECT COUNT(*) n FROM packs').get() as { n: number }).n,
    errors: errorCardIds(now).size,
    tracks: byTrack,
    units: Object.values(units).sort((a, b) => a.unit.localeCompare(b.unit)),
    last7,
    last_review: last.a,
    sprint_minutes: s.sprint_minutes,
  };
}

export function stats(now = Date.now()) {
  const db = getDb();
  const today = studyDay(now);
  const since = now - 30 * 86_400_000;
  const acc = db.prepare('SELECT track, COUNT(*) n, SUM(correct) ok FROM reviews WHERE at>=? GROUP BY track').all(since) as { track: string; n: number; ok: number }[];
  const rows = db.prepare('SELECT at, ms FROM reviews WHERE at>=?').all(dayStartMs(today - 13)) as { at: number; ms: number }[];
  const minutes = Array.from({ length: 14 }, (_, i) => {
    const d = today - 13 + i;
    const ms = rows.filter((r) => studyDay(r.at) === d).reduce((a, r) => a + Math.min(r.ms, 60_000) + 1500, 0);
    return { day: dayLabel(d), min: Math.round(ms / 6000) / 10 };
  });
  const cards = loadActiveCards();
  const forecast = Array.from({ length: 7 }, (_, i) => {
    const lo = i === 0 ? 0 : dayStartMs(today + i), hi = dayStartMs(today + i + 1);
    return { day: dayLabel(today + i), n: cards.filter((c) => c.state.stage !== 'new' && c.state.due >= lo && c.state.due < hi).length };
  });
  return {
    accuracy: acc.map((a) => ({ track: a.track, n: a.n, ok: a.ok })),
    minutes,
    forecast,
    reviews_total: (db.prepare('SELECT COUNT(*) n FROM reviews').get() as { n: number }).n,
  };
}

export function tomorrowCount(now = Date.now()) {
  const today = studyDay(now);
  const hi = dayStartMs(today + 2);
  return loadActiveCards().filter((c) => c.state.stage !== 'new' && c.state.due < hi).length;
}

export function errorsView(now = Date.now()) {
  const errs = errorCardIds(now);
  const cards = loadActiveCards();
  const lastWrong = new Map((getDb().prepare("SELECT card_id, MAX(at) at FROM reviews WHERE grade='again' GROUP BY card_id").all() as { card_id: string; at: number }[]).map((r) => [r.card_id, r.at]));
  const view = (c: (typeof cards)[number]) => {
    const it = c.item as any;
    return {
      card_id: c.card_id, track: c.track, unit: c.unit, lapses: c.state.lapses,
      de: it.kind === 'grammar' ? (it.prompt ?? it.text) : deDisplay(c.item),
      tr: it.tr ?? null, answer: it.answer ?? null, last_wrong: lastWrong.get(c.card_id) ?? null, kind: it.kind, variant: c.variant,
    };
  };
  const leeches = cards.filter((c) => c.state.lapses >= LEECH_LAPSES).sort((a, b) => b.state.lapses - a.state.lapses).map(view);
  const recent = cards.filter((c) => errs.has(c.card_id) && c.state.lapses < LEECH_LAPSES).sort((a, b) => (lastWrong.get(b.card_id) ?? 0) - (lastWrong.get(a.card_id) ?? 0)).map(view);
  return { leeches, recent };
}

export function leechExport(now = Date.now()) {
  const { leeches } = errorsView(now);
  const lines = ['# Sülükler (çok yanlış yapılan kartlar): bunlar için yeni örnek cümle ve anımsatıcı öner', ''];
  for (const l of leeches) lines.push(`- [${l.track}] ${l.de}${l.tr ? ' = ' + l.tr.join(' / ') : ''}${l.answer ? ' -> ' + l.answer : ''} (yanlış: ${l.lapses}x)`);
  if (!leeches.length) lines.push('(sülük yok)');
  return lines.join('\n');
}
