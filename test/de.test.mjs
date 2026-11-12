import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import de, { parsePegelonline, region } from '../countries/de.mjs';
import { normalizeStations } from '../countries/lib.mjs';

const raw = JSON.parse(await readFile(new URL('./fixtures/de-pegelonline-stations.json', import.meta.url), 'utf8'));
const stations = parsePegelonline(raw);
const by = n => stations.find(s => s.name === n);

test('de: drops stations without coordinates (Czech ones), foreign agencies stations without W/Q and canal gauges in m+NN (not a level above gauge zero)', () => {
  const names = stations.map(s => s.name);
  for (const gone of ['Louny', 'Prelouc', 'Tiel', 'Basel-Rheinhalle', 'Abbenfleth Sperrwerk', 'Hörstel']) assert.ok(!names.includes(gone), gone);
  assert.equal(stations.length, raw.length - 6);
});

test('de: flood marks M_I..M_III become h, MW the average, NNW the dry mark; current value becomes the only point', () => {
  const celle = by('Celle');
  assert.deepEqual(celle.h, [300, 340, 400, null]);
  assert.equal(celle.ha, 192);
  assert.equal(celle.dryH, 50);
  assert.equal(celle.river, 'Aller');
  assert.equal(celle.pov, 'Ostatní řeky');
  assert.deepEqual(celle.H, [[Date.parse('2026-11-12T00:45:00+01:00') / 1000, 118]]);
  assert.deepEqual(celle.Q, []);
});

test('de: discharge in m3/s, no flood marks where the station has none, region from the river', () => {
  const dresden = by('Dresden');
  assert.equal(dresden.pov, 'Labe');
  assert.equal(dresden.Q.length, 1);
  assert.ok(dresden.Q[0][1] > 0);
  const lahn = by('Marburg');
  assert.equal(lahn.pov, 'Lahn');
  assert.deepEqual(lahn.h, [null, null, null, null]);
  assert.deepEqual(by('Köln').h, [620, 830, null, null]);
  assert.equal(by('Cuxhaven Steubenhöft').pov, 'Labe');
});

test('de: region()', () => {
  assert.equal(region('NORDSEE'), 'Moře a pobřeží');
  assert.equal(region('ELBE-HAVEL-KANAL'), 'Kanály a vodní cesty');
  assert.equal(region('UNTERE HAVEL-WASSERSTRASSE'), 'Kanály a vodní cesty');
  assert.equal(region('RHEIN'), 'Rýn');
  assert.equal(region(undefined), 'Ostatní řeky');
});

test('de: output survives normalizeStations and the module is well formed', () => {
  assert.equal(normalizeStations(stations).length, stations.length);
  assert.equal(de.id, 'de');
  assert.equal(de.levels.names.length, 5);
  assert.equal(de.levels.short.length, 5);
  assert.ok(de.sources.stations.ttlMin >= 30);
});
