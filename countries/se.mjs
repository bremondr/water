// Sverige: SMHI open data, hydrological observations (discharge, 15 minute values, all active stations in one bulk file).
import { fetchJson, mergeHistory } from './lib.mjs';

export const URL_BULK = 'https://opendata-download-hydroobs.smhi.se/api/version/latest/parameter/2/station-set/all/period/latest-hour/data.json';

// "HJÄLMAREN W" -> "Hjälmaren W", "GÖTA ÄLV" -> "Göta Älv", "SIBRO 2" -> "Sibro 2"
export function titleCase(s) {
  return String(s ?? '').trim().toLocaleLowerCase('sv').replace(/(^|[\s\-(/])(\p{L})/gu, (_, a, b) => a + b.toLocaleUpperCase('sv'));
}

// Pure. Parses the bulk response (parameter 2, station-set all) into stations. SMHI values are epoch milliseconds and m3/s.
// No water level (parameter 3 exists for 10 lakes only, with station-specific datums) and no flood thresholds: h and q stay null.
export function parseBulk(json) {
  const out = [];
  for (const s of json?.station ?? []) {
    const Q = (s.value ?? [])
      .filter(v => v && typeof v.value === 'number' && Number.isFinite(v.value) && Number.isFinite(v.date))
      .map(v => [Math.round(v.date / 1000), v.value])
      .sort((a, b) => a[0] - b[0]);
    if (!s.name || !Number.isFinite(s.latitude) || !Number.isFinite(s.longitude)) continue;
    out.push({
      id: String(s.id ?? s.key), name: titleCase(s.name), river: '', lat: s.latitude, lon: s.longitude,
      h: [null, null, null, null], q: [null, null, null, null],
      pov: s.catchmentName ? titleCase(s.catchmentName) : 'Ostatní',
      dryH: null, dryQ: null, ha: null, qa: null, H: [], Q,
    });
  }
  return out;
}

async function build(prev) {
  const j = await fetchJson(URL_BULK);
  const stations = mergeHistory(prev?.stations, parseBulk(j), 48);
  return { updated: new Date(Number.isFinite(j.updated) ? j.updated : Date.now()).toISOString(), stations };
}

export default {
  id: 'se', name: 'Švédsko', center: [62.5, 16.5], zoom: 5,
  regionLabel: 'Povodí', allRegions: 'Všechna povodí',
  source: 'SMHI',
  about: `<p>Zdroj: <a href="https://opendata.smhi.se/">SMHI</a> (Sveriges meteorologiska och hydrologiska institut), otevřená data, hydrologická pozorování
   (průtok, 15minutové hodnoty z aktivních stanic).
   Licence <a href="https://creativecommons.org/licenses/by/4.0/deed.sv">Creative Commons Erkännande 4.0 SE (CC BY 4.0)</a>, zdroj: SMHI
   (<a href="https://www.smhi.se/data/om-smhis-data/villkor-for-anvandning">podmínky použití</a>). Data jsou zobrazena beze změny hodnot
   (jen přepracované názvy a historie skládaná z opakovaných stažení).</p>
   <p>Zobrazuje se pouze průtok (m³/s). SMHI v tomto rozhraní nezveřejňuje stupně povodňové aktivity, stanice jsou proto šedé. Data v reálném čase
   mohou být neověřená; informativní, bez záruky, nejde o výstrahu ani předpověď.</p>`,
  sources: { stations: { ttlMin: 60, build } },
};
