import test from 'node:test';
import assert from 'node:assert/strict';
import { floodFill, floodForStage, lowestNear, pixelOf } from '../experiments/flood/flood.mjs';
import { mercator, unmercator, windowAround, readTiledFloatTiff } from '../dem.mjs';

const NODATA = 65535;
// build a grid from rows of metre heights (converted to the decimetre Uint16 the app uses)
const grid = rows => ({ z: Uint16Array.from(rows.flat().map(m => (m == null ? NODATA : Math.round(m * 10)))), width: rows[0].length, height: rows.length });
const idx = (g, x, y) => y * g.width + x;

test('floods connected low cells and nothing else', () => {
  // river on the left (column 0), a floodplain next to it, a hill, and a pond that is NOT connected to the river
  const g = grid([
    [100, 101, 102, 110, 100],
    [100, 101, 102, 110, 100],
    [100, 101, 102, 110, 100],
  ]);
  const r = floodFill(g.z, g.width, g.height, idx(g, 0, 1), 1025);         // water at 102.5 m
  assert.equal(r.count, 9, 'columns 0-2 flood');
  assert.equal(r.mask[idx(g, 4, 1)], 0, 'the pond behind the hill stays dry even though it is lower than the water');
  assert.equal(r.maxDepthDm, 25);
});

test('a levee holds until the water is above its crest', () => {
  const g = grid([[100, 101, 106, 101, 101]]);          // river | field | levee (106) | field behind it
  assert.equal(floodFill(g.z, g.width, g.height, 0, 1050).mask[idx(g, 3, 0)], 0);   // 105.0 m: behind the levee is dry
  assert.equal(floodFill(g.z, g.width, g.height, 0, 1070).mask[idx(g, 3, 0)], 1);    // 107.0 m: overtopped
});

test('no flooding when the water is below the seed cell or the seed is invalid', () => {
  const g = grid([[100, 100, 100]]);
  assert.equal(floodFill(g.z, g.width, g.height, 0, 990).count, 0);
  assert.equal(floodFill(g.z, g.width, g.height, -1, 1100).count, 0);
});

test('cells without data block the flood', () => {
  const g = grid([[100, null, 100]]);
  const r = floodFill(g.z, g.width, g.height, 0, 1100);
  assert.equal(r.count, 1);
});

test('the radius limit stops the flood', () => {
  const g = grid([Array(21).fill(100)]);
  const r = floodFill(g.z, g.width, g.height, 0, 1100, { limit: { cx: 0, cy: 0, radius: 5 } });
  assert.equal(r.count, 6);                              // cells 0..5
});

test('diagonal connection counts (8 neighbours)', () => {
  const g = grid([[100, 200], [200, 100]]);
  assert.equal(floodFill(g.z, g.width, g.height, 0, 1100).count, 2);
});

test('floodForStage: stage on the gauge + gauge zero gives the water level, the seed is the lowest cell near the gauge', () => {
  const g = grid([[103, 100, 101, 108, 100]]);           // gauge at x=1; lowest within 2 cells is the river at 100.0
  const r = floodForStage({ ...g, cx: 1, cy: 0, zeroM: 98, stageCm: 350, seedRadius: 2 });
  assert.equal(r.levelDm, 1015);                         // 98 + 3.50 = 101.5 m
  assert.equal(r.seed, 1);
  assert.equal(r.count, 2);                              // cells 1 and 2; 103 m (x=0) is above the water and the 100 m cell behind the 108 m hill is cut off
});

test('lowestNear picks the lowest valid cell within the radius', () => {
  const g = grid([[105, 105, 105], [105, null, 99], [105, 105, 105]]);
  assert.equal(lowestNear(g.z, g.width, g.height, 1, 1, 1), idx(g, 2, 1));
  assert.equal(lowestNear(g.z, g.width, g.height, 0, 0, 0), idx(g, 0, 0));
});

test('pixelOf maps a station into the Web Mercator grid written by fetch-dem', () => {
  const win = windowAround(14.4692, 50.3523, 2.5, 2000);
  const [west, south] = unmercator(win.bbox[0], win.bbox[1]), [east, north] = unmercator(win.bbox[2], win.bbox[3]);
  const p = pixelOf({ bounds: { west, south, east, north }, width: 2000, height: 2000 }, 14.4692, 50.3523);
  assert.ok(Math.abs(p.x - 1000) <= 1 && Math.abs(p.y - 1000) <= 1, `centre expected, got ${p.x},${p.y}`);
});

test('windowAround: square window with the requested ground size', () => {
  const w = windowAround(14.4692, 50.3523, 2.5, 2000);
  const [x0, y0, x1, y1] = w.bbox;
  assert.ok(Math.abs((x1 - x0) - (y1 - y0)) < 1e-6);
  assert.ok(Math.abs(w.groundPixel - 2.5) < 0.05, `ground pixel ${w.groundPixel}`);
  const [lon, lat] = unmercator(...mercator(14.4692, 50.3523));
  assert.ok(Math.abs(lon - 14.4692) < 1e-9 && Math.abs(lat - 50.3523) < 1e-9);
});

// ---- the TIFF reader, on a tiny hand-built tiled float32 TIFF -----------------------------------------------------
function tinyTiff(width, height, tile, values) {
  const across = Math.ceil(width / tile), down = Math.ceil(height / tile), tiles = across * down;
  const entries = 8, ifdOff = 8, ifdLen = 2 + entries * 12 + 4, offsetsAt = ifdOff + ifdLen, countsAt = offsetsAt + tiles * 4, dataAt = countsAt + tiles * 4;
  const tileBytes = tile * tile * 4, buf = Buffer.alloc(dataAt + tiles * tileBytes);
  buf.writeUInt16LE(0x4949, 0); buf.writeUInt16LE(42, 2); buf.writeUInt32LE(ifdOff, 4);
  buf.writeUInt16LE(entries, ifdOff);
  const put = (i, tag, type, cnt, val) => { const o = ifdOff + 2 + i * 12; buf.writeUInt16LE(tag, o); buf.writeUInt16LE(type, o + 2); buf.writeUInt32LE(cnt, o + 4); if (type === 3) buf.writeUInt16LE(val, o + 8); else buf.writeUInt32LE(val, o + 8); };
  put(0, 256, 3, 1, width); put(1, 257, 3, 1, height); put(2, 258, 3, 1, 32); put(3, 259, 3, 1, 1);
  put(4, 322, 3, 1, tile); put(5, 323, 3, 1, tile); put(6, 324, 4, tiles, offsetsAt); put(7, 339, 3, 1, 3);
  for (let t = 0; t < tiles; t++) {
    buf.writeUInt32LE(dataAt + t * tileBytes, offsetsAt + t * 4); buf.writeUInt32LE(tileBytes, countsAt + t * 4);
    const tx = t % across, ty = Math.floor(t / across);
    for (let y = 0; y < tile; y++) for (let x = 0; x < tile; x++) {
      const gx = tx * tile + x, gy = ty * tile + y;
      buf.writeFloatLE(gx < width && gy < height ? values[gy * width + gx] : -9999, dataAt + t * tileBytes + (y * tile + x) * 4);
    }
  }
  return buf;
}

test('readTiledFloatTiff reassembles tiles, including partial edge tiles', () => {
  const width = 5, height = 3, values = Array.from({ length: width * height }, (_, i) => 100 + i / 4);
  const out = readTiledFloatTiff(tinyTiff(width, height, 4, values));
  assert.equal(out.width, 5); assert.equal(out.height, 3);
  assert.deepEqual([...out.data], values);
});

test('readTiledFloatTiff rejects what it cannot read', () => {
  assert.throws(() => readTiledFloatTiff(Buffer.from('not a tiff at all......')), /TIFF/);
});

// ---- tilted water surface, channel direction, zone comparison, rasteriser ----------------------------------------------
import { levelAt, channelAxis, tiltFromSlope, orient, compareWithZone } from '../experiments/flood/flood.mjs';
import { rasterizeFeatures } from '../zones.mjs';

test('a tilted water surface floods more upstream-high ground and less downstream', () => {
  // flat floodplain at 101.0 m, row of 11 cells, river seed at x=5; surface 101.5 at the gauge
  const g = grid([Array(11).fill(101.0)]);
  g.z[5] = 100 * 10;                                             // river cell
  const flat = floodFill(g.z, g.width, g.height, 5, 1015);
  assert.equal(flat.count, 11);
  // surface falls 0.3 m per cell towards +x: cells right of the gauge drop below the ground (101.0)
  const tilt = { gx: -3, gy: 0, cx: 5, cy: 0 };                 // dm per pixel
  const tilted = floodFill(g.z, g.width, g.height, 5, 1015, { tilt });
  assert.equal(tilted.mask[idx(g, 6, 0)], 1);                    // 101.2 m: still wet
  assert.equal(tilted.mask[idx(g, 7, 0)], 0);                    // 100.9 m: dry
  assert.equal(tilted.mask[idx(g, 0, 0)], 1);                    // upstream side gets deeper water
  assert.equal(levelAt(1015, tilt, 5, 0, 7, 0), 1009);
});

test('tiltFromSlope converts cm/km along an axis into dm per pixel', () => {
  const t = tiltFromSlope(20, { ux: 1, uy: 0 }, 2.5);            // 20 cm/km, 2.5 m pixels -> 0.005 dm per pixel
  assert.ok(Math.abs(t.gx - 0.005) < 1e-12 && t.gy === 0);
  const d = tiltFromSlope(20, { ux: 0, uy: -1 }, 2.5);
  assert.ok(Math.abs(d.gy + 0.005) < 1e-12);
});

test('channelAxis finds the direction of a flat channel and orient() flips it', () => {
  // diagonal flat channel (100.0 m) across a 120x120 grid of 105 m ground
  const w = 120, rows = Array.from({ length: w }, (_, y) => Array.from({ length: w }, (_, x) => (Math.abs(x - y) <= 2 ? 100 : 105)));
  const g = grid(rows);
  const axis = channelAxis(g.z, g.width, g.height, idx(g, 60, 60), 80);
  assert.ok(axis, 'channel should be found');
  assert.ok(Math.abs(Math.abs(axis.ux) - Math.SQRT1_2) < 0.05 && Math.abs(Math.abs(axis.uy) - Math.SQRT1_2) < 0.05, `diagonal expected, got ${axis.ux},${axis.uy}`);
  const up = orient(axis, 60, 60, 100, 100);                      // point towards the lower right
  assert.ok(up.ux > 0 && up.uy > 0);
  assert.equal(channelAxis(grid([[100, 100, 100]]).z, 3, 1, 0, 5), null, 'too small to tell');
});

test('compareWithZone gives precision, recall and IoU, optionally inside a circle', () => {
  const flood = Uint8Array.from([1, 1, 1, 0, 0, 0, 0, 0, 0]);    // 3x3, top row flooded
  const zones = Uint8Array.from([4, 4, 0, 4, 4, 0, 0, 0, 0]);    // Q100 bit (4) on the top-left 2x2
  const c = compareWithZone(flood, zones, 4);
  assert.deepEqual([c.floodCells, c.zoneCells, c.both], [3, 4, 2]);
  assert.ok(Math.abs(c.precision - 2 / 3) < 1e-9 && Math.abs(c.recall - 0.5) < 1e-9 && Math.abs(c.iou - 2 / 5) < 1e-9);
  assert.equal(compareWithZone(flood, zones, 8).recall, null, 'a bit that is never set has no zone cells');
  const small = compareWithZone(flood, zones, 4, { cx: 0, cy: 0, radius: 0.5 });
  assert.deepEqual([small.floodCells, small.zoneCells, small.both], [1, 1, 1]);
});

test('rasterizeFeatures: even-odd fill keeps holes empty, ORs bits, and accepts lat,lon coordinate order', () => {
  const out = new Uint8Array(10 * 10);
  const toPixel = (lon, lat) => [lon, lat];                       // identity: coordinates are pixels
  const square = (a, b) => [[a, a], [b, a], [b, b], [a, b], [a, a]];
  // outer 1..9 with a hole 4..6, written as [lat, lon] pairs that the code must recognise (values here are not in lat range, so lon,lat is used)
  rasterizeFeatures([{ geometry: { type: 'Polygon', coordinates: [square(1, 9), square(4, 6)] } }], toPixel, 10, 10, 4, out);
  assert.equal(out[2 * 10 + 2], 4);                               // inside the ring
  assert.equal(out[5 * 10 + 5], 0);                               // inside the hole
  assert.equal(out[0 * 10 + 0], 0);                               // outside
  rasterizeFeatures([{ geometry: { type: 'MultiPolygon', coordinates: [[square(0, 3)]] } }], toPixel, 10, 10, 1, out);
  assert.equal(out[0], 1);                                        // the new bit alone where the first polygon does not reach
  assert.equal(out[2 * 10 + 2], 4 | 1);                           // overlapping layers keep both bits

  // lat,lon order as the VÚV WFS returns it: [50.3, 14.4] must be read as lon 14.4, lat 50.3
  const seen = [];
  rasterizeFeatures([{ geometry: { type: 'Polygon', coordinates: [[[50.1, 14.1], [50.1, 14.9], [50.9, 14.9], [50.9, 14.1]]] } }], (lon, lat) => { seen.push([lon, lat]); return [0, 0]; }, 2, 2, 1, new Uint8Array(4));
  assert.deepEqual(seen[0], [14.1, 50.1]);
});
