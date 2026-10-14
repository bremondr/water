// Alignment check for the rasterised official flood zones: is the outline shifted against the terrain?
// Correlates zone boundary pixels with terrain edges over a range of shifts; with a correct datum the best shift is a few metres.
// (Without the S-JTSK to WGS84 datum fix in zones.mjs it was ~80 m west and ~90 m south.) Needs data from scripts/fetch-dem.mjs.
//   node scripts/zone-offset.mjs <stationId> [bit=4 (Q100)] [range px=40] [step px=2]
// Dense urban areas (Prague) have edges everywhere, so the result there is not conclusive.
import { readFileSync } from 'node:fs';
const id = process.argv[2] || '0-203-1-204000', bit = +(process.argv[3] || 4), R = +(process.argv[4] || 40), step = +(process.argv[5] || 2);
const meta = JSON.parse(readFileSync(new URL(`../experiments/flood/data/${id}.json`, import.meta.url), 'utf8'));
const zb = readFileSync(new URL(`../experiments/flood/data/${id}.zones.bin`, import.meta.url));
const db = readFileSync(new URL(`../experiments/flood/data/${id}.bin`, import.meta.url));
const z = new Uint16Array(db.buffer, db.byteOffset, db.byteLength / 2), zones = new Uint8Array(zb.buffer, zb.byteOffset, zb.byteLength);
const W = meta.width, H = meta.height;
// terrain edge strength: |gradient| in dm per pixel, smoothed slightly; boundary pixels of the zone mask
const edge = new Float32Array(W * H);
for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const i = y * W + x; edge[i] = Math.hypot(z[i + 1] - z[i - 1], z[i + W] - z[i - W]) / 2; }
const bpts = [];
for (let y = 3; y < H - 3; y += 1) for (let x = 3; x < W - 3; x += 1) { const i = y * W + x; if (!(zones[i] & bit)) continue; if (!((zones[i - 1] & bit) && (zones[i + 1] & bit) && (zones[i - W] & bit) && (zones[i + W] & bit))) bpts.push(x, y); }
console.log(id, 'bit', bit, 'boundary pixels', bpts.length / 2, '| ground pixel', meta.groundPixel.toFixed(2), 'm');
// subsample for speed
const sub = []; for (let k = 0; k < bpts.length; k += 2 * 3) sub.push(bpts[k], bpts[k + 1]);
let best = null; const grid = [];
for (let dy = -R; dy <= R; dy += step) for (let dx = -R; dx <= R; dx += step) {
  let s = 0, n = 0;
  for (let k = 0; k < sub.length; k += 2) { const x = sub[k] + dx, y = sub[k + 1] + dy; if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) continue; s += edge[y * W + x]; n++; }
  const m = s / n; grid.push([dx, dy, m]); if (!best || m > best.m) best = { dx, dy, m };
}
const base = grid.find(g => g[0] === 0 && g[1] === 0)[2], mean = grid.reduce((a, g) => a + g[2], 0) / grid.length;
console.log(`mean terrain edge strength on the boundary: unshifted ${base.toFixed(2)}, average over all shifts ${mean.toFixed(2)}, best ${best.m.toFixed(2)} at shift dx=${best.dx} px (east), dy=${best.dy} px (south) = ${(best.dx * meta.groundPixel).toFixed(0)} m east, ${(-best.dy * meta.groundPixel).toFixed(0)} m north`);
