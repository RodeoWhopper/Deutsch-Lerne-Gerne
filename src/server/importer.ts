// Content pack import: dry-run, transactional apply, undo. (§7.4, §4.7)
import { createHash } from 'node:crypto';
import { getDb, tx } from './db.ts';
import { parsePack, type Item, type Pack } from '../shared/pack.ts';
import { answerSignature, cardId, cardsFor } from '../shared/cards.ts';
import { newState } from '../shared/srs.ts';

const canon = (v: unknown): string => JSON.stringify(v, (_k, val) =>
  val && typeof val === 'object' && !Array.isArray(val) ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => a.localeCompare(b))) : val);

export interface Plan {
  pack: Pack['pack'];
  sha256: string;
  add: string[];
  update: string[];
  unchanged: string[];
  restore: string[];
  retire: string[];
  answer_changed: string[];
  pack_is_new: boolean;
  new_cards: number;
}
export type Analysis = { ok: true; plan: Plan; items: Item[] } | { ok: false; errors: string[] };

export function analyze(raw: string): Analysis {
  const p = parsePack(raw);
  if (!p.ok) return { ok: false, errors: p.errors };
  const db = getDb();
  const pk = p.pack.pack;
  const errors: string[] = [];
  const existingPack = db.prepare('SELECT version FROM packs WHERE id=?').get(pk.id) as { version: number } | undefined;
  if (existingPack && pk.version <= existingPack.version) {
    errors.push(`pack.version (${pk.version}) mevcut sürümden (${existingPack.version}) büyük olmalı`);
  }
  const plan: Plan = {
    pack: pk, sha256: createHash('sha256').update(raw).digest('hex'),
    add: [], update: [], unchanged: [], restore: [], retire: [], answer_changed: [],
    pack_is_new: !existingPack, new_cards: 0,
  };
  const exist = db.prepare('SELECT id,pack_id,json,sig,retired FROM items WHERE id=?');
  const cardsOf = db.prepare('SELECT variant FROM cards WHERE item_id=?');
  for (const it of p.pack.items) {
    const e = exist.get(it.id) as { pack_id: string; json: string; sig: string; retired: number } | undefined;
    if (!e) {
      plan.add.push(it.id);
      plan.new_cards += cardsFor(it).length;
      continue;
    }
    if (e.pack_id !== pk.id) { errors.push(`${it.id}: başka pakette (${e.pack_id}) zaten var`); continue; }
    const same = canon(JSON.parse(e.json)) === canon(it);
    if (e.retired) { plan.restore.push(it.id); continue; }
    if (same) { plan.unchanged.push(it.id); continue; }
    plan.update.push(it.id);
    if (e.sig !== answerSignature(it)) plan.answer_changed.push(it.id);
    const have = new Set((cardsOf.all(it.id) as { variant: string }[]).map((r) => r.variant));
    plan.new_cards += cardsFor(it).filter((c) => !have.has(c.variant)).length;
  }
  const inPack = new Set(p.pack.items.map((i) => i.id));
  for (const id of p.retire) {
    if (inPack.has(id)) { errors.push(`${id}: hem items hem retire içinde`); continue; }
    const e = db.prepare('SELECT pack_id,retired FROM items WHERE id=?').get(id) as { pack_id: string; retired: number } | undefined;
    if (!e || e.pack_id !== pk.id) { errors.push(`${id}: retire edilecek item bu pakette yok`); continue; }
    if (!e.retired) plan.retire.push(id);
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, plan, items: p.pack.items };
}

export interface ApplyOpts { resetProgress: boolean }

export function apply(raw: string, opts: ApplyOpts, now = Date.now()) {
  const a = analyze(raw);
  if (!a.ok) return a;
  const { plan, items } = a;
  const db = getDb();
  const pk = plan.pack;
  const undo: any = { pack_prev: null, added_items: [], updated: [], retired: [], restored: [], cards_added: [], cards_removed: [], states_reset: [] };

  const result = tx(db, () => {
    undo.pack_prev = db.prepare('SELECT * FROM packs WHERE id=?').get(pk.id) ?? null;
    db.prepare(`INSERT INTO packs(id,title,version,level,taught_on,unit,active,created_at,updated_at) VALUES(?,?,?,?,?,?,0,?,?)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title,version=excluded.version,level=excluded.level,taught_on=excluded.taught_on,unit=excluded.unit,updated_at=excluded.updated_at`)
      .run(pk.id, pk.title, pk.version, pk.level, pk.taught_on, pk.unit, now, now);

    const insItem = db.prepare('INSERT INTO items(id,pack_id,kind,json,sig,ord,retired) VALUES(?,?,?,?,?,?,0)');
    const updItem = db.prepare('UPDATE items SET json=?,sig=?,ord=?,retired=0 WHERE id=?');
    const getItem = db.prepare('SELECT json,sig,retired,ord FROM items WHERE id=?');
    const insCard = db.prepare('INSERT OR IGNORE INTO cards(id,item_id,track,variant) VALUES(?,?,?,?)');
    const insState = db.prepare('INSERT OR IGNORE INTO card_state(card_id,ease,interval_days,reps,lapses,due,stage,step,streak) VALUES(?,?,?,?,?,?,?,?,?)');
    const cardsOf = db.prepare('SELECT id,track,variant FROM cards WHERE item_id=?');
    const stateOf = db.prepare('SELECT * FROM card_state WHERE card_id=?');
    const delState = db.prepare('DELETE FROM card_state WHERE card_id=?');
    const delCard = db.prepare('DELETE FROM cards WHERE id=?');
    const ns = newState(now);
    const setState = db.prepare('UPDATE card_state SET ease=?,interval_days=?,reps=?,lapses=?,due=?,stage=?,step=?,streak=?,last_review=NULL,introduced_day=NULL WHERE card_id=?');

    const toAdd = new Set(plan.add), toUpd = new Set(plan.update), toRestore = new Set(plan.restore);
    items.forEach((it, idx) => {
      const json = JSON.stringify(it);
      const sig = answerSignature(it);
      const prev = getItem.get(it.id) as { json: string; sig: string; retired: number; ord: number } | undefined;
      if (toAdd.has(it.id)) { insItem.run(it.id, pk.id, it.kind, json, sig, idx); undo.added_items.push(it.id); }
      else if (toUpd.has(it.id) || toRestore.has(it.id)) {
        undo.updated.push({ id: it.id, prev });
        if (toRestore.has(it.id)) undo.restored.push(it.id);
        updItem.run(json, sig, idx, it.id);
      } else return; // unchanged
      // sync cards
      const want = cardsFor(it);
      const have = cardsOf.all(it.id) as { id: string; track: string; variant: string }[];
      for (const c of want) {
        const id = cardId(it.id, c.variant);
        if (!have.some((h) => h.id === id)) {
          insCard.run(id, it.id, c.track, c.variant);
          insState.run(id, ns.ease, ns.interval_days, ns.reps, ns.lapses, ns.due, ns.stage, ns.step, ns.streak);
          undo.cards_added.push(id);
        }
      }
      for (const h of have) {
        if (!want.some((w) => cardId(it.id, w.variant) === h.id)) {
          undo.cards_removed.push({ card: h, item_id: it.id, state: stateOf.get(h.id) ?? null });
          delState.run(h.id); delCard.run(h.id);
        }
      }
      if (opts.resetProgress && plan.answer_changed.includes(it.id)) {
        for (const c of want) {
          const id = cardId(it.id, c.variant);
          const st = stateOf.get(id);
          if (st && !undo.cards_added.includes(id)) {
            undo.states_reset.push(st);
            setState.run(ns.ease, 0, 0, 0, ns.due, 'new', 0, 0, id);
          }
        }
      }
    });
    for (const id of plan.retire) {
      db.prepare('UPDATE items SET retired=1 WHERE id=?').run(id);
      undo.retired.push(id);
    }
    const r = db.prepare('INSERT INTO import_log(at,pack_id,version,sha256,added,updated,unchanged,retired,reset,undo_json) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(now, pk.id, pk.version, plan.sha256, plan.add.length, plan.update.length + plan.restore.length, plan.unchanged.length, plan.retire.length, undo.states_reset.length, JSON.stringify(undo));
    return Number(r.lastInsertRowid);
  });
  return { ok: true as const, plan, import_id: result };
}

/** Undo only the most recent not-yet-undone import (stack discipline keeps state consistent). */
export function undoImport(importId: number, now = Date.now()): { ok: boolean; error?: string } {
  const db = getDb();
  const last = db.prepare('SELECT id FROM import_log WHERE undone_at IS NULL ORDER BY id DESC LIMIT 1').get() as { id: number } | undefined;
  if (!last || last.id !== importId) return { ok: false, error: 'Yalnızca en son içe aktarma geri alınabilir' };
  const row = db.prepare('SELECT pack_id,undo_json FROM import_log WHERE id=?').get(importId) as { pack_id: string; undo_json: string };
  const u = JSON.parse(row.undo_json);
  tx(db, () => {
    for (const id of u.cards_added) { db.prepare('DELETE FROM reviews WHERE card_id=?').run(id); db.prepare('DELETE FROM card_state WHERE card_id=?').run(id); db.prepare('DELETE FROM cards WHERE id=?').run(id); }
    for (const r of u.cards_removed) {
      db.prepare('INSERT OR IGNORE INTO cards(id,item_id,track,variant) VALUES(?,?,?,?)').run(r.card.id, r.item_id, r.card.track, r.card.variant);
      if (r.state) {
        const s = r.state;
        db.prepare('INSERT OR REPLACE INTO card_state(card_id,ease,interval_days,reps,lapses,due,stage,step,streak,last_review,introduced_day) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
          .run(s.card_id, s.ease, s.interval_days, s.reps, s.lapses, s.due, s.stage, s.step, s.streak, s.last_review, s.introduced_day);
      }
    }
    for (const s of u.states_reset) {
      db.prepare('UPDATE card_state SET ease=?,interval_days=?,reps=?,lapses=?,due=?,stage=?,step=?,streak=?,last_review=?,introduced_day=? WHERE card_id=?')
        .run(s.ease, s.interval_days, s.reps, s.lapses, s.due, s.stage, s.step, s.streak, s.last_review, s.introduced_day, s.card_id);
    }
    for (const id of u.retired) db.prepare('UPDATE items SET retired=0 WHERE id=?').run(id);
    for (const upd of u.updated) {
      const p = upd.prev;
      db.prepare('UPDATE items SET json=?,sig=?,retired=?,ord=? WHERE id=?').run(p.json, p.sig, p.retired, p.ord, upd.id);
    }
    for (const id of u.added_items) db.prepare('DELETE FROM items WHERE id=?').run(id);
    if (u.pack_prev) {
      const p = u.pack_prev;
      db.prepare('UPDATE packs SET title=?,version=?,level=?,taught_on=?,unit=?,active=?,updated_at=? WHERE id=?').run(p.title, p.version, p.level, p.taught_on, p.unit, p.active, p.updated_at, p.id);
    } else {
      db.prepare('DELETE FROM packs WHERE id=?').run(row.pack_id);
    }
    db.prepare('UPDATE import_log SET undone_at=? WHERE id=?').run(now, importId);
  });
  return { ok: true };
}
