// Builds the terrain corridor along a river for the corridor flood model (experiments/flood/).
//   node scripts/fetch-corridor.mjs [river=Labe] [from=<station id>] [to=<station id>] [padDown=2000] [padUp=10000] [half=3000] [pixel=8]
// The corridor runs from `padDown` m downstream of the `from` gauge to `padUp` m upstream of the `to` gauge and is `half` m wide either side
// of the river centreline. Writes experiments/flood/data/corridor-<river>/ : manifest.json, z.bin (terrain, Uint16 dm), s.bin (river
// coordinate, Uint16 x 10 m), zones.bin (official flood zones, bit per layer). The data folder is gitignored: re-create it with this script.
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { fetchDem } from '../dem.mjs';
import { fetchReaches, chainReaches, cumulative, project, haversine } from '../river.mjs';
import { corridorGrid, toPixel, labelCorridor, S_UNIT, NO_S, NODATA } from '../corridor.mjs';
import { fetchZoneFeatures, rasterizeFeatures, ZONE_LAYERS } from '../zones.mjs';
import { WEIRS } from '../weirs.mjs';

const arg = Object.fromEntries(process.argv.slice(2).map(a => a.split('=')));
const river = arg.river ?? 'Labe', fromId = arg.from ?? '0-203-1-221000', toId = arg.to ?? '0-203-1-204000';
const padDown = +(arg.padDown ?? 2000), padUp = +(arg.padUp ?? 10000), half = +(arg.half ?? 3000), pixel = +(arg.pixel ?? 8), T = 2048;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ---- stations on the river -----------------------------------------------------------------------------------------------------------
const meta = (await (await fetch('https://opendata.chmi.cz/hydrology/now/metadata/meta3.json')).json()).data.data;
const col = Object.fromEntries(meta.header.split(',').map((c, i) => [c, i]));
const stations = meta.values.filter(v => v[col.STREAM_NAME] === river && v[col.RICKM] != null && v[col.WGS_ELE] != null)
  .map(v => ({ id: v[col.objID], name: v[col.STATION_NAME], rkm: v[col.RICKM], lat: v[col.GEOGR1], lon: v[col.GEOGR2], zero: v[col.WGS_ELE], spaH: [v[col.SPA1H], v[col.SPA2H], v[col.SPA3H], v[col.SPA4H]] }));
const from = stations.find(s => s.id === fromId), to = stations.find(s => s.id === toId);
if (!from || !to) throw new Error('from/to station not found on ' + river);
const kmLo = Math.min(from.rkm, to.rkm) - padDown / 1000 - 4, kmHi = Math.max(from.rkm, to.rkm) + padUp / 1000 + 6;   // gauges just beyond the ends are kept as anchors

// ---- centreline ----------------------------------------------------------------------------------------------------------------------------
const lons = [from.lon, to.lon], lats = [from.lat, to.lat];
const reaches = await fetchReaches(river, { south: Math.min(...lats) - 0.4, west: Math.min(...lons) - 0.4, north: Math.max(...lats) + 0.4, east: Math.max(...lons) + 0.4 });
const { line, reaches: used } = chainReaches(reaches, kmLo, kmHi);       // ordered upstream -> downstream
const cum = cumulative(line);
const sFrom = project(line, cum, from.lon, from.lat), sTo = project(line, cum, to.lon, to.lat);
const sDownChain = Math.max(sFrom.s, sTo.s) + padDown, sUpChain = Math.min(sFrom.s, sTo.s) - padUp;
if (sUpChain < 0 || sDownChain > cum.at(-1)) throw new Error('corridor is longer than the centreline chain');
// corridor part of the line with exact end points; s (model coordinate) = metres upstream of the downstream end
const part = [];
const at = sc => { let i = 1; while (cum[i] < sc) i++; const t = (sc - cum[i - 1]) / (cum[i] - cum[i - 1]); return [line[i - 1][0] + (line[i][0] - line[i - 1][0]) * t, line[i - 1][1] + (line[i][1] - line[i - 1][1]) * t]; };
part.push({ p: at(sUpChain), s: sDownChain - sUpChain });
for (let i = 0; i < line.length; i++) if (cum[i] > sUpChain && cum[i] < sDownChain) part.push({ p: line[i], s: sDownChain - cum[i] });
part.push({ p: at(sDownChain), s: 0 });
const length = sDownChain - sUpChain;
log(`${river}: ${used.map(r => `${r.zuid} km ${r.kmP}-${r.kmK}`).join(', ')}; corridor ${(length / 1000).toFixed(1)} km, ${part.length} centreline vertices`);

// ---- grid and terrain -----------------------------------------------------------------------------------------------------------------------
const g = corridorGrid(part.map(v => v.p), half, pixel);
log(`grid ${g.W} x ${g.H} = ${(g.W * g.H / 1e6).toFixed(0)} M cells at ${g.groundPixel.toFixed(2)} m`);
const linePx = part.map(v => { const [x, y] = toPixel(g, ...v.p); return [x, y, v.s]; });
const s = labelCorridor(g.W, g.H, g.groundPixel, linePx, half);
let inCorridor = 0; for (let i = 0; i < s.length; i++) if (s[i] !== NO_S) inCorridor++;
log(`${(inCorridor / 1e6).toFixed(1)} M cells inside the corridor (${(100 * inCorridor / s.length).toFixed(0)} % of the grid)`);

const z = new Uint16Array(g.W * g.H).fill(NODATA);
let tiles = 0;
for (let ty = 0; ty * T < g.H; ty++) for (let tx = 0; tx * T < g.W; tx++) {
  const x0 = tx * T, y0 = ty * T, w = Math.min(T, g.W - x0), h = Math.min(T, g.H - y0);
  let any = false;                                         // skip tiles without corridor cells
  for (let y = y0; y < y0 + h && !any; y += 4) for (let x = x0; x < x0 + w; x += 4) if (s[y * g.W + x] !== NO_S) { any = true; break; }
  if (!any) continue;
  const win = { bbox: [g.x0 + x0 * g.pix, g.y0 - (y0 + h) * g.pix, g.x0 + (x0 + w) * g.pix, g.y0 - y0 * g.pix], width: w, height: h };
  const dem = await fetchDem(win);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y0 + y) * g.W + x0 + x, v = dem.data[y * w + x];
    if (s[i] !== NO_S && Number.isFinite(v)) z[i] = Math.round(v * 10);
  }
  tiles++; log(`terrain tile ${tx},${ty} (${w} x ${h}) done`);
}

// ---- official flood zones --------------------------------------------------------------------------------------------------------------------
const zones = new Uint8Array(g.W * g.H), zoneCounts = {};
const [wLon] = [Math.min(...part.map(v => v.p[0])) - 0.06], sLat = Math.min(...part.map(v => v.p[1])) - 0.05, eLon = Math.max(...part.map(v => v.p[0])) + 0.06, nLat = Math.max(...part.map(v => v.p[1])) + 0.05;
for (const [layer, bit] of ZONE_LAYERS) {
  try {
    const features = await fetchZoneFeatures(layer, { south: sLat, west: wLon, north: nLat, east: eLon });
    rasterizeFeatures(features, (lon, lat) => toPixel(g, lon, lat), g.W, g.H, bit, zones, { fixDatum: true });
    zoneCounts[layer] = features.length; log(`zones ${layer}: ${features.length} features`);
  } catch (e) { log(`zones ${layer} skipped: ${e.message}`); }
}

// ---- gauges, weirs and flood events on the corridor ------------------------------------------------------------------------------------------------
const gauges = stations.filter(st => st.rkm >= kmLo && st.rkm <= kmHi).map(st => {
  const p = project(line, cum, st.lon, st.lat);
  return { ...st, s: Math.round(sDownChain - p.s), offRiver: Math.round(p.dist) };
}).sort((a, b) => a.s - b.s);
log('gauges:', gauges.map(x => `${x.name} s=${(x.s / 1000).toFixed(1)} km (off ${x.offRiver} m)`).join('; '));

const weirList = [];
try { for (const w of JSON.parse(await readFile(new URL('../weirs-nodata.json', import.meta.url), 'utf8'))) weirList.push({ key: w.key, name: w.name, lat: w.lat, lon: w.lon, rkm: w.rkm, live: false }); } catch { /* optional */ }
for (const w of WEIRS) weirList.push({ key: w.key, name: w.name, lat: w.lat, lon: w.lon, rkm: null, live: true });
const weirs = weirList.map(w => { const p = project(line, cum, w.lon, w.lat); return { ...w, s: Math.round(sDownChain - p.s), offRiver: Math.round(p.dist) }; })
  .filter(w => w.offRiver < 600 && w.s > -1500 && w.s < length + 1500).sort((a, b) => a.s - b.s);
log('weirs:', weirs.map(w => `${w.name} s=${(w.s / 1000).toFixed(1)} km`).join('; '));

const H = 'https://opendata.chmi.cz/hydrology/historical/data';
const EVENTS = { '2002-08': ['2002-08-05', '2002-08-25'], '2006-04': ['2006-03-25', '2006-04-15'], '2013-06': ['2013-05-30', '2013-06-15'], '2024-09': ['2024-09-12', '2024-09-25'] };
const events = {};
for (const gg of gauges) {
  for (const [name, [d0, d1]] of Object.entries(EVENTS)) {
    const y = +d0.slice(0, 4);
    for (const [folder, code] of [['measured_water_level', 'OH'], ['hourly', 'HQ']]) {
      try {
        const doc = await (await fetch(`${H}/${folder}/H_${gg.id}_${code}_${y}.json`, { signal: AbortSignal.timeout(60_000) })).json();
        if (doc?.tsList?.[0]?.unit !== 'CM') continue;                // some series carry discharge, ignore those
        for (const [dt, v] of doc.tsList[0].tsData.data.values) if (typeof v === 'number' && dt >= d0 && dt <= d1 + 'T23' && (!events[name]?.[gg.id] || v > events[name][gg.id].cm)) (events[name] ??= {})[gg.id] = { cm: v, dt: dt.slice(0, 16) };
      } catch { /* no data for that year */ }
    }
  }
}
log('events:', Object.entries(events).map(([n, v]) => `${n}: ${Object.keys(v).length} gauges`).join(', '));

// ---- write ----------------------------------------------------------------------------------------------------------------------------------------
const dir = new URL(`../experiments/flood/data/corridor-${river.toLowerCase()}/`, import.meta.url);
await mkdir(dir, { recursive: true });
await writeFile(new URL('z.bin', dir), Buffer.from(z.buffer));
await writeFile(new URL('s.bin', dir), Buffer.from(s.buffer));
await writeFile(new URL('zones.bin', dir), Buffer.from(zones.buffer));
await writeFile(new URL('manifest.json', dir), JSON.stringify({
  river, W: g.W, H: g.H, x0: g.x0, y0: g.y0, pix: g.pix, lat0: g.lat0, groundPixel: g.groundPixel, halfM: half, sUnit: S_UNIT, noData: NODATA, noS: NO_S,
  length, reaches: used, centerline: linePx.map(([x, y, sv]) => [+x.toFixed(1), +y.toFixed(1), Math.round(sv)]), gauges, weirs, events,
  zones: { bits: Object.fromEntries(ZONE_LAYERS.map(([n, b]) => [n.replace('ZaplavUzemi_', ''), b])), counts: zoneCounts },
  sources: 'ČÚZK DMR 5G; VÚV TGM (flood zones, river reaches); ČHMÚ (gauges, history)', fetched: new Date().toISOString(),
}));
log(`written to experiments/flood/data/corridor-${river.toLowerCase()}/ (${tiles} terrain tiles)`);
