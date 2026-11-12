import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import gb, { parseStations, parseMeasureId } from '../countries/gb.mjs';
import { normalizeStations } from '../countries/lib.mjs';

const fx = n => JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8'));
const stations = fx('gb-stations.json'), readings = fx('gb-readings.json');

test('gb: measure ids, only river stage measures with a metre unit are accepted', () => {
  const u = 'http://environment.data.gov.uk/flood-monitoring/id/measures/';
  assert.deepEqual(parseMeasureId(u + '1029TH-level-stage-i-15_min-mASD'), { station: '1029TH', unit: 'mASD' });
  assert.deepEqual(parseMeasureId(u + 'E2043-level-stage-i-15_min-mAOD'), { station: 'E2043', unit: 'mAOD' });
  assert.equal(parseMeasureId(u + '1029TH-level-downstage-i-15_min-mASD'), null);
  assert.equal(parseMeasureId(u + '3680-level-groundwater-i-15_min-mAOD'), null);
  assert.equal(parseMeasureId(u + '0001-level-tidal_level-i-15_min-mAOD'), null);
  assert.equal(parseMeasureId(u + '1029TH-level-stage-i-15_min-mm'), null);
});

test('gb: parses the real (trimmed) API responses into stations in cm', () => {
  const list = parseStations(stations, readings);
  assert.ok(list.length >= 10 && list.length < 31, 'groundwater/tidal/downstage-only stations are dropped');
  const s = list[0];
  const r = readings.items.find(x => x.measure.includes(`/${s.id}-level-stage-`));
  assert.equal(s.H.length, 1);
  assert.equal(s.H[0][0], Date.parse(r.dateTime) / 1000);
  assert.ok(Math.abs(s.H[0][1] - r.value * 100) < 0.06, 'metres to cm');
  assert.deepEqual(s.h, [null, null, null, null]);
  assert.ok(list.every(x => !/^River\s/i.test(x.river)));
  const n = normalizeStations(list);
  assert.equal(n.length, list.length, 'all pass the framework normalisation');
  assert.ok(n.every(x => x.lat > 49 && x.lat < 56 && x.lon > -7 && x.lon < 2.5));
});

test('gb: stale readings, closed stations and array values are dropped, preferred unit wins', () => {
  const m = (id, unit) => `http://x/id/measures/${id}-level-stage-i-15_min-${unit}`;
  const st = { items: [
    { stationReference: 'A', label: 'A', lat: 51, long: -1, riverName: 'River Test', status: 'http://x/statusActive' },
    { stationReference: 'B', label: 'B', lat: 51, long: -1 },
    { stationReference: 'C', label: 'C', lat: 51, long: -1, status: 'http://x/statusClosed' },
    { stationReference: 'D', label: 'D', lat: 51, long: -1 },
    { stationReference: 'E', label: 'E', lat: 51, long: -1 },
  ] };
  const rd = { items: [
    { measure: m('A', 'mAOD'), dateTime: '2026-01-02T00:00:00Z', value: 10 },
    { measure: m('A', 'mASD'), dateTime: '2026-01-02T00:00:00Z', value: 1.234 },
    { measure: m('B', 'm'), dateTime: '2025-12-01T00:00:00Z', value: 1 },
    { measure: m('C', 'm'), dateTime: '2026-01-02T00:00:00Z', value: 1 },
    { measure: m('D', 'm'), dateTime: '2026-01-02T00:00:00Z', value: [1, 2] },
  ] };
  const out = parseStations(st, rd);
  assert.deepEqual(out.map(s => s.id), ['A']);
  assert.equal(out[0].H[0][1], 123.4);
  assert.equal(out[0].river, 'Test');
});

test('gb: module shape and required attribution', () => {
  assert.equal(gb.id, 'gb');
  assert.ok(gb.sources.stations.ttlMin >= 30);
  assert.match(gb.about, /Contains public sector information licensed under the Open Government Licence v3\.0/);
  assert.match(gb.about, /Environment Agency/);
  assert.equal(fx('gb-readings.json').meta.licence, 'http://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/');
});
