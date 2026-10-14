// Prototype backend: pulls ČHMÚ open hydrology data and the povodí reservoir portals, caches them
// (memory + .cache/ on disk), and serves the UI.
// ČHMÚ open data sends no CORS headers, so the browser can't call it directly.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { scrapeAll, finalizeReservoirs } from './dams.mjs';
import { scrapeWeirs, loadNoDataWeirs } from './weirs.mjs';
import { povodi } from './basins.mjs';
import { buildClimate } from './climate.mjs';
import { createCache } from './cache.mjs';

const BASE = 'https://opendata.chmi.cz/hydrology/now';
const RECENT = 'https://opendata.chmi.cz/hydrology/recent/data';
const PORT = process.env.PORT || 8080;
const TTL = 10 * 60 * 1000;

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

// ---- River stations (ČHMÚ) ------------------------------------------------------------------
// A station needs three files (today from "now", the two previous days from "recent"). The previous days
// no longer change, so they are fetched once and kept in memory: a refresh then costs ~550 requests instead
// of ~1,650. Misses (no file for that day) are remembered for 6 h so they are not retried every refresh.
const past = new Map();                       // "YYYYMMDD_objID" -> { at, series } ; series = { H: [], Q: [] } | null
const MISS_TTL = 6 * 3600 * 1000;

const toSeries = d => {
  const out = { H: [], Q: [] };
  for (const ts of d.objList[0].tsList) {
    const key = ts.tsConID === 'H' ? 'H' : ts.tsConID === 'Q' ? 'Q' : null;
    if (key) out[key].push(...ts.tsData.filter(p => p.value != null).map(p => [Date.parse(p.dt) / 1000, p.value]));
  }
  return out;
};

async function pastDay(day, id) {
  const key = `${day}_${id}`, hit = past.get(key);
  if (hit && (hit.series || Date.now() - hit.at < MISS_TTL)) return hit.series;
  let series = null;
  try { series = toSeries(await getJson(`${RECENT}/${key}.json`)); } catch { /* no file for that day */ }
  past.set(key, { at: Date.now(), series });
  return series;
}

async function buildStations() {
  const m3 = (await getJson(`${BASE}/metadata/meta3.json`)).data.data;
  const c3 = m3.header.split(',');
  const pov = new Map(m3.values.map(v => [v[c3.indexOf('objID')], povodi(v[c3.indexOf('HLGP4')])]));
  // long-term averages published in the station metadata: HA = water level (cm), QA = discharge (m3/s)
  const avg = new Map(m3.values.map(v => [v[c3.indexOf('objID')], { ha: v[c3.indexOf('HA')], qa: v[c3.indexOf('QA')] }]));
  const meta = await getJson(`${BASE}/metadata/meta1.json`);
  const { header, values } = meta.data.data;
  const cols = header.split(',');
  const stations = values.map(v => Object.fromEntries(cols.map((c, i) => [c, v[i]])));
  const day = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10).replaceAll('-', '');
  const days = [day(2), day(1)];
  for (const k of past.keys()) if (!days.includes(k.slice(0, 8))) past.delete(k);   // drop days that left the window
  const out = [];
  let i = 0;
  async function worker() {
    while (i < stations.length) {
      const s = stations[i++];
      const st = {
        id: s.objID, name: s.STATION_NAME, river: s.STREAM_NAME, lat: s.GEOGR1, lon: s.GEOGR2,
        // flood-activity thresholds: level (cm) and flow (m3/s)
        h: [s.SPA1H, s.SPA2H, s.SPA3H, s.SPA4H], q: [s.SPA1Q, s.SPA2Q, s.SPA3Q, s.SPA4Q],
        pov: pov.get(s.objID) || 'Ostatní', dryH: s.DRYH, dryQ: s.DRYQ, ha: avg.get(s.objID)?.ha ?? null, qa: avg.get(s.objID)?.qa ?? null, H: [], Q: [],
      };
      // two previous days plus today => at least 48 h of 10-minute data
      const parts = [];
      for (const d of days) parts.push(await pastDay(d, s.objID));
      try { parts.push(toSeries(await getJson(`${BASE}/data/${s.objID}.json`))); } catch { /* no data today */ }
      for (const p of parts) if (p) { st.H.push(...p.H); st.Q.push(...p.Q); }
      if (st.H.length || st.Q.length) out.push(st);
    }
  }
  await Promise.all(Array.from({ length: 16 }, worker));
  if (!out.length) throw new Error('no station data returned');
  out.sort((a, b) => a.name.localeCompare(b.name, 'cs'));
  return { updated: new Date().toISOString(), stations: out };
}

// ---- Reservoirs (all five povodí) -----------------------------------------------------------
// Scraping lives in dams.mjs; positions come from dam-coords.json (made once by geocode.mjs), since the
// portals publish none.
const COORDS = JSON.parse(await readFile(new URL('./dam-coords.json', import.meta.url), 'utf8'));
const NODATA_WEIRS = (await loadNoDataWeirs());

async function buildReservoirs(prev) {
  const [{ dams, errors }, { weirs, errors: weirErrors }] = await Promise.all([scrapeAll(), scrapeWeirs()]);
  if (!dams.length) throw new Error(`all portals failed: ${errors.map(e => `${e.key}: ${e.message}`).join('; ')}`);
  // A portal that is down keeps its last known dams (flagged stale) instead of vanishing from the map.
  const failed = new Set(errors.map(e => e.pov));
  const kept = (prev?.reservoirs ?? []).filter(d => failed.has(d.pov)).map(d => ({ ...d, stale: true }));
  // same for weirs: keep the last known record of a weir whose page failed
  const failedWeirs = new Set(weirErrors.map(e => e.key));
  const keptWeirs = (prev?.weirs ?? []).filter(w => failedWeirs.has(w.key)).map(w => ({ ...w, stale: true }));
  for (const e of [...errors, ...weirErrors]) console.error(`[reservoirs] ${e.pov} failed: ${e.message}`);
  return {
    updated: new Date().toISOString(),
    reservoirs: [...finalizeReservoirs(dams, COORDS), ...kept],
    weirs: [...weirs, ...keptWeirs, ...NODATA_WEIRS],
    errors: [
      ...errors.map(e => ({ pov: e.pov, message: e.message, haveOlderData: kept.some(d => d.pov === e.pov) })),
      ...weirErrors.map(e => ({ pov: e.pov, message: e.message, haveOlderData: keptWeirs.some(w => w.key === e.key) })),
    ],
  };
}

const stations = createCache({ name: 'stations', ttl: TTL, build: buildStations });
const reservoirs = createCache({ name: 'reservoirs', ttl: TTL, build: buildReservoirs });
// long-term characteristics hardly ever change (fixed 1991-2020 reference period): refresh weekly
const climate = createCache({ name: 'climate', ttl: 7 * 24 * 3600 * 1000, build: buildClimate });

const json = { 'content-type': 'application/json', 'cache-control': 'max-age=60' };

http.createServer(async (req, res) => {
  try {
    if (req.url.startsWith('/api/reservoirs')) { res.writeHead(200, json); return res.end(await reservoirs.get()); }
    // the browser reuses the pure helpers of climate.mjs (exceedanceDays), so there is one copy of that logic
    if (req.url === '/climate.mjs') { res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' }); return res.end(await readFile(new URL('./climate.mjs', import.meta.url))); }
    if (req.url.startsWith('/api/climate')) { res.writeHead(200, { ...json, 'cache-control': 'max-age=3600' }); return res.end(await climate.get()); }
    if (req.url.startsWith('/api/stations')) { res.writeHead(200, json); return res.end(await stations.get()); }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(await readFile(new URL('./index.html', import.meta.url)));
  } catch (e) { res.writeHead(502); res.end(String(e)); }
}).listen(PORT, () => {
  console.log(`http://localhost:${PORT}`);
  reservoirs.start(); stations.start(); climate.start();   // small and quick first, so it is not starved by the 1,600-request station build
});
