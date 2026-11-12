import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import fi, { parseStations, dms, helsinkiMidnight } from '../countries/fi.mjs';
import { normalizeStations } from '../countries/lib.mjs';

const fx = JSON.parse(readFileSync(new URL('./fixtures/fi-syke.json', import.meta.url), 'utf8'));
const stations = parseStations(fx.paikka.value, fx.vedenkorkeus.value, fx.virtaama.value);

test('coordinates DDMMSS', () => {
  assert.ok(Math.abs(dms('622536') - 62.42667) < 1e-4);
  assert.equal(dms(null), null);
});
test('Helsinki midnight (winter +2, summer +3)', () => {
  assert.equal(helsinkiMidnight('2026-11-10T00:00:00'), Date.UTC(2026, 10, 9, 22) / 1000);
  assert.equal(helsinkiMidnight('2026-07-10T00:00:00'), Date.UTC(2026, 6, 9, 21) / 1000);
});
test('level and discharge of the same station number are one station', () => {
  const k = stations.find(s => s.id === '0201000');
  assert.equal(k.name, 'Kontturi');
  assert.ok(k.H.length && k.Q.length);
  assert.ok(k.H.every(p => p[1] > 0) && Math.abs(k.Q[0][1] - 1.42) < 1e-9);
});
test('names keep the full place name, river is the main catchment; ä survives', () => {
  const j = stations.find(s => s.id === '0400520');
  assert.equal(j.river, 'Vuoksi'); assert.equal(j.name, 'Jongunjoki, Viitakoski');
  assert.ok(stations.some(s => /[äö]/.test(s.name + s.river + s.pov)));
});
test('places without data in the window are dropped', () => {
  assert.ok(!stations.some(s => s.name === 'Sääperi'));
});
test('output is valid for the frontend', () => {
  const n = normalizeStations(stations);
  assert.equal(n.length, stations.length);
  for (const s of n) { assert.ok(s.lat > 58 && s.lat < 71 && s.lon > 19 && s.lon < 32); assert.ok(s.h.every(v => v === null)); assert.ok(s.H.length || s.Q.length); }
});
test('module shape', () => {
  assert.equal(fi.id, 'fi'); assert.ok(fi.sources.stations.build); assert.match(fi.about, /Syke/);
});
