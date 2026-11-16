import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { parsePack } from '../src/shared/pack.ts';

const example = readFileSync('packs/_example.json', 'utf8');
const base = () => JSON.parse(example);
const bad = (mut: (p: any) => void) => { const p = base(); mut(p); return parsePack(JSON.stringify(p)); };

test('örnek paket geçerli', () => { const r = parsePack(example); assert.equal(r.ok, true); });
test('JSON Schema (2020-12) örneği kabul eder, zod ile aynı sonuç', () => {
  const ajv = new (Ajv2020 as any)({ strict: false, allErrors: true });
  const validate = ajv.compile(JSON.parse(readFileSync('schema/deutsch-pack.schema.json', 'utf8')));
  assert.equal(validate(base()), true, JSON.stringify(validate.errors?.slice(0, 3)));
  const p = base(); p.items[0].evil = 1;
  assert.equal(validate(p), false); assert.equal(parsePack(JSON.stringify(p)).ok, false);
  const q = base(); q.standard = 'deutsch-pack/2';
  assert.equal(validate(q), false); assert.equal(parsePack(JSON.stringify(q)).ok, false);
});
test('bilinmeyen alan reddedilir (üst, pack, item)', () => {
  assert.equal(bad((p) => { p.extra = 1; }).ok, false);
  assert.equal(bad((p) => { p.pack.extra = 1; }).ok, false);
  assert.equal(bad((p) => { p.items[3].extra = 1; }).ok, false);
});
test('yanlış standard, id, level, tarih', () => {
  assert.equal(bad((p) => { p.standard = 'x'; }).ok, false);
  assert.equal(bad((p) => { p.pack.id = 'A'; }).ok, false);
  assert.equal(bad((p) => { p.pack.level = 'C2'; }).ok, false);
  assert.equal(bad((p) => { p.pack.taught_on = '2026-02-31'; }).ok, false);
  assert.equal(bad((p) => { p.pack.version = 0; }).ok, false);
});
test('noun kuralları: küçük harf de, artikelli de, plural_only+article', () => {
  assert.equal(bad((p) => { p.items[0].de = 'bus'; }).ok, false);
  assert.equal(bad((p) => { p.items[0].de = 'der Bus'; }).ok, false);
  assert.equal(bad((p) => { p.items.find((i: any) => i.id === 'n.ferien').article = 'der'; }).ok, false);
});
test('cloze tam bir {{}} içermeli; mcq answer choices içinde', () => {
  assert.equal(bad((p) => { p.items.find((i: any) => i.id === 'g.vom').text = 'Er kommt vom Bahnhof.'; }).ok, false);
  assert.equal(bad((p) => { p.items.find((i: any) => i.id === 'g.vom').text = '{{a}} {{b}}'; }).ok, false);
  assert.equal(bad((p) => { p.items.find((i: any) => i.id === 'g.dat.mit.fem').answer = 'xyz'; }).ok, false);
  assert.equal(bad((p) => { p.items.find((i: any) => i.id === 'v.folgen').cloze = 'Ich folge dem Fahrer.'; }).ok, false);
});
test('tekrarlı item id, 2000+ item', () => {
  assert.equal(bad((p) => { p.items[1].id = p.items[0].id; }).ok, false);
  const p = base(); p.items = Array.from({ length: 2001 }, (_, i) => ({ id: 'p.x' + i + 'abc', kind: 'phrase', de: 'Hallo', tr: ['merhaba'] }));
  assert.equal(parsePack(JSON.stringify(p)).ok, false);
});
test('kontrol karakterleri ve bidi reddedilir', () => {
  assert.equal(bad((p) => { p.items[0].tr = ['otobüs\u0000']; }).ok, false);
  assert.equal(bad((p) => { p.items[0].tr = ['otobüs\n']; }).ok, false);
  assert.equal(bad((p) => { p.items[0].tr = ['otobüs‮']; }).ok, false);
  assert.equal(bad((p) => { p.items[0].tr = ['oto​büs']; }).ok, false);
});
test('NFC normalizasyonu uygulanır', () => {
  const p = base(); p.items[0].tr = ['otobüs']; // decomposed ü
  const r = parsePack(JSON.stringify(p));
  assert.equal(r.ok, true);
  if (r.ok) assert.equal((r.pack.items[0] as any).tr[0], 'otobüs');
});
test('1 MB üstü ve geçersiz JSON reddedilir', () => {
  assert.equal(parsePack('x'.repeat(1_000_001)).ok, false);
  assert.equal(parsePack('{not json').ok, false);
  assert.equal(parsePack('[]').ok, false);
});
test('zararlı string içerikli paket geçerli ama düz metin olarak saklanır', () => {
  const evil = ['<img src=x onerror=alert(1)>', '<script>alert(1)</script>', 'javascript:alert(1)'];
  const r = bad((p) => { p.items[0].tr = evil; });
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual((r.pack.items[0] as any).tr, evil); // data, never markup: rendering uses textContent only
});
test('__proto__ anahtarı reddedilir', () => {
  assert.equal(parsePack('{"standard":"deutsch-pack/1","__proto__":{"x":1},"pack":{},"items":[]}').ok, false);
});
