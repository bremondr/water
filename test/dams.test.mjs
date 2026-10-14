import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PLATFORMS, parseTable, joinTables, finalizeReservoirs, CASCADE_REF } from '../dams.mjs';

const fixture = name => readFileSync(new URL(`./fixtures/${name}.html`, import.meta.url), 'utf8');
const load = p => joinTables(p, parseTable(fixture(`${p.key}-Prehled`)), parseTable(fixture(`${p.key}-Objemy`)));
const byKey = Object.fromEntries(PLATFORMS.map(p => [p.key, load(p)]));

// Row counts of the saved snapshot. A portal layout change shows up here first.
const EXPECTED = { pla: 16, pvl: 39, poh: 23, pod: 7, pmo: 29 };
const SAMPLE = { pla: 'Seč', pvl: 'Orlík', poh: 'Nechranice', pod: 'Šance', pmo: 'Vranov' };

for (const p of PLATFORMS) {
  test(`${p.pov}: parses every dam`, () => {
    const dams = byKey[p.key];
    assert.equal(dams.length, EXPECTED[p.key]);
    assert.ok(dams.some(d => d.name === SAMPLE[p.key]), `${SAMPLE[p.key]} missing`);
    assert.equal(new Set(dams.map(d => d.key)).size, dams.length, 'duplicate keys');
    for (const d of dams) {
      assert.ok(d.name && !d.name.startsWith('VD '), `bad name ${d.name}`);
      assert.ok(d.river, `${d.name}: no river`);
      assert.match(d.time, /^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}$/, `${d.name}: bad time "${d.time}"`);
      assert.ok(Number.isFinite(d.level), `${d.name}: no level`);
    }
  });

  test(`${p.pov}: Objemy column mapping is sane`, () => {
    // fill % + free % must make 100, which fails if the page's reused element ids ever shift
    for (const d of byKey[p.key]) {
      if (d.fillPct == null || d.freePct == null) continue;
      assert.ok(d.fillPct >= 0 && d.fillPct <= 100, `${d.name}: fill ${d.fillPct}`);
      assert.ok(Math.abs(d.fillPct + d.freePct - 100) < 1, `${d.name}: fill+free = ${d.fillPct + d.freePct}`);
    }
  });
}

test('parses Czech decimals and entities', () => {
  const [seč] = byKey.pla.filter(d => d.name === 'Seč');
  assert.equal(typeof seč.level, 'number');
  assert.ok(seč.level > 100 && seč.level < 1500, `implausible level ${seč.level} m a.s.l.`);
  assert.ok(byKey.pla.some(d => d.river.includes('Černá Nisa')), 'entity decoding (Černá) failed');
});

const sample = (over = {}) => ({
  key: 'x:1', pov: 'Povodí X', name: 'Test', river: 'R', time: '14.10.2026 11:00', level: 300, volume: 1,
  inflow: 0.5, outflow: 0.4, precip: null, temp: null, qa: null, q1: null, q5: null, q20: null, q100: null,
  storedMil: 1, fillPct: 50, freeMil: 1, freePct: 50, note: '', ...over,
});

test('finalize: outflow 0 with real inflow is hidden and points at the ČHMÚ gauges', () => {
  const [d] = finalizeReservoirs([sample({ outflow: 0, inflow: 16.7 })], { 'x:1': [49, 14] });
  assert.equal(d.outflow, null);
  assert.deepEqual(d.refGauges, CASCADE_REF);
  assert.equal(d.warnings.length, 1);
});

test('finalize: a genuine zero outflow with negligible inflow is kept', () => {
  const [d] = finalizeReservoirs([sample({ outflow: 0, inflow: 0.2 })], { 'x:1': [49, 14] });
  assert.equal(d.outflow, 0);
  assert.equal(d.refGauges, undefined);
  assert.equal(d.warnings.length, 0);
});

test('finalize: negative inflow gets an explanation, value is kept', () => {
  const [d] = finalizeReservoirs([sample({ inflow: -2.99 })], { 'x:1': [49, 14] });
  assert.equal(d.inflow, -2.99);
  assert.equal(d.warnings.length, 1);
});

test('finalize: drops duplicates and dams without a position, flags approximate ones', () => {
  const out = finalizeReservoirs([
    sample({ key: 'x:1', name: 'A' }),
    sample({ key: 'x:2', name: 'B' }),
    sample({ key: 'x:3', name: 'Dalešice - přepočítaná' }),
    sample({ key: 'x:4', name: 'NoPos' }),
  ], { 'x:1': [49, 14], 'x:2': [48, 15, 1], 'x:3': [47, 14] });
  assert.deepEqual(out.map(d => d.name), ['A', 'B']);
  assert.equal(out[0].approx, false);
  assert.equal(out[1].approx, true);
});

test('finalize: an Odra note that merely repeats the name is cleared', () => {
  const [d] = finalizeReservoirs([sample({ name: 'Kružberk', note: 'VD Kružberk' })], { 'x:1': [49, 14] });
  assert.equal(d.note, '');
});

test('the saved Vltava snapshot has the four cascade dams with a hidden outflow', () => {
  const coords = Object.fromEntries(byKey.pvl.map(d => [d.key, [49, 14]]));
  const hidden = finalizeReservoirs(byKey.pvl, coords).filter(d => d.refGauges).map(d => d.name).sort();
  assert.deepEqual(hidden, ['Kamýk', 'Orlík', 'Slapy', 'Štěchovice']);
});

test('scrapeAll: one unreachable portal is reported without failing the whole call', async () => {
  const { scrapeAll } = await import('../dams.mjs');
  const { dams, errors } = await scrapeAll([{ key: 'bad', pov: 'Povodí Nikde', base: 'http://127.0.0.1:1/nope' }]);
  assert.deepEqual(dams, []);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].pov, 'Povodí Nikde');
  assert.ok(errors[0].message);
});
