// Static build for GitHub Pages: writes site/ (index.html, climate.mjs, data/*.json).
// Each source keeps its last good value in .cache/ (the workflow restores that folder between runs) and is only fetched again when it is
// older than its TTL, so a run that fires early does not touch the upstream servers. A failed refresh keeps the previous value.
//   node scripts/build-static.mjs            TTLs (minutes) from STATIONS_TTL_MIN (25), RESERVOIRS_TTL_MIN (55), CLIMATE_TTL_MIN (10080)
import { mkdir, writeFile, copyFile, rm } from 'node:fs/promises';
import { buildStations, buildReservoirs } from '../builders.mjs';
import { buildClimate } from '../climate.mjs';
import { createCache } from '../cache.mjs';

const min = (name, def) => Number(process.env[name] ?? def) * 60_000;
const sources = [
  ['reservoirs', min('RESERVOIRS_TTL_MIN', 55), buildReservoirs],      // small and quick first
  ['climate', min('CLIMATE_TTL_MIN', 7 * 24 * 60), buildClimate],
  ['stations', min('STATIONS_TTL_MIN', 25), buildStations],
];
const out = new URL('../site/', import.meta.url);
await rm(out, { recursive: true, force: true });
await mkdir(new URL('data/', out), { recursive: true });

let failed = 0;
for (const [name, ttl, build] of sources) {
  try {
    const cache = createCache({ name, ttl, build });
    await writeFile(new URL(`data/${name}.json`, out), await cache.ensureFresh());
    console.log(`${name}: ok`);
  } catch (e) { console.error(`${name}: ${e.message}`); failed++; }
}
if (failed) { console.error('no data for at least one source, not publishing'); process.exit(1); }
for (const f of ['index.html', 'climate.mjs']) await copyFile(new URL(`../${f}`, import.meta.url), new URL(f, out));
await writeFile(new URL('.nojekyll', out), '');
