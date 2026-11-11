// Finds the country modules: every countries/<id>.mjs except this file and lib.mjs. Česko first, the others by name.
import { readdir } from 'node:fs/promises';
import { GENERIC_LEVELS } from './lib.mjs';

export async function loadCountries() {
  const files = (await readdir(new URL('./', import.meta.url))).filter(f => f.endsWith('.mjs') && !['index.mjs', 'lib.mjs'].includes(f));
  const list = [];
  for (const f of files) {
    const c = (await import(`./${f}`)).default;
    if (!c?.id || c.id !== f.slice(0, -4) || !c.sources?.stations?.build) throw new Error(`countries/${f}: needs id equal to the file name and sources.stations.build`);
    list.push({ levels: GENERIC_LEVELS, regionLabel: 'Oblast', allRegions: 'Všechny oblasti', about: '', ...c });
  }
  return list.sort((a, b) => (b.id === 'cz') - (a.id === 'cz') || a.name.localeCompare(b.name, 'cs'));
}

// cache file name of a source: Česko keeps the plain names it had before there were countries
export const cacheName = (country, source) => (country.id === 'cz' ? source : `${country.id}-${source}`);

// what the frontend needs to know about a country (no functions)
export const countryMeta = c => ({
  id: c.id, name: c.name, center: c.center, zoom: c.zoom, regionLabel: c.regionLabel, allRegions: c.allRegions, levels: c.levels,
  source: c.source, about: c.about, has: { reservoirs: !!c.sources.reservoirs, climate: !!c.sources.climate },
});
