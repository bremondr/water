import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseClimate, exceedanceDays } from '../climate.mjs';

const fx = name => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
const usti = () => parseClimate(fx('climate-MDQ-0-203-1-221000'), fx('climate-MONQ-0-203-1-221000'));

test('parseClimate: Ústí nad Labem has average, 12 monthly values and the flow-duration curve', () => {
  const c = usti();
  assert.equal(c.period, '1991 - 2020');
  assert.equal(c.qa, 271);
  for (const k of ['avg', 'min', 'max']) { assert.equal(c[k].length, 12); assert.ok(c[k].every(Number.isFinite)); }
  for (let m = 0; m < 12; m++) assert.ok(c.min[m] <= c.avg[m] && c.avg[m] <= c.max[m], `month ${m + 1}: min <= avg <= max`);
  assert.ok(c.mdq.length >= 10);
  // flow-duration curve: more days exceeded means a lower flow
  for (let i = 1; i < c.mdq.length; i++) assert.ok(c.mdq[i][0] > c.mdq[i - 1][0] && c.mdq[i][1] < c.mdq[i - 1][1]);
});

test('parseClimate: monthly values land in the right calendar month', () => {
  const c = parseClimate(null, fx('climate-MONQ-0-203-1-001000'));
  assert.equal(c.avg[0], 1.37);        // January
  assert.equal(c.avg[3], 5.44);        // April snow-melt peak at Špindlerův Mlýn
  assert.equal(c.qa, undefined);       // no MDQ document -> no annual figures
});

test('parseClimate: nothing usable gives null', () => {
  assert.equal(parseClimate(null, null), null);
  assert.equal(parseClimate({ charList: [] }, { charList: [] }), null);
});

test('exceedanceDays interpolates and reports out-of-range flows', () => {
  const { mdq } = usti();
  assert.deepEqual(exceedanceDays(mdq, 549), { days: 30, bound: '' });
  const mid = exceedanceDays(mdq, 300);
  assert.equal(mid.bound, '');
  assert.ok(mid.days > 90 && mid.days < 120, `got ${mid.days}`);
  assert.deepEqual(exceedanceDays(mdq, 5000), { days: 30, bound: '<' });      // rarer than the Q30 flow
  assert.deepEqual(exceedanceDays(mdq, 10), { days: 364, bound: '>' });       // lower than the lowest published flow
  assert.equal(exceedanceDays(mdq, null), null);
  assert.equal(exceedanceDays(undefined, 10), null);
});
