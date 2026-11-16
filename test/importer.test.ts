import './env.ts';
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, setDb, getDb } from '../src/server/db.ts';
import { analyze, apply, undoImport } from '../src/server/importer.ts';
import { answer } from '../src/server/engine.ts';

const mk = (version: number, items: unknown[], retire: string[] = []) =>
  JSON.stringify({ standard: 'deutsch-pack/1', pack: { id: 'test-pack', title: 'T', version, level: 'A1', taught_on: '2026-11-01', unit: 'tst' }, items, retire });
const noun = (id: string, de: string, article: string, tr: string[]) => ({ id, kind: 'noun', de, article, tr });
const state = (id: string) => getDb().prepare('SELECT * FROM card_state WHERE card_id=?').get(id) as any;

before(() => { setDb(openDb(':memory:')); });

test('v1: ekle', () => {
  const r = apply(mk(1, [noun('n.aaa', 'Aaa', 'der', ['a']), noun('n.bbb', 'Bbb', 'die', ['b']), noun('n.ccc', 'Ccc', 'das', ['c'])]), { resetProgress: false });
  assert.ok(r.ok);
  assert.equal((getDb().prepare('SELECT COUNT(*) n FROM cards').get() as any).n, 9);
  assert.equal((getDb().prepare('SELECT active FROM packs').get() as any).active, 0); // yeni paket pasif
  getDb().prepare('UPDATE packs SET active=1').run();
  answer({ card_id: 'n.aaa#trde', answer: 'der Aaa', ms: 3000, hint: false, mode: 'daily' });
  assert.equal(state('n.aaa#trde').stage, 'learning');
});

test('v2 dry-run: güncelle (SRS korunur), cevabı etkileyen değişiklik işaretlenir, retire', () => {
  const v2 = mk(2, [noun('n.aaa', 'Aaa', 'die', ['a', 'a2']), noun('n.bbb', 'Bbb', 'die', ['b', 'b2']), noun('n.ccc', 'Ccc', 'das', ['c'])], []);
  const a = analyze(v2);
  assert.ok(a.ok);
  if (a.ok) {
    assert.deepEqual(a.plan.update.sort(), ['n.aaa', 'n.bbb']);
    assert.deepEqual(a.plan.unchanged, ['n.ccc']);
    assert.deepEqual(a.plan.answer_changed, ['n.aaa']); // article değişti; yalnızca tr eklenen bbb değil
  }
  // dry-run yazmadı
  assert.equal(JSON.parse((getDb().prepare("SELECT json FROM items WHERE id='n.aaa'").get() as any).json).article, 'der');
  assert.equal(analyze(mk(1, [])).ok, false); // aynı sürüm reddedilir
  assert.equal(analyze(mk(2, [], ['n.zzz'])).ok, false); // olmayan item retire edilemez
  assert.equal(analyze(mk(2, [noun('n.aaa', 'Aaa', 'der', ['a'])], ['n.aaa'])).ok, false); // hem items hem retire
});

test('v2 apply: ilerleme korunur; v3: sıfırlama seçeneği + retire; geri alma', () => {
  const before2 = state('n.aaa#trde');
  const v2 = mk(2, [noun('n.aaa', 'Aaa', 'die', ['a', 'a2']), noun('n.bbb', 'Bbb', 'die', ['b', 'b2']), noun('n.ccc', 'Ccc', 'das', ['c'])]);
  const r2 = apply(v2, { resetProgress: false });
  assert.ok(r2.ok);
  assert.equal(state('n.aaa#trde').stage, before2.stage); // yerinde güncelleme, ilerleme duruyor
  assert.equal(state('n.aaa#trde').step, before2.step);

  const v3 = mk(3, [noun('n.aaa', 'Aaa', 'das', ['a'])], ['n.ccc']);
  const r3 = apply(v3, { resetProgress: true });
  assert.ok(r3.ok);
  assert.equal(state('n.aaa#trde').stage, 'new'); // cevabı etkileyen değişiklik + sıfırlama seçildi
  assert.equal((getDb().prepare("SELECT retired FROM items WHERE id='n.ccc'").get() as any).retired, 1);
  assert.equal((getDb().prepare("SELECT retired FROM items WHERE id='n.bbb'").get() as any).retired, 0); // pakette olmayan ama retire edilmeyen: silinmez

  // yalnızca en son import geri alınır
  if (r2.ok && r3.ok) {
    assert.equal(undoImport(r2.import_id).ok, false);
    assert.equal(undoImport(r3.import_id).ok, true);
    assert.equal(undoImport(r3.import_id).ok, false); // iki kez geri alınamaz
    assert.equal((getDb().prepare("SELECT retired FROM items WHERE id='n.ccc'").get() as any).retired, 0);
    assert.equal(state('n.aaa#trde').stage, before2.stage); // sıfırlanan ilerleme geri geldi
    assert.equal((getDb().prepare('SELECT version FROM packs').get() as any).version, 2);
    assert.equal(undoImport(r2.import_id).ok, true);
    assert.equal((getDb().prepare('SELECT version FROM packs').get() as any).version, 1);
    assert.equal(JSON.parse((getDb().prepare("SELECT json FROM items WHERE id='n.aaa'").get() as any).json).article, 'der');
  }
});

test('başka paketin item id\'sini ele geçirme reddedilir', () => {
  const other = JSON.stringify({ standard: 'deutsch-pack/1', pack: { id: 'other-pack', title: 'O', version: 1, level: 'A1', taught_on: '2026-11-02', unit: 'oth' }, items: [noun('n.aaa', 'Aaa', 'der', ['x'])], retire: [] });
  const a = analyze(other);
  assert.equal(a.ok, false);
});
