import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseStationPage, pragueToEpoch } from '../weirs.mjs';

const page = id => parseStationPage(readFileSync(new URL(`./fixtures/weir-${id}.html`, import.meta.url), 'utf8'));

test('Střekov page: name, river, hourly level and flow rows', () => {
  const p = page(74);
  assert.equal(p.name, 'Střekov');
  assert.equal(p.river, 'Labe');
  assert.ok(p.rows.length >= 20, `only ${p.rows.length} rows`);
  for (const r of p.rows) {
    assert.match(r.time, /^\d\d\.\d\d\.\d{4} \d\d:\d\d$/);
    assert.ok(r.h > 130 && r.h < 150, `level ${r.h} m a.s.l. is not a Střekov pool level`);   // pool is ~141.4 m
    assert.ok(r.q == null || (r.q > 0 && r.q < 5000), `flow ${r.q}`);
  }
  assert.ok(p.rows.some(r => r.q == null), 'rows with a blank flow cell must keep q = null, not shift columns');
});

test('Střekov page: low-flow and N-year flows', () => {
  const p = page(74);
  assert.ok(p.qLow > 10 && p.qLow < 500, `Q355 ${p.qLow}`);
  assert.deepEqual(Object.keys(p.nYear), ['q1', 'q2', 'q5', 'q10', 'q20', 'q50', 'q100']);
  const v = Object.values(p.nYear);
  assert.ok(v.every((x, i) => x > 0 && (i === 0 || x > v[i - 1])), `N-year flows must increase: ${v}`);
});

test('Opatovice page: level only, no flow', () => {
  const p = page(65);
  assert.equal(p.name, 'Opatovice nad Labem');
  assert.ok(p.rows.length >= 20);
  assert.ok(p.rows.every(r => r.h > 200 && r.h < 260), 'level should be ~225 m a.s.l.');
  assert.ok(p.rows.every(r => r.q == null), 'Opatovice publishes no flow');
});

test('pragueToEpoch handles summer and winter time', () => {
  assert.equal(new Date(pragueToEpoch('14.10.2026 17:00') * 1000).toISOString(), '2026-10-14T15:00:00.000Z');   // CEST, UTC+2
  assert.equal(new Date(pragueToEpoch('15.01.2026 12:00') * 1000).toISOString(), '2026-01-15T11:00:00.000Z');   // CET, UTC+1
  assert.equal(pragueToEpoch('nonsense'), null);
});

test('loadNoDataWeirs: maps the static list, approximate unless high confidence, skips live keys', async () => {
  const { loadNoDataWeirs } = await import('../weirs.mjs');
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { pathToFileURL } = await import('node:url');
  const dir = await mkdtemp(join(tmpdir(), 'weirs-'));
  const file = pathToFileURL(join(dir, 'w.json'));
  await writeFile(file, JSON.stringify([
    { key: 'plaw:nd-a', name: 'Zdymadlo A', type: 'zdymadlo', hasLock: true, rkm: 1.5, lat: 50, lon: 14, confidence: 'high' },
    { key: 'plaw:nd-b', name: 'Jez B', type: 'jez', lat: 50.1, lon: 14.1, confidence: 'medium' },
    { key: 'plaw:74', name: 'duplicate of a live weir', lat: 50, lon: 14, confidence: 'high' },
  ]));
  const out = await loadNoDataWeirs(file);
  assert.deepEqual(out.map(w => w.key), ['plaw:nd-a', 'plaw:nd-b']);
  assert.ok(out.every(w => w.kind === 'weir' && w.noData === true && w.river === 'Labe'));
  assert.equal(out[0].approx, false);
  assert.equal(out[1].approx, true);
  assert.deepEqual(await loadNoDataWeirs(pathToFileURL(join(dir, 'missing.json'))), []);
  await rm(dir, { recursive: true });
});
