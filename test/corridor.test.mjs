import test from 'node:test';
import assert from 'node:assert/strict';
import { corridorGrid, toPixel, fromPixel, labelCorridor, interpolateLevel, buildLevelLut, floodCorridor, findSeeds, S_UNIT, NO_S, NODATA } from '../corridor.mjs';
import { chainReaches, cumulative, project, haversine } from '../river.mjs';

test('corridorGrid and toPixel/fromPixel round-trip', () => {
  const pts = [[14.0, 50.6], [14.2, 50.5], [14.4, 50.4]];
  const g = corridorGrid(pts, 3000, 8);
  assert.ok(g.W > 1000 && g.H > 1000);
  assert.ok(Math.abs(g.groundPixel - 8) < 1e-9);
  for (const [lon, lat] of pts) {
    const [x, y] = toPixel(g, lon, lat);
    assert.ok(x > 0 && x < g.W && y > 0 && y < g.H, 'inside the grid');
    const [lo, la] = fromPixel(g, x, y);
    assert.ok(Math.abs(lo - lon) < 1e-9 && Math.abs(la - lat) < 1e-9);
  }
});

test('labelCorridor: cells get the s of the nearest centreline point and cells beyond the half width are outside', () => {
  // straight river along y = 50 from x = 10 (s = 1000 m upstream) to x = 190 (s = 0), 8 m cells, half width 160 m = 20 px
  const W = 200, H = 100, gp = 8;
  const line = [[10, 50, 1000], [190, 50, 0]];
  const s = labelCorridor(W, H, gp, line, 160, 4);
  const at = (x, y) => s[y * W + x] * S_UNIT;
  assert.ok(Math.abs(at(100, 50) - 500) <= 20, `mid-river s ${at(100, 50)}`);
  assert.ok(Math.abs(at(100, 60) - 500) <= 20, 'same s across the river');
  assert.ok(at(40, 55) > at(160, 55), 's grows upstream (towards smaller x here)');
  assert.equal(s[80 * W + 100], NO_S, '30 px away is outside a 20 px corridor');
  assert.notEqual(s[65 * W + 100], NO_S, '15 px away is inside');
});

test('interpolateLevel: linear, and the two ways of extrapolating', () => {
  const pts = [{ s: 0, level: 100 }, { s: 10000, level: 102 }, { s: 20000, level: 107 }];
  assert.equal(interpolateLevel(pts, 5000), 101);
  assert.equal(interpolateLevel(pts, 15000), 104.5);
  assert.equal(interpolateLevel(pts, 30000), 112);                       // continues with the slope of the last segment
  assert.equal(interpolateLevel(pts, -10000, 'slope'), 98);
  assert.equal(interpolateLevel(pts, 30000, 'flat'), 107);
  assert.equal(interpolateLevel([{ s: 5, level: 50 }], 999), 50);
});

test('buildLevelLut: continuous without steps, flat pools and a drop at the weir with steps', () => {
  const points = [{ s: 0, level: 100 }, { s: 20000, level: 110 }];
  const lut = buildLevelLut({ points, sMax: 20000 });
  assert.equal(lut[0], 1000); assert.equal(lut[1000], 1050); assert.equal(lut[2000], 1100);   // dm, one unit = 10 m
  const stepped = buildLevelLut({ points, sMax: 20000, weirs: [{ s: 10000 }], stepWeirs: true });
  assert.equal(stepped[100], stepped[850], 'flat inside the lower pool');
  assert.equal(stepped[1150], stepped[1900], 'flat inside the upper pool');
  assert.ok(stepped[1150] > stepped[850], 'the upper pool is higher: a drop at the weir');
  assert.ok(stepped[950] > stepped[850] && stepped[950] < stepped[1150], 'the drop is a ramp, not a straight cut');
  assert.ok(Math.abs(stepped[1000] - (stepped[850] + stepped[1150]) / 2) <= 1, 'half way down at the weir');
});

test('buildLevelLut: a gauge inside a pool sets that pool level', () => {
  const points = [{ s: 2000, level: 101 }, { s: 15000, level: 109 }];
  const lut = buildLevelLut({ points, sMax: 20000, weirs: [{ s: 8000 }], stepWeirs: true });
  assert.equal(lut[500], 1010);                                           // lower pool: the gauge at s = 2000
  assert.equal(lut[1800], 1090);                                          // upper pool: the gauge at s = 15000
});

// terrain: a valley that rises towards +y, river along the middle row, river coordinate s = x * 10 m upstream towards +x
function valley(W = 60, H = 21, floor = 100) {
  const z = new Uint16Array(W * H), s = new Uint16Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { z[y * W + x] = Math.round((floor + Math.abs(y - 10) * 0.5) * 10); s[y * W + x] = x; }
  return { z, s, W, H };
}

test('floodCorridor: the water level follows s, so more floods upstream than downstream', () => {
  const { z, s, W, H } = valley();
  // level rises 0.1 m per unit of s: valley floor 100 m, water 100.5 m at s = 0 and 106.4 m at s = 59 (60 units = 600 m)
  const lut = Int32Array.from({ length: W }, (_, u) => 1005 + u * 1);
  const seeds = []; for (let x = 0; x < W; x++) seeds.push(10 * W + x);
  const r = floodCorridor(z, s, W, H, lut, seeds);
  const width = x => { let n = 0; for (let y = 0; y < H; y++) n += r.mask[y * W + x]; return n; };
  assert.ok(width(50) > width(5), `upstream ${width(50)} cells wide, downstream ${width(5)}`);
  assert.equal(width(0), 2 * 1 + 1, "at s = 0 the water is 0.5 m deep, which reaches 1 row either side (0.5 m per row)");
});

test('floodCorridor: a low field behind a ridge stays dry until the water is above the ridge', () => {
  const W = 30, H = 5, z = new Uint16Array(W * H).fill(1000), s = new Uint16Array(W * H).fill(0);
  for (let y = 0; y < H; y++) z[y * W + 10] = 1050;                       // ridge at x = 10, 5 m above the floor... (dm: 105 m vs 100 m)
  const seeds = [2 * W + 0];
  const low = floodCorridor(z, s, W, H, new Int32Array([1030]), seeds);   // 103 m: below the ridge
  assert.equal(low.mask[2 * W + 20], 0);
  const high = floodCorridor(z, s, W, H, new Int32Array([1060]), seeds);  // 106 m: overtops it
  assert.equal(high.mask[2 * W + 20], 1);
});

test('floodCorridor ignores cells without data or outside the corridor', () => {
  const W = 5, H = 1, z = Uint16Array.from([1000, NODATA, 1000, 1000, 1000]), s = Uint16Array.from([0, 0, NO_S, 0, 0]);
  const r = floodCorridor(z, s, W, H, new Int32Array([1100]), [0]);
  assert.equal(r.count, 1, 'blocked by the no-data cell');
});

test('findSeeds picks the lowest wet cell near each centreline vertex', () => {
  const { z, s, W, H } = valley();
  const lut = Int32Array.from({ length: W }, () => 1005);
  const seeds = findSeeds(z, s, W, H, lut, [[5, 10, 0], [30, 10, 0], [55, 10, 0]], 3, 1);
  assert.equal(seeds.length, 3);
  for (const i of seeds) assert.equal(Math.floor(i / W), 10, 'on the river row');
});

// ---- river reaches -------------------------------------------------------------------------------------------------------
const reach = (zuid, kmP, kmK, a, b, n = 20) => ({ zuid, kmP, kmK, line: Array.from({ length: n }, (_, i) => [a[0] + (b[0] - a[0]) * i / (n - 1), a[1] + (b[1] - a[1]) * i / (n - 1)]) });

test('chainReaches joins numeric-ZUID reaches that cover the km range, upstream first', () => {
  const up = reach('100000002', 120, 220, [14.8, 50.2], [14.5, 50.4]), down = reach('100000001', 20, 120, [14.5, 50.4], [14.2, 50.6]);
  const regional = reach('CZ020_9', 100, 150, [14.6, 50.3], [14.5, 50.4]);
  const { line, reaches } = chainReaches([down, regional, up], 50, 180);
  assert.deepEqual(reaches.map(r => r.zuid), ['100000002', '100000001']);
  assert.equal(line[0][0], 14.8);
  assert.ok(Math.abs(line.at(-1)[0] - 14.2) < 1e-9);
});

test('chainReaches reports a gap and project() finds the position along the line', () => {
  assert.throws(() => chainReaches([reach('100000001', 20, 80, [14, 50], [14.1, 50])], 20, 200), /do not cover/);
  const line = [[14.0, 50.0], [14.1, 50.0], [14.2, 50.0]], cum = cumulative(line);
  const p = project(line, cum, 14.15, 50.002);
  assert.ok(Math.abs(p.s - haversine([14.0, 50.0], [14.15, 50.0])) < 60, `s ${p.s}`);
  assert.ok(p.dist > 200 && p.dist < 240, `dist ${p.dist}`);
});
