// Builds the terrain corridor along a river and short stretches of its tributaries for the corridor flood model (experiments/flood/).
//   node scripts/fetch-corridor.mjs [pixel=10] [half=3000] [from=<station id>] [to=<station id>] [padDown=500] [padUp=3000]
// Main river: Labe from the `from` gauge (default Hřensko, at the German border) to the `to` gauge (default Nymburk). Tributaries (see TRIBS):
// the Ohře from its mouth at Terezín and the Vltava from its mouth at Mělník, each a few tens of km up. Every reach is `half` m wide either
// side of its centreline. Writes experiments/flood/data/corridor-<river>/ : manifest.json, z.bin (terrain, Uint16 dm), s.bin (river
// coordinate, Uint16 x 10 m), r.bin (reach id per cell), zones.bin (official flood zones, bit per layer). The data folder is gitignored.
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { fetchDem } from '../dem.mjs';
import { fetchReaches, chainReaches, cumulative, project, haversine } from '../river.mjs';
import { corridorGrid, toPixel, labelReaches, S_UNIT, NO_S, NO_R, NODATA } from '../corridor.mjs';
import { fetchZoneFeatures, rasterizeFeatures, ZONE_LAYERS } from '../zones.mjs';
import { WEIRS } from '../weirs.mjs';

const arg = Object.fromEntries(process.argv.slice(2).map(a => a.split('=')));
const river = 'Labe', fromId = arg.from ?? '0-203-1-245000', toId = arg.to ?? '0-203-1-080000';
const padDown = +(arg.padDown ?? 500), padUp = +(arg.padUp ?? 3000), half = +(arg.half ?? 3000), pixel = +(arg.pixel ?? 10), T = 2048;
// tributaries: kmUp = how far up from the mouth the corridor goes, anchorKm = gauges up to this km are used for the water surface (farther
// anchors give the slope beyond the corridor), gaugeIds = gauges whose river km is not in the ČHMÚ metadata
const TRIBS = [
  { id: 'ohre', river: 'Ohře', kmUp: 16, anchorKm: 56, half, gaugeIds: ['0-203-1-219500'] },   // Terezín gauge (km null in the metadata); Louny at km 53 anchors the slope
  { id: 'vltava', river: 'Vltava', kmUp: 26, anchorKm: 62, half, gaugeIds: [] },                 // Vraňany at km 10.8, the Prague gauges at km 52-60 anchor the slope
];
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ---- stations ------------------------------------------------------------------------------------------------------------------------------
const meta = (await (await fetch('https://opendata.chmi.cz/hydrology/now/metadata/meta3.json')).json()).data.data;
const col = Object.fromEntries(meta.header.split(',').map((c, i) => [c, i]));
const stations = meta.values.filter(v => v[col.WGS_ELE] != null).map(v => ({ id: v[col.objID], name: v[col.STATION_NAME], river: v[col.STREAM_NAME], rkm: v[col.RICKM], lat: v[col.GEOGR1], lon: v[col.GEOGR2], zero: v[col.WGS_ELE], spaH: [v[col.SPA1H], v[col.SPA2H], v[col.SPA3H], v[col.SPA4H]] }));
const from = stations.find(s => s.id === fromId), to = stations.find(s => s.id === toId);
if (!from || !to) throw new Error('from/to station not found');
const kmLo = Math.min(from.rkm, to.rkm) - padDown / 1000 - 2, kmHi = Math.max(from.rkm, to.rkm) + padUp / 1000 + 6;

// ---- main river centreline -----------------------------------------------------------------------------------------------------------------
const lons = [from.lon, to.lon], lats = [from.lat, to.lat];
const bboxAll = { south: Math.min(...lats) - 0.4, west: Math.min(...lons) - 0.4, north: Math.max(...lats) + 0.4, east: Math.max(...lons) + 0.4 };
const { line, reaches: used } = chainReaches(await fetchReaches(river, bboxAll), kmLo, kmHi);       // ordered upstream -> downstream
const cum = cumulative(line);
const sFrom = project(line, cum, from.lon, from.lat), sTo = project(line, cum, to.lon, to.lat);
const sDownChain = Math.min(cum.at(-1), Math.max(sFrom.s, sTo.s) + padDown), sUpChain = Math.max(0, Math.min(sFrom.s, sTo.s) - padUp);
const at = (ln, cm, sc) => { let i = 1; while (i < cm.length - 1 && cm[i] < sc) i++; const t = (sc - cm[i - 1]) / (cm[i] - cm[i - 1]); return [ln[i - 1][0] + (ln[i][0] - ln[i - 1][0]) * t, ln[i - 1][1] + (ln[i][1] - ln[i - 1][1]) * t]; };
const mainPart = [{ p: at(line, cum, sUpChain), s: sDownChain - sUpChain }];
for (let i = 0; i < line.length; i++) if (cum[i] > sUpChain && cum[i] < sDownChain) mainPart.push({ p: line[i], s: sDownChain - cum[i] });
mainPart.push({ p: at(line, cum, sDownChain), s: 0 });
const mainLength = sDownChain - sUpChain;
log(`${river}: ${used.map(r => `${r.zuid} km ${r.kmP}-${r.kmK}`).join(', ')}; ${(mainLength / 1000).toFixed(1)} km, ${mainPart.length} vertices`);

const reachList = [{ id: 'labe', name: river, river, length: mainLength, part: mainPart, half, mouth: null }];
const gaugesOn = (st, ln, cm, sOf, minS, maxS) => st.map(g => { const p = project(ln, cm, g.lon, g.lat); return { ...g, s: Math.round(sOf(p.s)), offRiver: Math.round(p.dist) }; }).filter(g => g.offRiver < 800 && g.s >= minS && g.s <= maxS);
const gauges = gaugesOn(stations.filter(s => s.river === river && s.rkm >= kmLo && s.rkm <= kmHi), line, cum, sc => sDownChain - sc, -3000, mainLength + 3000).map(g => ({ ...g, reach: 0 }));

// ---- tributaries -----------------------------------------------------------------------------------------------------------------------------
const mainPts = mainPart.map(v => v.p);
for (const tr of TRIBS) {
  const found = await fetchReaches(tr.river, { south: Math.min(...mainPts.map(p => p[1])) - 0.2, west: Math.min(...mainPts.map(p => p[0])) - 0.2, north: Math.max(...mainPts.map(p => p[1])) + 0.2, east: Math.max(...mainPts.map(p => p[0])) + 0.2 });
  let { line: tl, reaches: tu } = chainReaches(found, 0, tr.anchorKm + 2);
  // orient so that the end is the mouth (the end nearest to the main river)
  if (project(line, cum, ...tl[0]).dist < project(line, cum, ...tl.at(-1)).dist) tl = tl.slice().reverse();
  const tc = cumulative(tl), total = tc.at(-1), mouth = project(line, cum, ...tl.at(-1));
  if (mouth.dist > 1500) throw new Error(`${tr.river}: mouth is ${mouth.dist.toFixed(0)} m from the ${river} centreline`);
  const sStart = Math.max(0, total - tr.kmUp * 1000), part = [{ p: at(tl, tc, sStart), s: total - sStart }];
  for (let i = 0; i < tl.length; i++) if (tc[i] > sStart && tc[i] < total) part.push({ p: tl[i], s: total - tc[i] });
  part.push({ p: tl.at(-1), s: 0 });
  const idx = reachList.length;
  const ext = stations.filter(s => (s.river === tr.river && s.rkm != null && s.rkm >= 0 && s.rkm <= tr.anchorKm) || tr.gaugeIds.includes(s.id));
  const tg = gaugesOn(ext, tl, tc, sc => total - sc, -500, tr.anchorKm * 1000 + 3000).map(g => ({ ...g, reach: idx }));
  gauges.push(...tg);
  reachList.push({ id: tr.id, name: tr.river, river: tr.river, length: total - sStart, part, half: tr.half, mouth: { parent: 0, s: Math.round(sDownChain - mouth.s), offRiver: Math.round(mouth.dist) } });
  log(`${tr.river}: ${tu.map(r => `${r.zuid} km ${r.kmP}-${r.kmK}`).join(', ')}; ${((total - sStart) / 1000).toFixed(1)} km, mouth at ${river} s=${((sDownChain - mouth.s) / 1000).toFixed(1)} km (${mouth.dist.toFixed(0)} m off), gauges: ${tg.map(g => g.name).join(', ') || 'none'}`);
}

// ---- grid, river coordinate, terrain ---------------------------------------------------------------------------------------------------------
const g = corridorGrid(reachList.flatMap(r => r.part.map(v => v.p)), Math.max(...reachList.map(r => r.half)), pixel);
log(`grid ${g.W} x ${g.H} = ${(g.W * g.H / 1e6).toFixed(0)} M cells at ${g.groundPixel.toFixed(2)} m`);
for (const r of reachList) r.linePx = r.part.map(v => { const [x, y] = toPixel(g, ...v.p); return [x, y, v.s]; });
const { s, r: rid } = labelReaches(g.W, g.H, g.groundPixel, reachList.map(r => ({ linePx: r.linePx, halfM: r.half })));
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
const allPts = reachList.flatMap(r => r.part.map(v => v.p));
const zb = { south: Math.min(...allPts.map(p => p[1])) - 0.05, west: Math.min(...allPts.map(p => p[0])) - 0.06, north: Math.max(...allPts.map(p => p[1])) + 0.05, east: Math.max(...allPts.map(p => p[0])) + 0.06 };
for (const [layer, bit] of ZONE_LAYERS) {
  try {
    const features = await fetchZoneFeatures(layer, zb);
    rasterizeFeatures(features, (lon, lat) => toPixel(g, lon, lat), g.W, g.H, bit, zones, { fixDatum: true });
    zoneCounts[layer] = features.length; log(`zones ${layer}: ${features.length} features`);
  } catch (e) { log(`zones ${layer} skipped: ${e.message}`); }
}

// ---- weirs and flood events ---------------------------------------------------------------------------------------------------------------------
log('gauges:', gauges.map(x => `${x.name} (${reachList[x.reach].id}) s=${(x.s / 1000).toFixed(1)} km`).join('; '));
const weirList = [];
try { for (const w of JSON.parse(await readFile(new URL('../weirs-nodata.json', import.meta.url), 'utf8'))) weirList.push({ key: w.key, name: w.name, lat: w.lat, lon: w.lon, rkm: w.rkm, live: false }); } catch { /* optional */ }
for (const w of WEIRS) weirList.push({ key: w.key, name: w.name, lat: w.lat, lon: w.lon, rkm: null, live: true });
const weirs = weirList.map(w => { const p = project(line, cum, w.lon, w.lat); return { ...w, s: Math.round(sDownChain - p.s), offRiver: Math.round(p.dist) }; })
  .filter(w => w.offRiver < 600 && w.s > -1500 && w.s < mainLength + 1500).sort((a, b) => a.s - b.s);
log('weirs:', weirs.map(w => `${w.name.replace(/^Zdymadlo /, '')} ${(w.s / 1000).toFixed(1)}`).join(', '));

const HIST = 'https://opendata.chmi.cz/hydrology/historical/data';
const EVENTS = { '2002-08': ['2002-08-05', '2002-08-25'], '2006-04': ['2006-03-25', '2006-04-15'], '2013-06': ['2013-05-30', '2013-06-15'], '2024-09': ['2024-09-12', '2024-09-25'] };
const events = {};
for (const gg of gauges) for (const [name, [d0, d1]] of Object.entries(EVENTS)) {
  const y = +d0.slice(0, 4);
  for (const [folder, code] of [['measured_water_level', 'OH'], ['hourly', 'HQ']]) {
    try {
      const doc = await (await fetch(`${HIST}/${folder}/H_${gg.id}_${code}_${y}.json`, { signal: AbortSignal.timeout(60_000) })).json();
      if (doc?.tsList?.[0]?.unit !== 'CM') continue;                // some series carry discharge, ignore those
      for (const [dt, v] of doc.tsList[0].tsData.data.values) if (typeof v === 'number' && dt >= d0 && dt <= d1 + 'T23' && (!events[name]?.[gg.id] || v > events[name][gg.id].cm)) (events[name] ??= {})[gg.id] = { cm: v, dt: dt.slice(0, 16) };
    } catch { /* no data for that year */ }
  }
}
// a gauge whose "peak" lies days away from the peaks of the others has no data from the flood itself (e.g. Děčín and Hřensko in 2002, the
// gauges were lost), so its pre-flood level would pull the water surface down: drop it
for (const [name, byGauge] of Object.entries(events)) {
  const times = Object.values(byGauge).map(v => Date.parse(v.dt + ':00Z')).sort((a, b) => a - b), med = times[times.length >> 1];
  for (const [id, v] of Object.entries(byGauge)) {
    const days = Math.abs(Date.parse(v.dt + ':00Z') - med) / 864e5;
    if (days > 4) { log(`${name}: dropping ${gauges.find(x => x.id === id)?.name}, its peak (${v.dt}, ${v.cm} cm) is ${days.toFixed(0)} days from the median peak time, so the flood itself is missing`); delete byGauge[id]; }
  }
}
log('events:', Object.entries(events).map(([n, v]) => `${n}: ${Object.keys(v).length} gauges`).join(', '));

// ---- write ----------------------------------------------------------------------------------------------------------------------------------------
const dir = new URL(`../experiments/flood/data/corridor-${river.toLowerCase()}/`, import.meta.url);
await mkdir(dir, { recursive: true });
await writeFile(new URL('z.bin', dir), Buffer.from(z.buffer));
await writeFile(new URL('s.bin', dir), Buffer.from(s.buffer));
await writeFile(new URL('r.bin', dir), Buffer.from(rid.buffer));
await writeFile(new URL('zones.bin', dir), Buffer.from(zones.buffer));
await writeFile(new URL('manifest.json', dir), JSON.stringify({
  river, W: g.W, H: g.H, x0: g.x0, y0: g.y0, pix: g.pix, lat0: g.lat0, groundPixel: g.groundPixel, sUnit: S_UNIT, noData: NODATA, noS: NO_S, noR: NO_R,
  length: mainLength, reachesUsed: used,
  reaches: reachList.map(r => ({ id: r.id, name: r.name, length: Math.round(r.length), halfM: r.half, mouth: r.mouth, centerline: r.linePx.map(([x, y, sv]) => [+x.toFixed(1), +y.toFixed(1), Math.round(sv)]) })),
  centerline: reachList[0].linePx.map(([x, y, sv]) => [+x.toFixed(1), +y.toFixed(1), Math.round(sv)]),
  gauges, weirs, events,
  zones: { bits: Object.fromEntries(ZONE_LAYERS.map(([n, b]) => [n.replace('ZaplavUzemi_', ''), b])), counts: zoneCounts },
  sources: 'ČÚZK DMR 5G; VÚV TGM (flood zones, river reaches); ČHMÚ (gauges, history)', fetched: new Date().toISOString(),
}));
log(`written to experiments/flood/data/corridor-${river.toLowerCase()}/ (${tiles} terrain tiles)`);
