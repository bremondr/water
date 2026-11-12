// Local server: serves the UI and the same JSON files the static build publishes (data/countries.json, data/<country>/<source>.json),
// each behind a stale-while-revalidate cache. ČHMÚ open data sends no CORS headers, so the browser can't call it directly.
// On GitHub Pages scripts/build-static.mjs writes the files instead.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { loadCountries, cacheName, countryMeta } from './countries/index.mjs';
import { createCache } from './cache.mjs';
import { normalizeStations } from './countries/lib.mjs';

const PORT = process.env.PORT || 8080;
const countries = await loadCountries();
const caches = new Map();                       // "cz/stations" -> cache
for (const c of countries) {
  for (const [name, src] of Object.entries(c.sources)) {
    const build = name === 'stations' ? async prev => { const d = await src.build(prev); return { ...d, stations: normalizeStations(d.stations) }; } : src.build;
    caches.set(`${c.id}/${name}`, createCache({ name: cacheName(c, name), ttl: src.ttlMin * 60_000, build }));
  }
}
const countriesBody = JSON.stringify(countries.map(countryMeta));
const json = { 'content-type': 'application/json', 'cache-control': 'max-age=60' };

http.createServer(async (req, res) => {
  try {
    const path = req.url.split('?')[0];
    // the browser reuses the pure helpers of climate.mjs (exceedanceDays), so there is one copy of that logic
    if (path === '/climate.mjs') { res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' }); return res.end(await readFile(new URL('./climate.mjs', import.meta.url))); }
    if (path === '/data/countries.json') { res.writeHead(200, json); return res.end(countriesBody); }
    const m = /^\/data\/([a-z]+)\/([a-z]+)\.json$/.exec(path);
    if (m) {
      const cache = caches.get(`${m[1]}/${m[2]}`);
      if (!cache) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, m[2] === 'climate' ? { ...json, 'cache-control': 'max-age=3600' } : json); return res.end(await cache.get());
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(await readFile(new URL('./index.html', import.meta.url)));
  } catch (e) { res.writeHead(502); res.end(String(e)); }
}).listen(PORT, () => {
  console.log(`http://localhost:${PORT}`);
  // refresh now if stale and keep the data fresh while the server runs; small and quick sources first
  for (const [k, cache] of [...caches].sort(([a], [b]) => (a.endsWith('/stations')) - (b.endsWith('/stations')))) cache.start();
});
