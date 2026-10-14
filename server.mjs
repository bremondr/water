// Prototype backend: pulls CHMI open hydrology data, caches it, serves the UI.
// ČHMÚ open data sends no CORS headers, so the browser can't call it directly.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { scrapeAll } from './dams.mjs';

const BASE = 'https://opendata.chmi.cz/hydrology/now';
const RECENT = 'https://opendata.chmi.cz/hydrology/recent/data';
const PORT = process.env.PORT || 8080;
const TTL = 10 * 60 * 1000;
let cache = null, loading = null;

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

// meta3 has no "povodí" field (PROVOZOVATEL is the gauge operator, not the basin), so derive the
// state-enterprise basin from the hydrological order number (HLGP4, e.g. 1-14-03-1020). Approximate.
function povodi(hlgp) {
  const [a, b, c] = (hlgp || '').split('-');
  const k = `${a}-${b}`;
  if (['1-01', '1-02', '1-03', '1-04', '1-05'].includes(k)) return 'Povodí Labe';
  if (k === '1-14') return c === '01' ? 'Povodí Ohře' : 'Povodí Labe';      // 1-14-01 = Bílina
  if (k === '1-12') return c === '03' ? 'Povodí Labe' : 'Povodí Vltavy';    // 1-12-03 = Labe below Vltava
  if (['1-06', '1-07', '1-08', '1-09', '1-10', '1-11'].includes(k)) return 'Povodí Vltavy';
  if (k === '1-13' || k === '1-15') return 'Povodí Ohře';
  if (a === '2') return 'Povodí Odry';
  if (a === '4' && b !== '02') return 'Povodí Moravy';
  return 'Ostatní';
}

async function build() {
  const m3 = (await getJson(`${BASE}/metadata/meta3.json`)).data.data;
  const c3 = m3.header.split(',');
  const pov = new Map(m3.values.map(v => [v[c3.indexOf('objID')], povodi(v[c3.indexOf('HLGP4')])]));
  const meta = await getJson(`${BASE}/metadata/meta1.json`);
  const { header, values } = meta.data.data;
  const cols = header.split(',');
  const stations = values.map(v => Object.fromEntries(cols.map((c, i) => [c, v[i]])));
  const day = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10).replaceAll('-', '');
  const days = [day(2), day(1)];
  const out = [];
  let i = 0;
  async function worker() {
    while (i < stations.length) {
      const s = stations[i++];
      const st = {
        id: s.objID, name: s.STATION_NAME, river: s.STREAM_NAME, lat: s.GEOGR1, lon: s.GEOGR2,
        // flood-activity thresholds: level (cm) and flow (m3/s)
        h: [s.SPA1H, s.SPA2H, s.SPA3H, s.SPA4H], q: [s.SPA1Q, s.SPA2Q, s.SPA3Q, s.SPA4Q],
        pov: pov.get(s.objID) || 'Ostatní', dryH: s.DRYH, dryQ: s.DRYQ, H: [], Q: [],
      };
      // today's file ("now") plus the two previous days from "recent" => at least 48 h of 10-minute data
      for (const url of [...days.map(d => `${RECENT}/${d}_${s.objID}.json`), `${BASE}/data/${s.objID}.json`]) {
        try {
          const d = await getJson(url);
          for (const ts of d.objList[0].tsList) {
            const key = ts.tsConID === 'H' ? 'H' : ts.tsConID === 'Q' ? 'Q' : null;
            if (key) st[key].push(...ts.tsData.filter(p => p.value != null).map(p => [Date.parse(p.dt) / 1000, p.value]));
          }
        } catch (e) { /* station without data for that day */ }
      }
      if (st.H.length || st.Q.length) out.push(st);
    }
  }
  await Promise.all(Array.from({ length: 16 }, worker));
  out.sort((a, b) => a.name.localeCompare(b.name, 'cs'));
  return { updated: new Date().toISOString(), stations: out };
}

async function data() {
  if (cache && Date.now() - cache.at < TTL) return cache.body;
  loading ??= build().then(b => (cache = { at: Date.now(), body: JSON.stringify(b) }, b))
                     .finally(() => (loading = null));
  if (cache) return cache.body;           // serve stale while refreshing
  return JSON.stringify(await loading);
}

// ---- Reservoirs (all five povodí) ----------------------------------------------------------
// Scraping lives in dams.mjs; positions come from dam-coords.json (made once by geocode.mjs), since the
// portals publish none. Dams without a position are left out.
const COORDS = JSON.parse(await readFile(new URL('./dam-coords.json', import.meta.url), 'utf8'));

// ČHMÚ publishes no gauge between Orlík and Zbraslav (its "VD Orlík"/"VD Vrané" stations have no data),
// so the nearest flow measurements below the whole cascade are Zbraslav (river km 65,2) and Praha - Chuchle
// (km 60,1). The client looks these up in the station data it already has.
const CASCADE_REF = ['0-203-1-169000', '0-203-1-200100'];

async function buildReservoirs() {
  const all = await scrapeAll();
  const out = all
    .filter(d => !/přepočítaná/i.test(d.name))                   // Povodí Moravy lists Dalešice twice
    .map(d => ({
      ...d, lat: COORDS[d.key]?.[0], lon: COORDS[d.key]?.[1],
      approx: COORDS[d.key]?.[2] === 1,                              // position is a village/locality centre, not the dam
      note: d.note === `VD ${d.name}` ? '' : d.note,                  // Odra repeats the name as a note
      warnings: [],
    }))
    .filter(d => d.lat != null);
  for (const d of out) {
    // The Vltava cascade (Orlík, Kamýk, Slapy, Štěchovice) is published with outflow exactly 0,00 while
    // inflow is 10-25 m3/s and the river below carries ~30-40 m3/s (ČHMÚ Praha-Chuchle, Zbraslav). It is a
    // placeholder for "not reported", so hide it instead of showing a false zero.
    if (d.outflow === 0 && (d.inflow ?? 0) >= 1) {
      d.warnings.push(`Portál uvádí odtok 0,00 m³/s při přítoku ${String(d.inflow).replace('.', ',')} m³/s. Řeka pod nádrží přitom teče, takže jde o nenahlášenou hodnotu, ne o skutečnou nulu. Odtok je skrytý, orientační průtok pod kaskádou je níže.`);
      d.outflow = null;
      d.refGauges = CASCADE_REF;
    }
    if (d.inflow != null && d.inflow < 0)
      d.warnings.push('Záporný přítok je dopočtený z bilance nádrže (změna objemu a odtok), není měřený.');
  }
  out.sort((a, b) => a.name.localeCompare(b.name, 'cs'));
  return { updated: new Date().toISOString(), reservoirs: out };
}

let damCache = null, damLoading = null;
async function reservoirs() {
  if (damCache && Date.now() - damCache.at < TTL) return damCache.body;
  damLoading ??= buildReservoirs().then(b => (damCache = { at: Date.now(), body: JSON.stringify(b) }))
                                  .finally(() => (damLoading = null));
  if (damCache) return damCache.body;
  await damLoading;
  return damCache.body;
}

http.createServer(async (req, res) => {
  try {
    if (req.url.startsWith('/api/reservoirs')) {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'max-age=60' });
      return res.end(await reservoirs());
    }
    if (req.url.startsWith('/api/stations')) {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'max-age=60' });
      return res.end(await data());
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(await readFile(new URL('./index.html', import.meta.url)));
  } catch (e) { res.writeHead(502); res.end(String(e)); }
}).listen(PORT, () => console.log(`http://localhost:${PORT}`));
