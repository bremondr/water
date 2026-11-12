import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import se, { parseBulk, titleCase } from '../countries/se.mjs';
import { normalizeStations } from '../countries/lib.mjs';

const fx = JSON.parse(readFileSync(new URL('./fixtures/se-bulk.json', import.meta.url), 'utf8'));

test('titleCase keeps Swedish letters', () => {
  assert.equal(titleCase('VÄSTERSEL'), 'Västersel');
  assert.equal(titleCase('GÖTA ÄLV'), 'Göta Älv');
  assert.equal(titleCase('HJÄLMAREN W'), 'Hjälmaren W');
});

test('parseBulk maps stations, converts ms to s and keeps m3/s', () => {
  const st = parseBulk(fx);
  assert.equal(st.length, 9);
  const v = st.find(s => s.id === '1583');
  assert.equal(v.name, 'Västersel');
  assert.equal(v.pov, 'Moälven');
  assert.equal(v.lat, 63.4332);
  assert.deepEqual(v.Q[0], [1794435300, 23.8]);
  assert.equal(v.Q.length, 4);
  assert.deepEqual(v.h, [null, null, null, null]);
  assert.deepEqual(st.find(s => s.name === 'Buskbäcken').Q, []);
});

test('parseBulk output passes normalizeStations and the module is well formed', () => {
  assert.equal(normalizeStations(parseBulk(fx)).length, 9);
  assert.equal(se.id, 'se');
  assert.equal(typeof se.sources.stations.build, 'function');
  assert.deepEqual(parseBulk({}), []);
});
