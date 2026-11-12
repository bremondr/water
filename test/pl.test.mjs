import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import pl, { parseHydro, parseTime, num } from '../countries/pl.mjs';
import { mergeHistory } from '../countries/lib.mjs';

const rows = JSON.parse(readFileSync(new URL('./fixtures/pl-hydro.json', import.meta.url), 'utf8'));

test('parseTime reads portal timestamps as UTC', () => {
  assert.equal(parseTime('2026-11-11 23:20:00'), Date.UTC(2026, 10, 11, 23, 20) / 1000);
  assert.equal(parseTime(null), null);
  assert.equal(parseTime('garbage'), null);
});

test('num handles strings, decimal commas and placeholders', () => {
  assert.equal(num('226'), 226);
  assert.equal(num('0.11'), 0.11);
  assert.equal(num('0,11'), 0.11);
  assert.equal(num('-5.077'), -5.077);
  for (const v of [null, undefined, '', '-', 'abc']) assert.equal(num(v), null);
});

test('parseHydro maps a real response', () => {
  const st = parseHydro(rows);
  assert.ok(st.length > 30 && st.length <= rows.length);
  for (const s of st) {
    assert.equal(typeof s.id, 'string');
    assert.ok(s.lat > 48 && s.lat < 56 && s.lon > 13 && s.lon < 25, s.name);
    assert.equal(s.h.length, 4);
    assert.equal(s.h[2], null);
    assert.equal(s.h[3], null);
  }
  const hel = st.find(s => s.name === 'Hel');
  assert.equal(hel.h[0], 550);
  assert.ok(hel.h[0] != null && hel.h[1] > hel.h[0]);
  assert.equal(hel.H.length, 1);
  assert.equal(hel.H[0][1], Number(rows.find(r => r.stacja === 'Hel').stan_wody));
});

test('diacritics are preserved and unknown voivodeship is grouped', () => {
  const st = parseHydro(rows);
  assert.ok(st.some(s => /[ąęłńóśźż]/i.test(s.name)));
  assert.ok(st.every(s => s.pov && s.pov !== '-'));
  assert.ok(st.some(s => s.pov === 'Neurčeno'));
  assert.ok(st.some(s => s.pov === 'łódzkie') || st.some(s => /ś|ł/.test(s.pov)));
});

test('stale readings and missing values are dropped, stations without thresholds are kept', () => {
  const st = parseHydro(rows);
  const stale = rows.find(r => r.przeplyw_data && r.przeplyw_data < '2026-03');
  const s = st.find(x => x.id === stale.id_stacji);
  assert.deepEqual(s.Q, []);
  const noThr = st.filter(x => x.h[0] == null && x.h[1] == null);
  assert.ok(noThr.length > 0);
  assert.ok(st.every(x => x.H.every(p => Number.isFinite(p[1]))));
});

test('rejects a non-array response', () => {
  assert.throws(() => parseHydro({ error: 'x' }));
});

test('history accumulates across runs via mergeHistory', () => {
  const a = parseHydro(rows);
  const later = a.map(s => ({ ...s, H: s.H.map(p => [p[0] + 3600, p[1] + 1]), Q: [] }));
  const merged = mergeHistory(a, later, 72);
  const withH = merged.find(s => s.H.length);
  assert.equal(withH.H.length, 2);
});

test('module shape', () => {
  assert.equal(pl.id, 'pl');
  assert.equal(pl.sources.stations.ttlMin, 60);
  assert.equal(pl.levels.names.length, 5);
  assert.equal(pl.levels.short.length, 5);
  assert.match(pl.about, /Źródłem pochodzenia danych jest Instytut Meteorologii i Gospodarki Wodnej – Państwowy Instytut Badawczy/);
  assert.match(pl.about, /zostały przetworzone/);
});
