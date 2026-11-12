import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeHistory, normalizeStations, normalizeUpdated, GENERIC_LEVELS } from '../countries/lib.mjs';
import { loadCountries, cacheName, countryMeta } from '../countries/index.mjs';

test('mergeHistory: appends new points to the previous series, dedupes by time and keeps the last 48 h', () => {
  const day = 86400;
  const prev = [{ id: 'a', H: [[1000, 10], [1000 + day, 11], [1000 + 3 * day, 12]], Q: [] }];
  const now = [{ id: 'a', H: [[1000 + 3 * day, 12], [1000 + 3 * day + 600, 13]], Q: [[1000 + 3 * day + 600, 2.5]] }, { id: 'b', H: [[5, 1]], Q: [] }];
  const [a, b] = mergeHistory(prev, now);
  assert.deepEqual(a.H, [[1000 + 3 * day, 12], [1000 + 3 * day + 600, 13]], 'older than 48 h dropped, duplicate time once');
  assert.deepEqual(a.Q, [[1000 + 3 * day + 600, 2.5]]);
  assert.deepEqual(b.H, [[5, 1]], 'a station without history is kept');
  assert.equal(mergeHistory(null, now).length, 2);
});

test('mergeHistory: stations that left the feed are not carried over', () => {
  assert.deepEqual(mergeHistory([{ id: 'gone', H: [[1, 1]], Q: [] }], [{ id: 'x', H: [], Q: [] }]).map(s => s.id), ['x']);
});

test('normalizeStations: fills every field the frontend reads and drops unusable stations', () => {
  const out = normalizeStations([
    { id: 7, name: 'Dresden', river: 'Elbe', lat: 51.05, lon: 13.74, h: [200, 300], H: [[1, 100], [2, NaN]] },
    { id: 8, name: 'no position', lat: null, lon: 1 },
    { id: 9, lat: 1, lon: 1 },
    null,
  ]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].h, [200, 300, null, null]);
  assert.deepEqual(out[0].q, [null, null, null, null]);
  assert.equal(out[0].id, '7'); assert.equal(out[0].pov, 'Ostatní'); assert.deepEqual(out[0].H, [[1, 100]]); assert.deepEqual(out[0].Q, []);
});

test('country modules: Česko comes first, ids match file names, meta has no functions', async () => {
  const list = await loadCountries();
  assert.equal(list[0].id, 'cz');
  for (const c of list) {
    assert.equal(c.levels.names.length, 5); assert.equal(c.levels.short.length, 5);
    assert.ok(Array.isArray(c.center) && c.zoom > 0, `${c.id}: map view`);
    assert.ok(typeof c.sources.stations.ttlMin === 'number', `${c.id}: station ttl`);
    assert.doesNotThrow(() => JSON.stringify(countryMeta(c)));
    assert.ok(!('sources' in countryMeta(c)));
  }
  assert.equal(cacheName({ id: 'cz' }, 'stations'), 'stations');
  assert.equal(cacheName({ id: 'pl' }, 'stations'), 'pl-stations');
  assert.equal(GENERIC_LEVELS.names.length, 5);
});

test('normalizeUpdated: ISO string out, epoch seconds and ms converted, future times capped, junk becomes now', () => {
  const now = Date.parse('2026-11-11T12:00:00Z');
  assert.equal(normalizeUpdated('2026-11-11T10:00:00Z', now), '2026-11-11T10:00:00.000Z');
  assert.equal(normalizeUpdated(Date.parse('2026-11-11T10:00:00Z') / 1000, now), '2026-11-11T10:00:00.000Z');
  assert.equal(normalizeUpdated(Date.parse('2026-11-11T10:00:00Z'), now), '2026-11-11T10:00:00.000Z');
  assert.equal(normalizeUpdated('2026-11-11T14:00:00Z', now), '2026-11-11T12:00:00.000Z');
  assert.equal(normalizeUpdated(undefined, now), '2026-11-11T12:00:00.000Z');
});
