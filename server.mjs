// Local server: serves the UI and the same JSON files the static build publishes (data/*.json), with a stale-while-revalidate cache.
// ČHMÚ open data sends no CORS headers, so the browser can't call it directly. On GitHub Pages scripts/build-static.mjs writes the files.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { buildStations, buildReservoirs } from './builders.mjs';
import { buildClimate } from './climate.mjs';
import { createCache } from './cache.mjs';

const PORT = process.env.PORT || 8080;
const TTL = 10 * 60 * 1000;

const stations = createCache({ name: 'stations', ttl: TTL, build: buildStations });
const reservoirs = createCache({ name: 'reservoirs', ttl: TTL, build: buildReservoirs });
// long-term characteristics hardly ever change (fixed 1991-2020 reference period): refresh weekly
const climate = createCache({ name: 'climate', ttl: 7 * 24 * 3600 * 1000, build: buildClimate });

const json = { 'content-type': 'application/json', 'cache-control': 'max-age=60' };

http.createServer(async (req, res) => {
  try {
    const path = req.url.split('?')[0];
    if (path === '/data/reservoirs.json') { res.writeHead(200, json); return res.end(await reservoirs.get()); }
    // the browser reuses the pure helpers of climate.mjs (exceedanceDays), so there is one copy of that logic
    if (path === '/climate.mjs') { res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' }); return res.end(await readFile(new URL('./climate.mjs', import.meta.url))); }
    if (path === '/data/climate.json') { res.writeHead(200, { ...json, 'cache-control': 'max-age=3600' }); return res.end(await climate.get()); }
    if (path === '/data/stations.json') { res.writeHead(200, json); return res.end(await stations.get()); }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(await readFile(new URL('./index.html', import.meta.url)));
  } catch (e) { res.writeHead(502); res.end(String(e)); }
}).listen(PORT, () => {
  console.log(`http://localhost:${PORT}`);
  reservoirs.start(); stations.start(); climate.start();   // small and quick first, so it is not starved by the station build
});
