import test from 'node:test';
import assert from 'node:assert/strict';
import { labelReaches, buildLevelLuts, floodCorridor, findSeeds, S_UNIT, NO_S, NO_R } from '../corridor.mjs';

// main river along y = 50 (s grows towards smaller x), a tributary comes in from the north at x = 100 and runs up to y = 10
const W = 200, H = 100, gp = 8;
const main = { linePx: [[10, 50, 1000], [190, 50, 0]], halfM: 160 };
const trib = { linePx: [[100, 10, 320], [100, 50, 0]], halfM: 120 };

test('labelReaches gives every cell its nearest reach and that reach\'s s', () => {
  const { s, r } = labelReaches(W, H, gp, [main, trib], 4);
  const at = (x, y) => [r[y * W + x], s[y * W + x] * S_UNIT];
  assert.equal(at(50, 52)[0], 0, 'beside the main river');
  assert.ok(Math.abs(at(50, 52)[1] - 780) <= 20, `main s ${at(50, 52)[1]}`);
  assert.equal(at(100, 25)[0], 1, 'in the tributary valley');
  assert.ok(Math.abs(at(100, 25)[1] - 200) <= 20, `tributary s ${at(100, 25)[1]} (25 px * 8 m = 200 m above the mouth)`);
  assert.equal(r[5 * W + 5], NO_R);
  assert.equal(s[5 * W + 5], NO_S);
});

test('a tributary starts at the level its parent has at the confluence', () => {
  // main: 100 m at s = 0 rising to 110 m at s = 1000 (confluence at s = 400, so 104 m); tributary gauge 106 m at 300 m above its mouth
  const { lut, offsets } = buildLevelLuts([
    { points: [{ s: 0, level: 100 }, { s: 1000, level: 110 }], sMax: 1000 },
    { points: [{ s: 300, level: 106 }], sMax: 400, mouth: { parent: 0, s: 400 } },
  ]);
  assert.equal(lut[offsets[1] + 0], 1040, 'level at the mouth equals the main river at s = 400');
  assert.equal(lut[offsets[1] + 30], 1060, 'the tributary gauge');
  assert.equal(lut[offsets[1] + 15], 1050, 'linear in between');
  assert.equal(lut[offsets[0] + 40], 1040, 'the parent at s = 400');
});

test('a tributary without gauges stays at the level of its mouth', () => {
  const { lut, offsets } = buildLevelLuts([{ points: [{ s: 0, level: 100 }, { s: 1000, level: 110 }], sMax: 1000 }, { points: [], sMax: 400, mouth: { parent: 0, s: 400 } }]);
  assert.ok(lut.slice(offsets[1], offsets[1] + 41).every(v => v === 1040));
  assert.throws(() => buildLevelLuts([{ points: [], sMax: 100 }]), /no gauge/);
});

test('the flood follows the tributary valley with its own level', () => {
  // flat valleys at 100 m; the tributary valley is 0.5 m above the main one; water at 103 m in the main river, 103 m at the tributary mouth
  const z = new Uint16Array(W * H).fill(1000);
  const { s, r } = labelReaches(W, H, gp, [main, trib], 4);
  for (let i = 0; i < z.length; i++) z[i] = s[i] === NO_S ? 65535 : 1000;
  // a ridge across the tributary valley at y = 20 that only a high enough tributary level overtops
  for (let x = 70; x < 130; x++) z[20 * W + x] = 1060;
  const lowTrib = buildLevelLuts([{ points: [{ s: 0, level: 103 }, { s: 1000, level: 103 }], sMax: 1000 }, { points: [], sMax: 340, mouth: { parent: 0, s: 400 } }]);
  const seeds = [50 * W + 100];
  const a = floodCorridor(z, s, W, H, lowTrib.lut, seeds, { r, offsets: lowTrib.offsets });
  assert.equal(a.mask[30 * W + 100], 1, 'below the ridge');
  assert.equal(a.mask[15 * W + 100], 0, 'above the ridge: dry at 103 m');
  const highTrib = buildLevelLuts([{ points: [{ s: 0, level: 103 }, { s: 1000, level: 103 }], sMax: 1000 }, { points: [{ s: 300, level: 110 }], sMax: 340, mouth: { parent: 0, s: 400 } }]);
  const b = floodCorridor(z, s, W, H, highTrib.lut, seeds, { r, offsets: highTrib.offsets });
  assert.equal(b.mask[15 * W + 100], 1, 'the higher tributary level overtops the ridge');
});

test('findSeeds works per reach with its own level table', () => {
  const z = new Uint16Array(W * H).fill(1000);
  const { s, r } = labelReaches(W, H, gp, [main, trib], 4);
  const { lut, offsets } = buildLevelLuts([{ points: [{ s: 0, level: 101 }, { s: 1000, level: 101 }], sMax: 1000 }, { points: [], sMax: 340, mouth: { parent: 0, s: 400 } }]);
  const line = [[100, 10, 320], [100, 20, 240], [100, 30, 160], [100, 40, 80], [100, 50, 0]];
  const seeds = findSeeds(z, s, W, H, lut, line, 3, 5, { r, offsets });
  assert.ok(seeds.length >= 3);
  for (const i of seeds) assert.ok(Math.abs((i % W) - 100) <= 3, 'near the tributary line');
});
