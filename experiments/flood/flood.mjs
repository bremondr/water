// "Bathtub with connectivity" flood extent on a terrain grid. Pure functions, used both by the browser page and the tests.
//
// Idea: the water surface is a flat plane at `levelDm`. A cell is flooded if the terrain there is below the plane AND it
// is connected (8 neighbours) to the river cell we start from. A low field behind a levee is therefore not flooded
// until the water gets over the levee, which is what a plain "everything below X" mask gets wrong.
//
// What this ignores: the slope of the water surface along the river (the plane is flat, so the error grows with distance from
// the gauge), flow velocity, culverts and bridges, levees that are too thin for the grid, and dynamics (how long the
// water stays). It shows "where would water at this level reach in this terrain", not a forecast.

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

// Flood fill from `seed` over all connected cells with z <= levelDm. Optionally limited to a radius around (cx, cy),
// which keeps a flat water plane from being applied kilometres away from the gauge.
export function floodFill(z, width, height, seed, levelDm, { noData = 65535, limit = null } = {}) {
  const mask = new Uint8Array(width * height);
  if (seed < 0 || z[seed] === noData || z[seed] > levelDm) return { mask, count: 0, maxDepthDm: 0 };
  const stack = new Int32Array(width * height);
  let sp = 0, count = 0, maxDepth = 0;
  const r2 = limit ? limit.radius * limit.radius : Infinity;
  const take = i => { mask[i] = 1; stack[sp++] = i; };
  take(seed);
  while (sp) {
    const i = stack[--sp];
    count++;
    const d = levelDm - z[i]; if (d > maxDepth) maxDepth = d;
    const x = i % width, y = (i - x) / width;
    for (let dy = -1; dy <= 1; dy++) {
      const ny = y + dy; if (ny < 0 || ny >= height) continue;
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx; if (nx < 0 || nx >= width) continue;
        const j = ny * width + nx;
        if (mask[j]) continue;
        const v = z[j];
        if (v === noData || v > levelDm) continue;
        if (limit && (nx - limit.cx) ** 2 + (ny - limit.cy) ** 2 > r2) continue;
        take(j);
      }
    }
  }
  return { mask, count, maxDepthDm: maxDepth };
}

// Convenience: flood for a stage on the gauge (cm) given the gauge zero (m a.s.l.).
export function floodForStage({ z, width, height, cx, cy, zeroM, stageCm, seedRadius = 40, limitRadius = null, noData = 65535 }) {
  const levelDm = Math.round((zeroM + stageCm / 100) * 10);
  const seed = lowestNear(z, width, height, cx, cy, seedRadius, noData);
  const res = floodFill(z, width, height, seed, levelDm, { noData, limit: limitRadius ? { cx, cy, radius: limitRadius } : null });
  return { ...res, levelDm, seed };
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
