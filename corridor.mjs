// Corridor flood model: one terrain raster that follows a river for tens of kilometres, a river coordinate `s` for every cell (metres
// upstream of the downstream end of the corridor, from the river centreline), and a water surface that is a function of `s` built from
// the levels of all gauges (and, optionally, steps at weirs) instead of one tilted plane.
// A cell floods when its terrain is below the water level at its own s AND it is connected to the river.
import { mercator } from './dem.mjs';

export const S_UNIT = 10;                 // metres per unit of the s raster (Uint16, so a corridor may be up to 655 km long)
export const NO_S = 65535;                // cell outside the corridor
export const NODATA = 65535;              // terrain: no data / outside the corridor

// ---- grid -----------------------------------------------------------------------------------------------------------------------
// Web Mercator grid that contains the polyline [[lon, lat], ...] with `halfM` metres either side. Pixel (x, y): x east, y south.
export function corridorGrid(points, halfM, pixelGround, pad = 300) {
  const pm = points.map(([lon, lat]) => mercator(lon, lat));
  const lat0 = points.reduce((a, p) => a + p[1], 0) / points.length, k = Math.cos(lat0 * Math.PI / 180);
  const pix = pixelGround / k, margin = (halfM + pad) / k;
  const xs = pm.map(p => p[0]), ys = pm.map(p => p[1]);
  const x0 = Math.min(...xs) - margin, yTop = Math.max(...ys) + margin;
  const W = Math.ceil((Math.max(...xs) + margin - x0) / pix), H = Math.ceil((yTop - (Math.min(...ys) - margin)) / pix);
  return { x0, y0: yTop, pix, W, H, lat0, groundPixel: pix * k };
}
export const toPixel = (g, lon, lat) => { const [mx, my] = mercator(lon, lat); return [(mx - g.x0) / g.pix, (g.y0 - my) / g.pix]; };
export const fromPixel = (g, x, y) => { const mx = g.x0 + x * g.pix, my = g.y0 - y * g.pix; return [mx / 6378137 * 180 / Math.PI, (2 * Math.atan(Math.exp(my / 6378137)) - Math.PI / 2) * 180 / Math.PI]; };

// ---- river coordinate for every cell ---------------------------------------------------------------------------------------------
// linePx: [[x, y, sMetres], ...] centreline in pixel coordinates with the river coordinate of each vertex.
// Nearest-centreline labelling by a chamfer distance transform on a coarse grid (`coarse` cells per coarse cell), then expanded to the
// fine grid. Cells farther than halfM from the line get NO_S. Returns Uint16Array of s in S_UNIT metres.
export function labelCorridor(W, H, groundPixel, linePx, halfM, coarse = 4) {
  const cw = Math.ceil(W / coarse), ch = Math.ceil(H / coarse), n = cw * ch;
  const dist = new Float32Array(n).fill(Infinity), lab = new Float32Array(n);
  for (let i = 1; i < linePx.length; i++) {                               // rasterise the centreline with its s values
    const [x1, y1, s1] = linePx[i - 1], [x2, y2, s2] = linePx[i];
    const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / coarse * 2));
    for (let k = 0; k <= steps; k++) {
      const t = k / steps, cx = Math.floor((x1 + (x2 - x1) * t) / coarse), cy = Math.floor((y1 + (y2 - y1) * t) / coarse);
      if (cx < 0 || cy < 0 || cx >= cw || cy >= ch) continue;
      const j = cy * cw + cx; dist[j] = 0; lab[j] = s1 + (s2 - s1) * t;
    }
  }
  const SQ = Math.SQRT2;
  const relax = (j, x, y, dx, dy, w) => { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) return; const k = ny * cw + nx, d = dist[k] + w; if (d < dist[j]) { dist[j] = d; lab[j] = lab[k]; } };
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) { const j = y * cw + x; relax(j, x, y, -1, 0, 1); relax(j, x, y, -1, -1, SQ); relax(j, x, y, 0, -1, 1); relax(j, x, y, 1, -1, SQ); }
  for (let y = ch - 1; y >= 0; y--) for (let x = cw - 1; x >= 0; x--) { const j = y * cw + x; relax(j, x, y, 1, 0, 1); relax(j, x, y, 1, 1, SQ); relax(j, x, y, 0, 1, 1); relax(j, x, y, -1, 1, SQ); }
  const limit = halfM / groundPixel / coarse;
  const s = new Uint16Array(W * H).fill(NO_S);
  for (let y = 0; y < H; y++) {
    const row = Math.floor(y / coarse) * cw;
    for (let x = 0; x < W; x++) { const j = row + Math.floor(x / coarse); if (dist[j] <= limit) s[y * W + x] = Math.min(NO_S - 1, Math.round(lab[j] / S_UNIT)); }
  }
  return s;
}

// ---- water surface as a function of s ------------------------------------------------------------------------------------------------
// points: [{ s, level }] (metres, m a.s.l.), any order. Linear between points; outside them either the slope of the nearest segment
// ('slope') or the end level ('flat').
export function interpolateLevel(points, s, extrapolate = 'slope') {
  const p = points.slice().sort((a, b) => a.s - b.s), n = p.length;
  if (!n) return NaN;
  if (n === 1) return p[0].level;
  if (s <= p[0].s) return extrapolate === 'flat' ? p[0].level : p[0].level + (p[1].level - p[0].level) / (p[1].s - p[0].s) * (s - p[0].s);
  if (s >= p[n - 1].s) return extrapolate === 'flat' ? p[n - 1].level : p[n - 1].level + (p[n - 1].level - p[n - 2].level) / (p[n - 1].s - p[n - 2].s) * (s - p[n - 1].s);
  let i = 1; while (p[i].s < s) i++;
  return p[i - 1].level + (p[i].level - p[i - 1].level) * (s - p[i - 1].s) / (p[i].s - p[i - 1].s);
}

// Level lookup table in decimetres indexed by s in S_UNIT. With `stepWeirs` the surface is flat inside each pool between two weirs (the
// level of a gauge in that pool, otherwise the interpolated level at the middle of the pool) and drops at the weirs; without it the surface
// is continuous, which is what a flood with open weirs looks like.
export function buildLevelLut({ points, sMax, weirs = [], stepWeirs = false, extrapolate = 'slope' }) {
  const units = Math.ceil(sMax / S_UNIT) + 1, lut = new Int32Array(units);
  const w = weirs.map(x => x.s).sort((a, b) => a - b);
  const pools = [-Infinity, ...w, Infinity];
  const poolLevel = k => {
    const lo = pools[k], hi = pools[k + 1];
    const inside = points.filter(p => p.s >= lo && p.s < hi);
    if (inside.length) return inside.reduce((a, p) => a + p.level, 0) / inside.length;
    const a = Number.isFinite(lo) ? lo : 0, b = Number.isFinite(hi) ? hi : sMax;
    return interpolateLevel(points, (a + b) / 2, extrapolate);
  };
  const poolLevels = stepWeirs ? pools.slice(0, -1).map((_, k) => poolLevel(k)) : null;
  let k = 0;
  for (let u = 0; u < units; u++) {
    const s = u * S_UNIT;
    if (stepWeirs) { while (k < w.length && s >= w[k]) k++; lut[u] = Math.round(poolLevels[k] * 10); }
    else lut[u] = Math.round(interpolateLevel(points, s, extrapolate) * 10);
  }
  return lut;
}

// ---- flood fill -----------------------------------------------------------------------------------------------------------------------------
// z: Uint16 terrain in dm (NODATA outside), s: Uint16 river coordinate (NO_S outside), lut: level in dm by s. seeds: cell indices.
export function floodCorridor(z, s, W, H, lut, seeds) {
  const N = W * H, mask = new Uint8Array(N), stack = new Int32Array(N);
  let sp = 0, count = 0, maxDepth = 0;
  const wet = i => { const si = s[i]; return z[i] !== NODATA && si !== NO_S && z[i] <= lut[si]; };
  for (const i of seeds) if (!mask[i] && wet(i)) { mask[i] = 1; stack[sp++] = i; }
  while (sp) {
    const i = stack[--sp];
    count++;
    const d = lut[s[i]] - z[i]; if (d > maxDepth) maxDepth = d;
    const x = i % W, y = (i - x) / W;
    for (let dy = -1; dy <= 1; dy++) {
      const ny = y + dy; if (ny < 0 || ny >= H) continue;
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx; if (nx < 0 || nx >= W) continue;
        const j = ny * W + nx;
        if (mask[j] || !wet(j)) continue;
        mask[j] = 1; stack[sp++] = j;
      }
    }
  }
  return { mask, count, maxDepthDm: maxDepth };
}

// Seeds along the river: for every centreline vertex (spaced ~spacing px) the lowest cell within `radius` px that is wet at its own level.
export function findSeeds(z, s, W, H, lut, linePx, radius = 12, spacing = 20) {
  const seeds = new Set();
  let acc = 0;
  for (let i = 0; i < linePx.length; i++) {
    if (i) acc += Math.hypot(linePx[i][0] - linePx[i - 1][0], linePx[i][1] - linePx[i - 1][1]);
    if (i && acc < spacing) continue; acc = 0;
    const cx = Math.round(linePx[i][0]), cy = Math.round(linePx[i][1]);
    let best = -1, bz = Infinity;
    for (let y = Math.max(0, cy - radius); y <= Math.min(H - 1, cy + radius); y++) for (let x = Math.max(0, cx - radius); x <= Math.min(W - 1, cx + radius); x++) {
      const j = y * W + x, v = z[j];
      if (v === NODATA || s[j] === NO_S || v > lut[s[j]] || v >= bz) continue;
      bz = v; best = j;
    }
    if (best >= 0) seeds.add(best);
  }
  return [...seeds];
}
