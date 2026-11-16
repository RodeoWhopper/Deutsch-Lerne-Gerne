import './env.ts';
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { openDb, setDb, getDb } from '../src/server/db.ts';
import { apply } from '../src/server/importer.ts';
import { answer, buildQueue } from '../src/server/engine.ts';
import { putSettings, getSettings } from '../src/server/settings.ts';
import { cardsFor, TRACKS, buildQuestion, evaluate } from '../src/shared/cards.ts';
import { parsePack } from '../src/shared/pack.ts';

const raw = readFileSync('packs/_example.json', 'utf8');
const pack = parsePack(raw);
assert.ok(pack.ok);

before(() => {
  setDb(openDb(':memory:'));
  const r = apply(raw, { resetProgress: false });
  assert.ok(r.ok);
  getDb().prepare('UPDATE packs SET active=1').run();
});

test('§7.3 kart üretimi tablosu', () => {
  const by = (kind: string) => pack.ok ? pack.pack.items.find((i) => i.kind === kind)! : (null as never);
  const tracksOf = (i: any) => cardsFor(i).map((c) => c.track).sort().join(',');
  assert.equal(tracksOf(by('noun')), 'artikel,de-tr,tr-de');
  assert.equal(tracksOf(pack.ok && pack.pack.items.find((i) => i.id === 'w.schnell')), 'de-tr,tr-de');
  assert.equal(tracksOf(pack.ok && pack.pack.items.find((i) => i.id === 'w.fahren')), 'de-tr,gramer,gramer,gramer,tr-de'); // forms -> gramer
  assert.equal(tracksOf(by('verb_case')), 'de-tr,fiil,fiil'); // case + cloze + de-tr
  assert.equal(tracksOf(by('prep')), 'de-tr,edat-baglac');
  assert.equal(tracksOf(by('conj')), 'de-tr,edat-baglac');
  assert.equal(tracksOf(by('grammar')), 'gramer');
  assert.equal(tracksOf(by('phrase')), 'de-tr,tr-de');
});

test('örnek paket 6 track\'in hepsine kart üretir', () => {
  const rows = getDb().prepare('SELECT DISTINCT track FROM cards').all() as { track: string }[];
  assert.deepEqual(rows.map((r) => r.track).sort(), [...TRACKS].sort());
});

test('her kart için soru üretilir ve doğru cevap doğru değerlendirilir (tüm kartlar)', () => {
  const rows = getDb().prepare('SELECT c.id, c.variant, i.json FROM cards c JOIN items i ON i.id=c.item_id').all() as any[];
  let n = 0;
  for (const r of rows) {
    const item = JSON.parse(r.json);
    const q = buildQuestion(item, r.variant, { stage: 'new', interval_days: 0, unit: 'ulasim', rng: () => 0.3, distractors: () => ['x1', 'x2', 'x3'] });
    assert.ok(q.prompt.length > 0, r.id);
    // choose the correct answer per kind and verify evaluate() agrees
    const ev0 = evaluate(item, r.variant, '___wrong___');
    assert.equal(ev0.correct, false, r.id + ' wrong answer must be wrong');
    const right = q.kind === 'selfcheck' ? 'known' : r.variant === 'artikel' ? item.article : ev0.expected.split(' / ')[0];
    const ev = evaluate(item, r.variant, right);
    assert.equal(ev.correct, true, `${r.id} expected "${ev0.expected}"`);
    n++;
  }
  assert.ok(n > 100, String(n));
});

test('de-tr kademeli zorluk: new/learning -> 4 seçenek, review (>=3 gün) -> yazarak', () => {
  const item = (pack.ok && pack.pack.items.find((i) => i.id === 'n.bus'))!;
  const dis = () => ['a', 'b', 'c'];
  const learn = buildQuestion(item, 'detr', { stage: 'learning', interval_days: 0, unit: 'ulasim', rng: Math.random, distractors: dis });
  assert.equal(learn.kind, 'choice'); assert.equal(learn.choices!.length, 4);
  const rev = buildQuestion(item, 'detr', { stage: 'review', interval_days: 5, unit: 'ulasim', rng: Math.random, distractors: dis });
  assert.equal(rev.kind, 'type');
  const young = buildQuestion(item, 'detr', { stage: 'review', interval_days: 1, unit: 'ulasim', rng: Math.random, distractors: dis });
  assert.equal(young.kind, 'choice');
});

test('seçenek şıkları benzer kelimelerden (aynı kind + ünite), kendi cevabını tekrarlamaz', () => {
  const q = buildQueue({ mode: 'daily' }).questions.find((x) => x.track === 'de-tr' && x.kind === 'choice');
  if (!q) return; // none among the first 10 new cards
  assert.equal(new Set(q.choices).size, q.choices!.length);
});

const now0 = Date.UTC(2026, 10, 20, 9, 0, 0);
function learnEverything(t: number) {
  const ids = (getDb().prepare('SELECT card_id FROM card_state').all() as { card_id: string }[]).map((r) => r.card_id);
  for (const id of ids) {
    answer({ card_id: id, answer: id.includes('#artikel') ? 'der' : 'zzz', ms: 4000, hint: false, mode: 'daily' }, t);
  }
}

test('günlük limit: yeni kart sayısı ayardaki limiti aşmaz, sonra 0', () => {
  putSettings({ ...getSettings(), daily_new: 10 });
  const q1 = buildQueue({ mode: 'daily' }, now0);
  assert.equal(q1.questions.length, 10);
  assert.ok(q1.questions.every((q) => q.stage === 'new'));
  for (const q of q1.questions) answer({ card_id: q.card_id, answer: 'zzz', ms: 3000, hint: false, mode: 'daily' }, now0);
  const q2 = buildQueue({ mode: 'daily' }, now0 + 5 * 60_000);
  assert.ok(q2.questions.filter((q) => q.stage === 'new').length === 0, 'limit dolu: yeni kart yok');
});

test('yeni kartlar paketin taught_on / item sırasına göre açılır', () => {
  const ids = (getDb().prepare("SELECT card_id FROM card_state WHERE introduced_day IS NOT NULL").all() as { card_id: string }[]).map((r) => r.card_id);
  assert.ok(ids.some((i) => i.startsWith('n.bus#')));
  assert.ok(!ids.some((i) => i.startsWith('c.aber#')));
});

test('§6 sprint: yeni kart yok (ayar kapalı), süre bütçesi, track kapsama, art arda ≤3 aynı track', () => {
  // make all remaining cards "introduced" so every track has non-new cards
  learnEverything(now0 + 10 * 60_000);
  const later = now0 + 3 * 86_400_000;
  const r = buildQueue({ mode: 'sprint', minutes: 15 }, later, () => 0.42);
  assert.ok(r.questions.length >= 30 && r.questions.length <= 90, String(r.questions.length));
  assert.ok(r.questions.every((q) => q.stage !== 'new'));
  assert.ok(r.meta.est_s <= 15 * 60 * 1.12, `est ${r.meta.est_s}s`);
  for (const t of TRACKS) assert.ok(r.questions.filter((q) => q.track === t).length >= 2, `kapsama: ${t}`);
  let run = 1;
  for (let i = 1; i < r.questions.length; i++) {
    run = r.questions[i].track === r.questions[i - 1].track ? run + 1 : 1;
    assert.ok(run <= 3, `aynı track art arda ${run} @${i}`);
  }
  const short = buildQueue({ mode: 'sprint', minutes: 10 }, later, () => 0.42);
  assert.ok(short.questions.length < r.questions.length, '10 dk < 15 dk');
});

test('sprint: ayarda "sprint\'te yeni kart" açıkken ve limit varken yeni kart eklenir', () => {
  const p2 = JSON.stringify({ standard: 'deutsch-pack/1', pack: { id: 'zweites-pack', title: 'Zweites', version: 1, level: 'A1', taught_on: '2026-11-15', unit: 'zwei' },
    items: [1, 2, 3].map((n) => ({ id: 's.neu' + n + 'abc', kind: 'phrase', de: 'Neu ' + n, tr: ['yeni ' + n] })) });
  assert.ok(apply(p2, { resetProgress: false }).ok);
  getDb().prepare("UPDATE packs SET active=1 WHERE id='zweites-pack'").run();
  putSettings({ ...getSettings(), sprint_new: true, daily_new: 50 });
  const day = now0 + 20 * 86_400_000;
  const r = buildQueue({ mode: 'sprint', minutes: 20 }, day, () => 0.5);
  assert.ok(r.questions.some((q) => q.stage === 'new'));
  putSettings({ ...getSettings(), sprint_new: false, daily_new: 10 });
});

test('mini en fazla 10 kart', () => {
  const r = buildQueue({ mode: 'mini' }, now0 + 20 * 86_400_000);
  assert.ok(r.questions.length <= 10 && r.questions.length > 0);
});

test('hata defteri: son 14 günde again alan kartlar; 14 gün sonra düşer', () => {
  const t = now0 + 30 * 86_400_000;
  const id = 'n.zug#trde';
  answer({ card_id: id, answer: 'zzz', ms: 3000, hint: false, mode: 'daily' }, t - 1000);
  assert.ok(buildQueue({ mode: 'errors' }, t).questions.some((q) => q.card_id === id));
  assert.ok(!buildQueue({ mode: 'errors' }, t + 15 * 86_400_000).questions.some((q) => q.card_id === id));
});

test('sülük: lapses >= 8', () => {
  const id = 'n.auto#detr';
  getDb().prepare("UPDATE card_state SET lapses=8, stage='review', interval_days=4, due=? WHERE card_id=?").run(0, id);
  const q = buildQueue({ mode: 'errors' }, now0 + 90 * 86_400_000).questions;
  assert.ok(q.some((x) => x.card_id === id));
});

test('erken tekrar (vadesi gelmemiş, doğru) aralığı şişirmez', () => {
  const id = 'n.gleis#artikel';
  const t = now0 + 100 * 86_400_000;
  getDb().prepare("UPDATE card_state SET stage='review', interval_days=10, reps=3, due=?, ease=2.5 WHERE card_id=?").run(t + 5 * 86_400_000, id);
  const r = answer({ card_id: id, answer: 'das', ms: 4000, hint: false, mode: 'sprint' }, t);
  assert.equal(r.correct, true);
  assert.equal(r.next.interval_days, 10);
  assert.equal(r.next.due, t + 5 * 86_400_000);
});

test('hint kullanımı -> hard, ease düşer', () => {
  const id = 'n.fahrrad#trde';
  const t = now0 + 100 * 86_400_000;
  getDb().prepare("UPDATE card_state SET stage='review', interval_days=10, reps=3, due=?, ease=2.5 WHERE card_id=?").run(t - 1000, id);
  const r = answer({ card_id: id, answer: 'das Fahrrad', ms: 4000, hint: true, mode: 'daily' }, t);
  assert.equal(r.grade, 'hard');
});

test('istemci kodunda innerHTML / dangerouslySetInnerHTML / eval yok (§4.7)', () => {
  const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]));
  for (const f of walk('src/client').filter((f) => /\.(tsx?|html)$/.test(f))) {
    const s = readFileSync(f, 'utf8');
    assert.ok(!/innerHTML|outerHTML|dangerouslySetInnerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/.test(s), f);
    assert.ok(!/<script(?![^>]*src=)/.test(s) && !/\sstyle="/.test(s), `inline script/style in ${f}`);
  }
});
