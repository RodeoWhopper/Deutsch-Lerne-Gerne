import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkGerman, checkNoun, checkTurkish, trFold, trLower } from '../src/shared/answer.ts';

test('Türkçe I/İ/ı/i: tr-aware lowercasing', () => {
  assert.equal(trLower('ISI'), 'ısı');
  assert.equal(trLower('İstanbul'), 'istanbul');
  assert.equal(trLower('IŞIK'), 'ışık');
  // the trap: plain toLowerCase would turn I into i
  assert.notEqual('ISI'.toLowerCase(), trLower('ISI'));
});
test('Türkçe cevap: "ISI" -> "ısı" tam doğru, uyarı yok', () => {
  const r = checkTurkish('ISI', ['ısı']);
  assert.equal(r.correct, true); assert.deepEqual(r.notes, []);
});
test('Türkçe cevap: "ışık" yazılınca "ışık" kabul', () => {
  assert.equal(checkTurkish('ışık', ['ışık']).correct, true);
});
test('Türkçe cevap: "İstanbul" ve "istanbul"', () => {
  assert.equal(checkTurkish('İstanbul', ['İstanbul']).correct, true);
  assert.equal(checkTurkish('istanbul', ['İstanbul']).correct, true);
  assert.equal(checkTurkish('Istanbul', ['İstanbul']).correct, true); // ascii I -> accent tolerance
});
test('Türkçe: ısı ile isi karışmaz ama aksan toleransı notla kabul', () => {
  const r = checkTurkish('isi', ['ısı']);
  assert.equal(r.correct, true);
  assert.match(r.notes[0], /doğrusu: ısı/);
});
test('Türkçe: ç/ş/ğ/ö/ü aksansız kabul, doğrusu gösterilir', () => {
  const r = checkTurkish('cocuk', ['çocuk']);
  assert.equal(r.correct, true); assert.match(r.notes[0], /çocuk/);
  assert.equal(checkTurkish('gormek', ['görmek']).correct, true);
});
test('Türkçe: eş anlamlı varyantlar', () => {
  assert.equal(checkTurkish('araba', ['otomobil', 'araba']).correct, true);
  assert.equal(checkTurkish('kedi', ['otomobil', 'araba']).correct, false);
});
test('trFold ASCII dönüşümü', () => assert.equal(trFold('ÇIĞLIK Şüphe'), 'ciglik suphe'));

test('Almanca: ae/oe/ue/ss kabul, doğrusu ipucu, ceza yok', () => {
  const r = checkGerman('Fuesse', ['Füße']);
  assert.equal(r.correct, true); assert.equal(r.caseOnly, false);
  assert.match(r.notes[0], /doğrusu: üß/);
  assert.equal(checkGerman('schoen', ['schön']).correct, true);
  assert.equal(checkGerman('gruen', ['grün']).correct, true);
});
test('Almanca: tam doğru -> not yok', () => {
  const r = checkGerman('schön', ['schön']);
  assert.equal(r.correct, true); assert.deepEqual(r.notes, []);
});
test('Almanca: yalnızca büyük/küçük harf -> doğru ama caseOnly (hard)', () => {
  const r = checkGerman('Fahren', ['fahren']);
  assert.equal(r.correct, true); assert.equal(r.caseOnly, true);
});
test('Almanca: yanlış cevap', () => assert.equal(checkGerman('fahrt', ['fahren']).correct, false));
test('Almanca: trailing noktalama', () => {
  assert.equal(checkGerman('Wo ist die Haltestelle', ['Wo ist die Haltestelle?'], { ignoreEndPunct: true }).correct, true);
});
test('Almanca tr-locale ile "I" bozulmaz (de lower)', () => {
  assert.equal(checkGerman('ICH', ['ich']).correct, true);
});

test('İsim: artikel eksik -> yanlış + "artikeli yaz"', () => {
  const r = checkNoun('Bus', 'der', 'Bus');
  assert.equal(r.correct, false); assert.deepEqual(r.notes, ['artikeli yaz']);
});
test('İsim: yanlış artikel', () => assert.equal(checkNoun('die Bus', 'der', 'Bus').correct, false));
test('İsim: doğru', () => { const r = checkNoun('der Bus', 'der', 'Bus'); assert.equal(r.correct, true); assert.equal(r.caseOnly, false); });
test('İsim: küçük harf -> doğru ama hard + not', () => {
  const r = checkNoun('der bus', 'der', 'Bus');
  assert.equal(r.correct, true); assert.equal(r.caseOnly, true);
  assert.match(r.notes.join(' '), /isimler büyük harfle/);
});
test('İsim: umlaut transliterasyonu + artikel', () => {
  const r = checkNoun('der Apfel', 'der', 'Apfel'); assert.equal(r.correct, true);
  const r2 = checkNoun('die Aepfel', 'die', 'Äpfel'); assert.equal(r2.correct, true);
});
test('Artikel büyük harfle yazılsa da kabul', () => assert.equal(checkNoun('Der Bus', 'der', 'Bus').correct, true));
