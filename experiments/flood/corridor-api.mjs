// Server side of the corridor flood experiment: holds the corridor terrain in memory, computes a flood for a scenario (a water surface
// built from the levels of the gauges along the river) and serves the result as Web Mercator map tiles, so the browser never has to
// load the ~150 MB of rasters.
//   GET /experiments/flood/api/corridor                    gauges, weirs, events, bounds, zone area
//   GET /experiments/flood/api/scenario?source=now|2002-08|...&offset=<cm>&extrap=slope|flat&weirs=0|1
//   GET /experiments/flood/tiles/<scenarioId>/<z>/<x>/<y>.png        flood depth
//   GET /experiments/flood/zonetiles/<z>/<x>/<y>.png?bits=4,16      outlines of official zones
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { buildLevelLut, floodCorridor, findSeeds, fromPixel, S_UNIT, NO_S, NODATA } from '../../corridor.mjs';
import { encodePng } from '../../png.mjs';

const R = 6378137, WORLD = 2 * Math.PI * R;
const ZONE_COLORS = { 1: [74, 20, 140], 2: [239, 108, 0], 4: [183, 28, 28], 8: [109, 76, 65], 16: [0, 0, 0] };

// depth (dm) -> RGBA, same ramp as the single-station page: light cyan for shallow to dark blue for deep, capped at 6 m
const stops = [[0, [155, 231, 255, 170]], [10, [63, 169, 245, 200]], [30, [29, 95, 209, 225]], [60, [26, 42, 140, 240]]];
const DEPTH = new Uint8ClampedArray(61 * 4);
for (let d = 0; d <= 60; d++) {
  let k = 0; while (k < stops.length - 2 && d > stops[k + 1][0]) k++;
  const [d0, c0] = stops[k], [d1, c1] = stops[k + 1], f = Math.min(1, Math.max(0, (d - d0) / (d1 - d0)));
  for (let c = 0; c < 4; c++) DEPTH[d * 4 + c] = c0[c] + (c1[c] - c0[c]) * f;
}

export function createCorridorService({ dir, getStations }) {
  let C = null;
  const scenarios = new Map();           // id -> { mask, lut, info }

  function load() {
    if (C) return C;
    if (!existsSync(new URL('manifest.json', dir))) return null;
    const m = JSON.parse(readFileSync(new URL('manifest.json', dir)));
    const u16 = f => { const b = readFileSync(new URL(f, dir)); return new Uint16Array(b.buffer, b.byteOffset, b.byteLength / 2); };
    const z = u16('z.bin'), s = u16('s.bin'), zb = readFileSync(new URL('zones.bin', dir)), zones = new Uint8Array(zb.buffer, zb.byteOffset, zb.byteLength);
    let n = 0; for (let i = 0; i < s.length; i++) if (s[i] !== NO_S) n++;
    const idx = new Int32Array(n); n = 0;
    for (let i = 0; i < s.length; i++) if (s[i] !== NO_S) idx[n++] = i; else zones[i] = 0;       // zones only inside the corridor
    const cell = m.groundPixel * m.groundPixel / 1e6;
    const corners = { nw: fromPixel(m, 0, 0), se: fromPixel(m, m.W, m.H) };
    const zoneArea = {}; for (const [name, bit] of Object.entries(m.zones.bits)) { let c = 0; for (let k = 0; k < idx.length; k++) if (zones[idx[k]] & bit) c++; zoneArea[name] = +(c * cell).toFixed(2); }
    C = { m, z, s, zones, idx, cell, zoneArea, bounds: { west: corners.nw[0], north: corners.nw[1], east: corners.se[0], south: corners.se[1] } };
    return C;
  }

  const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };

  async function nowLevels(c) {
    const out = {};
    try {
      const stations = JSON.parse(await getStations()).stations;
      for (const g of c.m.gauges) { const st = stations.find(x => x.id === g.id), h = st?.H.at(-1)?.[1]; if (h != null) out[g.id] = { cm: h, dt: new Date(st.H.at(-1)[0] * 1000).toISOString().slice(0, 16) }; }
    } catch { /* live data unavailable */ }
    return out;
  }

  async function scenario(c, q) {
    const source = q.get('source') || 'now', offset = +(q.get('offset') || 0) || 0, extrap = q.get('extrap') === 'flat' ? 'flat' : 'slope', steps = q.get('weirs') === '1';
    const peaks = source === 'now' ? await nowLevels(c) : c.m.events[source];
    if (!peaks) return { error: `unknown source ${source}` };
    const points = c.m.gauges.filter(g => peaks[g.id]).map(g => ({ id: g.id, name: g.name, s: g.s, cm: peaks[g.id].cm + offset, level: g.zero + (peaks[g.id].cm + offset) / 100, dt: peaks[g.id].dt }));
    if (points.length < 1) return { error: 'no gauge has data for this source' };
    const id = createHash('sha1').update(JSON.stringify([source, offset, extrap, steps, points.map(p => [p.id, p.cm])])).digest('hex').slice(0, 12);
    if (scenarios.has(id)) { const sc = scenarios.get(id); scenarios.delete(id); scenarios.set(id, sc); return sc.info; }
    const t0 = performance.now(), sMax = c.m.length + 1000;
    const weirs = c.m.weirs.filter(w => !w.live);
    const lut = buildLevelLut({ points, sMax, weirs, stepWeirs: steps, extrapolate: extrap });
    const seeds = findSeeds(c.z, c.s, c.m.W, c.m.H, lut, c.m.centerline, Math.round(100 / c.m.groundPixel), Math.round(160 / c.m.groundPixel));
    const r = floodCorridor(c.z, c.s, c.m.W, c.m.H, lut, seeds);
    // agreement with each official zone, over the corridor cells
    const bits = c.m.zones.bits, acc = Object.fromEntries(Object.keys(bits).map(k => [k, [0, 0]]));       // [zone cells, both]
    for (let k = 0; k < c.idx.length; k++) {
      const i = c.idx[k], zb = c.zones[i];
      if (!zb) continue;
      const f = r.mask[i];
      for (const name in bits) if (zb & bits[name]) { acc[name][0]++; if (f) acc[name][1]++; }
    }
    const zones = {};
    for (const name in bits) {
      const [zc, both] = acc[name], union = r.count + zc - both;
      zones[name] = { zoneKm2: +(zc * c.cell).toFixed(1), inZone: r.count ? both / r.count : null, covered: zc ? both / zc : null, iou: union && zc ? both / union : null };
    }
    const profile = []; for (let sm = 0; sm <= sMax; sm += 500) profile.push([sm, lut[Math.min(lut.length - 1, Math.round(sm / S_UNIT))] / 10]);
    const info = {
      id, source, offset, extrap, weirsStepped: steps, points, profile,
      areaKm2: +(r.count * c.cell).toFixed(2), maxDepthM: +(r.maxDepthDm / 10).toFixed(1), seeds: seeds.length, ms: Math.round(performance.now() - t0), zones,
    };
    scenarios.set(id, { mask: r.mask, lut, info });
    while (scenarios.size > 4) scenarios.delete(scenarios.keys().next().value);
    return info;
  }

  // tile helpers: raster pixel of every tile pixel
  const tileBox = (z, x, y) => { const size = WORLD / 2 ** z; return { mx0: -WORLD / 2 + x * size, myTop: WORLD / 2 - y * size, size }; };

  function depthTile(c, sc, z, x, y) {
    const { mx0, myTop, size } = tileBox(z, x, y), { m } = c, rgba = new Uint8ClampedArray(256 * 256 * 4);
    for (let py = 0; py < 256; py++) {
      const ry = Math.floor((m.y0 - (myTop - (py + 0.5) / 256 * size)) / m.pix);
      if (ry < 0 || ry >= m.H) continue;
      for (let px = 0; px < 256; px++) {
        const rx = Math.floor(((mx0 + (px + 0.5) / 256 * size) - m.x0) / m.pix);
        if (rx < 0 || rx >= m.W) continue;
        const i = ry * m.W + rx;
        if (!sc.mask[i]) continue;
        const d = Math.min(60, Math.max(0, sc.lut[c.s[i]] - c.z[i])) * 4, o = (py * 256 + px) * 4;
        rgba[o] = DEPTH[d]; rgba[o + 1] = DEPTH[d + 1]; rgba[o + 2] = DEPTH[d + 2]; rgba[o + 3] = DEPTH[d + 3];
      }
    }
    return encodePng(256, 256, rgba);
  }

  function zoneTile(c, z, x, y, bits) {
    const { mx0, myTop, size } = tileBox(z, x, y), { m } = c, B = 2, N = 256 + 2 * B, grid = new Uint8Array(N * N);
    for (let py = 0; py < N; py++) {
      const ry = Math.floor((m.y0 - (myTop - (py - B + 0.5) / 256 * size)) / m.pix);
      if (ry < 0 || ry >= m.H) continue;
      for (let px = 0; px < N; px++) {
        const rx = Math.floor(((mx0 + (px - B + 0.5) / 256 * size) - m.x0) / m.pix);
        if (rx >= 0 && rx < m.W) grid[py * N + px] = c.zones[ry * m.W + rx];
      }
    }
    const rgba = new Uint8ClampedArray(256 * 256 * 4);
    for (const bit of bits) {
      const col = ZONE_COLORS[bit]; if (!col) continue;
      for (let py = 0; py < 256; py++) for (let px = 0; px < 256; px++) {
        const g = (py + B) * N + px + B;
        if (!(grid[g] & bit)) continue;
        if ((grid[g - 2] & bit) && (grid[g + 2] & bit) && (grid[g - 2 * N] & bit) && (grid[g + 2 * N] & bit) && (grid[g - 1] & bit) && (grid[g + 1] & bit) && (grid[g - N] & bit) && (grid[g + N] & bit)) continue;
        const o = (py * 256 + px) * 4; rgba[o] = col[0]; rgba[o + 1] = col[1]; rgba[o + 2] = col[2]; rgba[o + 3] = 255;
      }
    }
    return encodePng(256, 256, rgba);
  }

  // returns true when the request was for this service
  return async function handle(req, res) {
    const url = new URL(req.url, 'http://x'), p = url.pathname;
    if (!p.startsWith('/experiments/flood/api/') && !p.startsWith('/experiments/flood/tiles/') && !p.startsWith('/experiments/flood/zonetiles/')) return false;
    try {
      const c = load();
      if (!c) { json(res, 404, { error: 'no corridor data: run node scripts/fetch-corridor.mjs' }); return true; }
      if (p === '/experiments/flood/api/corridor') {
        const now = await nowLevels(c);
        json(res, 200, {
          river: c.m.river, lengthM: c.m.length, groundPixel: c.m.groundPixel, bounds: c.bounds, zoneKm2: c.zoneArea, zoneBits: c.m.zones.bits, fetched: c.m.fetched,
          gauges: c.m.gauges.map(g => ({ id: g.id, name: g.name, rkm: g.rkm, s: g.s, zero: g.zero, spaH: g.spaH, lat: g.lat, lon: g.lon, now: now[g.id] ?? null })),
          weirs: c.m.weirs, events: Object.fromEntries(Object.entries(c.m.events).map(([k, v]) => [k, v])),
        });
        return true;
      }
      if (p === '/experiments/flood/api/scenario') { const info = await scenario(c, url.searchParams); json(res, info.error ? 400 : 200, info); return true; }
      let mt;
      if ((mt = /^\/experiments\/flood\/tiles\/([0-9a-f]+)\/(\d+)\/(\d+)\/(\d+)\.png$/.exec(p))) {
        const sc = scenarios.get(mt[1]);
        if (!sc) { res.writeHead(404); res.end('scenario expired, recompute'); return true; }
        res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=3600' }); res.end(depthTile(c, sc, +mt[2], +mt[3], +mt[4])); return true;
      }
      if ((mt = /^\/experiments\/flood\/zonetiles\/(\d+)\/(\d+)\/(\d+)\.png$/.exec(p))) {
        const bits = (url.searchParams.get('bits') || '').split(',').map(Number).filter(Boolean);
        res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=3600' }); res.end(zoneTile(c, +mt[1], +mt[2], +mt[3], bits)); return true;
      }
      json(res, 404, { error: 'not found' });
    } catch (e) { json(res, 500, { error: String(e.message ?? e) }); }
    return true;
  };
}
