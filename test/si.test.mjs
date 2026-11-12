import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import si, { parseArso, decodeEntities } from '../countries/si.mjs';
import { normalizeStations, mergeHistory } from '../countries/lib.mjs';

const xml = readFileSync(new URL('./fixtures/arso-hidro.xml', import.meta.url), 'utf8');

test('parseArso: stations, positions, units and thresholds', () => {
  const { updated, stations } = parseArso(xml);
  assert.equal(stations.length, 5, 'the sea buoy has neither stage nor discharge and is skipped');
  const mura = stations.find(s => s.id === '1060');
  assert.equal(mura.name, 'Gornja Radgona I');
  assert.equal(mura.river, 'Mura');
  assert.equal(mura.pov, 'Mura');
  assert.equal(mura.lat, 46.68124); assert.equal(mura.lon, 15.9953);
  assert.deepEqual(mura.q, [600, 905, 1180, null]);
  assert.deepEqual(mura.h, [null, null, null, null]);
  // 2026-11-12 00:00 CET = 2026-11-11 23:00 UTC
  const t = Date.UTC(2026, 10, 11, 23, 0) / 1000;
  assert.deepEqual(mura.H, [[t, 57]]);
  assert.deepEqual(mura.Q, [[t, 47.6]]);
  assert.equal(updated, t);
});

test('parseArso: stage thresholds, empty readings and diacritics', () => {
  const { stations } = parseArso(xml);
  const lake = stations.find(s => s.id === '3280');
  assert.deepEqual(lake.h, [300, 330, 410, null]);
  assert.deepEqual(lake.q, [null, null, null, null]);
  const dry = stations.find(s => s.id === '1100');
  assert.deepEqual(dry.H, [], 'empty <vodostaj/> gives no point');
  assert.equal(dry.Q[0][1], 0.001);
  assert.equal(stations.find(s => s.id === '1140').river, 'Ščavnica');
  assert.equal(stations.find(s => s.id === '3105').name, 'Hrušica');
});

test('parseArso: tolerates garbage and a station without position', () => {
  assert.deepEqual(parseArso('<html>nope</html>').stations, []);
  const bad = '<arsopodatki><postaja sifra="1"><reka>A</reka><merilno_mesto>B</merilno_mesto><vodostaj>1</vodostaj></postaja></arsopodatki>';
  assert.deepEqual(parseArso(bad).stations, []);
});

test('decodeEntities: numeric hex/decimal and named', () => {
  assert.equal(decodeEntities('&#x010D;&#269;&amp;&#xZZ;'), 'čč&&#xZZ;');
});

test('station list survives normalizeStations and mergeHistory', () => {
  const a = parseArso(xml).stations;
  assert.equal(normalizeStations(a).length, 5);
  const later = a.map(s => ({ ...s, H: s.H.map(([t, v]) => [t + 1800, v + 1]), Q: [] }));
  const m = mergeHistory(a, later).find(s => s.id === '1060');
  assert.equal(m.H.length, 2);
});

test('module shape', () => {
  assert.equal(si.id, 'si');
  assert.equal(si.sources.stations.ttlMin, 30);
  assert.equal(si.levels.names.length, 5);
});
