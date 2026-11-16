import { getDb } from './db.ts';
import type { Item } from '../shared/pack.ts';
import type { CardState, Stage } from '../shared/srs.ts';
import type { Track } from '../shared/cards.ts';

export interface CardRow {
  card_id: string;
  item_id: string;
  track: Track;
  variant: string;
  pack_id: string;
  unit: string;
  taught_on: string;
  ord: number;
  item: Item;
  state: CardState;
  last_review: number | null;
  introduced_day: number | null;
}

const itemCache = new Map<string, Item>();
export const parseItem = (json: string): Item => {
  let it = itemCache.get(json);
  if (!it) {
    it = JSON.parse(json) as Item;
    if (itemCache.size > 5000) itemCache.clear();
    itemCache.set(json, it);
  }
  return it;
};

const SELECT = `
SELECT c.id AS card_id, c.item_id, c.track, c.variant, i.pack_id, p.unit, p.taught_on, i.ord, i.json,
       s.ease, s.interval_days, s.reps, s.lapses, s.due, s.stage, s.step, s.streak, s.last_review, s.introduced_day
FROM cards c
JOIN items i ON i.id = c.item_id
JOIN packs p ON p.id = i.pack_id
JOIN card_state s ON s.card_id = c.id`;

function toRow(r: any): CardRow {
  return {
    card_id: r.card_id, item_id: r.item_id, track: r.track, variant: r.variant, pack_id: r.pack_id, unit: r.unit,
    taught_on: r.taught_on, ord: r.ord, item: parseItem(r.json),
    state: { ease: r.ease, interval_days: r.interval_days, reps: r.reps, lapses: r.lapses, due: r.due, stage: r.stage as Stage, step: r.step, streak: r.streak },
    last_review: r.last_review, introduced_day: r.introduced_day,
  };
}

/** All cards of active packs and non-retired items. */
export function loadActiveCards(): CardRow[] {
  return (getDb().prepare(`${SELECT} WHERE p.active=1 AND i.retired=0`).all() as any[]).map(toRow);
}

export function loadCard(cardId: string): CardRow | null {
  const r = getDb().prepare(`${SELECT} WHERE c.id=?`).get(cardId) as any;
  return r ? toRow(r) : null;
}
