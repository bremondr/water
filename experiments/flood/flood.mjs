// "Bathtub with connectivity" flood extent on a terrain grid. Pure functions, used both by the browser page and the tests.
//
// Idea: the water surface is a plane at `levelDm`, optionally tilted along the river. A cell is flooded if the terrain there is
// below the plane AND it is connected (8 neighbours) to the river cell we start from. A low field behind a levee is therefore
// not flooded until the water gets over the levee, which a plain "everything below X" mask gets wrong.
//
// What this ignores: curvature of the water surface (it is a plane), flow velocity, culverts and bridges, levees that are too
// thin for the grid, weirs that step the surface, and dynamics (how long the water stays). It shows "where would water at this
// level reach in this terrain", not a forecast.

// z: Uint16Array of heights in decimetres (noData = 65535), row-major, row 0 = north.
export function lowestNear(z, width, height, cx, cy, radius, noData = 65535) {
  let best = -1, bestZ = Infinity;
  const r2 = radius * radius;
  for (let y = Math.max(0, cy - radius); y <= Math.min(height - 1, cy + radius); y++)
    for (let x = Math.max(0, cx - radius); x <= Math.min(width - 1, cx + radius); x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > r2) continue;
      const v = z[y * width + x];
      if (v !== noData && v < bestZ) { bestZ = v; best = y * width + x; }
    }
  return best;                                       // index, or -1
}

// Water level (dm) at pixel (x, y): the level at the gauge pixel (cx, cy) plus a linear tilt, gx and gy in dm per pixel.
export const levelAt = (levelDm, tilt, cx, cy, x, y) => (tilt ? levelDm + tilt.gx * (x - cx) + tilt.gy * (y - cy) : levelDm);

// Flood fill from `seed` over all connected cells below the water plane. Optionally limited to a radius around (cx, cy), which
// keeps a flat plane from being applied kilometres away from the gauge.
//   tilt: { gx, gy, cx, cy } makes the plane slope (level rises by gx per pixel in x, gy per pixel in y, from the gauge pixel)
export function floodFill(z, width, height, seed, levelDm, { noData = 65535, limit = null, tilt = null } = {}) {
  const mask = new Uint8Array(width * height);
  const lvl = (x, y) => (tilt ? levelDm + tilt.gx * (x - tilt.cx) + tilt.gy * (y - tilt.cy) : levelDm);
  if (seed < 0 || z[seed] === noData) return { mask, count: 0, maxDepthDm: 0 };
  const sx = seed % width, sy = (seed - sx) / width;
  if (z[seed] > lvl(sx, sy)) return { mask, count: 0, maxDepthDm: 0 };
  const stack = new Int32Array(width * height);
  let sp = 0, count = 0, maxDepth = 0;
  const r2 = limit ? limit.radius * limit.radius : Infinity;
  const take = i => { mask[i] = 1; stack[sp++] = i; };
  take(seed);
  while (sp) {
    const i = stack[--sp];
    count++;
    const x = i % width, y = (i - x) / width;
    const d = lvl(x, y) - z[i]; if (d > maxDepth) maxDepth = d;
    for (let dy = -1; dy <= 1; dy++) {
      const ny = y + dy; if (ny < 0 || ny >= height) continue;
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx; if (nx < 0 || nx >= width) continue;
        const j = ny * width + nx;
        if (mask[j]) continue;
        const v = z[j];
        if (v === noData || v > lvl(nx, ny)) continue;
        if (limit && (nx - limit.cx) ** 2 + (ny - limit.cy) ** 2 > r2) continue;
        take(j);
      }
    }
  }
  return { mask, count, maxDepthDm: maxDepth };
}

// Convenience: flood for a stage on the gauge (cm) given the gauge zero (m a.s.l.).
export function floodForStage({ z, width, height, cx, cy, zeroM, stageCm, seedRadius = 40, limitRadius = null, tilt = null, noData = 65535 }) {
  const levelDm = Math.round((zeroM + stageCm / 100) * 10);
  const seed = lowestNear(z, width, height, cx, cy, seedRadius, noData);
  const t = tilt ? { ...tilt, cx, cy } : null;
  const res = floodFill(z, width, height, seed, levelDm, { noData, limit: limitRadius ? { cx, cy, radius: limitRadius } : null, tilt: t });
  return { ...res, levelDm, seed };
}

// Direction of the river channel near the seed: the principal axis of the connected cells within 0.3 m of the seed's height
// (the DEM flattens the river at its survey level, so this is the channel). Returns { ux, uy } (unit vector, sign arbitrary)
// or null when the channel is too small to tell.
export function channelAxis(z, width, height, seed, radiusPx, noData = 65535) {
  if (seed < 0) return null;
  const sx = seed % width, sy = (seed - sx) / width;
  const res = floodFill(z, width, height, seed, z[seed] + 3, { noData, limit: { cx: sx, cy: sy, radius: radiusPx } });
  if (res.count < 200) return null;
  let n = 0, mx = 0, my = 0;
  for (let i = 0; i < res.mask.length; i++) if (res.mask[i]) { mx += i % width; my += Math.floor(i / width); n++; }
  mx /= n; my /= n;
  let sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < res.mask.length; i++) if (res.mask[i]) { const dx = (i % width) - mx, dy = Math.floor(i / width) - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { ux: Math.cos(theta), uy: Math.sin(theta) };
}

// Tilt for a water surface that rises by `slopeCmPerKm` going upstream along `axis` (pointing upstream, unit, pixel space).
export function tiltFromSlope(slopeCmPerKm, axis, groundPixelM) {
  const dmPerPixel = slopeCmPerKm / 10 * (groundPixelM / 1000);          // cm -> dm, km -> pixel
  return { gx: dmPerPixel * axis.ux, gy: dmPerPixel * axis.uy };
}

// Flip an axis so that it points from (fx, fy) towards (tx, ty).
export function orient(axis, fx, fy, tx, ty) {
  return (axis.ux * (tx - fx) + axis.uy * (ty - fy)) >= 0 ? axis : { ux: -axis.ux, uy: -axis.uy };
}

// How well does the modelled flood agree with an official zone? Both are masks over the same grid. Zone cells that belong to
// other rivers in the window are never reachable by a flood from this station, so recall is a lower bound.
//   bit: which bit of `zones` to test; region: optional { cx, cy, radius } circle (pixels) to compare inside
export function compareWithZone(flood, zones, bit, region = null) {
  const width = Math.round(Math.sqrt(flood.length)), r2 = region ? region.radius ** 2 : Infinity;
  let zoneCells = 0, floodCells = 0, both = 0;
  for (let i = 0; i < flood.length; i++) {
    if (region) { const x = i % width, y = (i - x) / width; if ((x - region.cx) ** 2 + (y - region.cy) ** 2 > r2) continue; }
    const f = flood[i] === 1, zc = (zones[i] & bit) !== 0;
    if (f) floodCells++;
    if (zc) zoneCells++;
    if (f && zc) both++;
  }
  const union = floodCells + zoneCells - both;
  return { zoneCells, floodCells, both, precision: floodCells ? both / floodCells : null, recall: zoneCells ? both / zoneCells : null, iou: union ? both / union : null };
}

// Pixel position of a point in a dataset written by scripts/fetch-dem.mjs. The grid is Web Mercator, so x is linear in
// longitude and y is linear in the mercator y of the latitude.
export function pixelOf(meta, lon, lat) {
  const my = a => Math.log(Math.tan(Math.PI / 4 + a * Math.PI / 360));
  const { west, south, east, north } = meta.bounds;
  return {
    x: Math.round((lon - west) / (east - west) * meta.width),
    y: Math.round((my(north) - my(lat)) / (my(north) - my(south)) * meta.height),
  };
}
