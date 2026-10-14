// One-off: looks up a position for every scraped dam in OpenStreetMap (Nominatim, 1 request/s as per its
// usage policy) and writes dam-coords.json. Entries already in the file are kept, so hand corrections stick.
// Usage: node geocode.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { scrapeAll } from './dams.mjs';

const FILE = new URL('./dam-coords.json', import.meta.url);
let coords = {};
try { coords = JSON.parse(await readFile(FILE, 'utf8')); } catch { /* first run */ }

const OK_TYPES = new Set(['reservoir', 'dam', 'water', 'lake', 'weir', 'basin', 'pond']);
const inCz = r => +r.lat > 48.5 && +r.lat < 51.1 && +r.lon > 12 && +r.lon < 18.9;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function search(q) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&countrycodes=cz&format=json&limit=5`;
  const res = await fetch(url, { headers: { 'user-agent': 'povodi-prototype/1.0 (bremondr@cvut.cz)' } });
  await sleep(1100);
  return res.ok ? res.json() : [];
}

const dams = await scrapeAll();
for (const d of dams) {
  if (coords[d.key]) continue;
  // strip decorations that are not part of the place name
  const base = d.name.replace(/\s*F-M$/, '').replace(/\s*\(.*?\)/g, '').replace(/\s+-\s+.*$/, '').trim();
  const queries = [`vodní nádrž ${base}`, `přehrada ${base}`, `${base} ${d.river}`, `${base} nádrž`];
  let hit = null;
  for (const q of queries) {
    const rs = (await search(q)).filter(r => inCz(r) && OK_TYPES.has(r.type));
    if (rs.length) { hit = rs[0]; break; }
  }
  if (hit) { coords[d.key] = [+(+hit.lat).toFixed(4), +(+hit.lon).toFixed(4)]; console.log('ok  ', d.key, d.name, '->', hit.display_name.slice(0, 70)); }
  else console.log('MISS', d.key, d.pov, d.name, '/', d.river);
  await writeFile(FILE, JSON.stringify(coords, null, 1));
}
console.log(`${Object.keys(coords).length} of ${dams.length} placed`);
