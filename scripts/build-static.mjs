// Static build for GitHub Pages: writes site/ (index.html, climate.mjs, data/countries.json, data/<country>/{stations,reservoirs,climate}.json).
// Each source keeps its last good value in .cache/ (the workflow restores that folder between runs) and is only fetched again when it is
// older than its TTL, so a run that fires early does not touch the upstream servers. A failed refresh keeps the previous value.
// A country whose stations cannot be built at all is left out of the site (the others still publish); the build fails only if no country is left.
//   node scripts/build-static.mjs [country ids…]      TTL overrides in minutes: STATIONS_TTL_MIN, RESERVOIRS_TTL_MIN, CLIMATE_TTL_MIN
import { mkdir, writeFile, copyFile, rm } from 'node:fs/promises';
import { loadCountries, cacheName, countryMeta } from '../countries/index.mjs';
import { createCache } from '../cache.mjs';
import { normalizeStations, normalizeUpdated } from '../countries/lib.mjs';

const only = process.argv.slice(2);
const out = new URL('../site/', import.meta.url);
await rm(out, { recursive: true, force: true });
await mkdir(new URL('data/', out), { recursive: true });

const built = [];
for (const c of (await loadCountries()).filter(c => !only.length || only.includes(c.id))) {
  await mkdir(new URL(`data/${c.id}/`, out), { recursive: true });
  let ok = true;
  // small and quick sources first
  for (const name of ['reservoirs', 'climate', 'stations'].filter(n => c.sources[n])) {
    const src = c.sources[name];
    const ttl = Number(process.env[`${name.toUpperCase()}_TTL_MIN`] ?? src.ttlMin) * 60_000;
    try {
      const build = name === 'stations' ? async prev => { const d = await src.build(prev); return { ...d, updated: normalizeUpdated(d.updated), stations: normalizeStations(d.stations) }; } : src.build;
      const body = await createCache({ name: cacheName(c, name), ttl, build }).ensureFresh();
      if (name === 'stations' && !JSON.parse(body).stations.length) throw new Error('no stations');
      await writeFile(new URL(`data/${c.id}/${name}.json`, out), body);
      console.log(`${c.id}/${name}: ok`);
    } catch (e) { console.error(`${c.id}/${name}: ${e.message}`); if (name === 'stations') ok = false; }
  }
  if (ok) built.push(c); else console.error(`${c.id}: no station data, country left out`);
}
if (!built.length) { console.error('no country built, not publishing'); process.exit(1); }
await writeFile(new URL('data/countries.json', out), JSON.stringify(built.map(countryMeta)));
for (const f of ['index.html', 'climate.mjs']) await copyFile(new URL(`../${f}`, import.meta.url), new URL(f, out));
await writeFile(new URL('.nojekyll', out), '');
