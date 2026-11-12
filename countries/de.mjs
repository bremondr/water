// Německo: WSV Pegelonline (Wasserstraßen- und Schifffahrtsverwaltung des Bundes), federal waterways only (not the small rivers of the Länder).
import { fetchJson, mergeHistory } from './lib.mjs';

export const URL_ALL = 'https://www.pegelonline.wsv.de/webservices/rest-api/v2/stations.json?includeTimeseries=true&includeCurrentMeasurement=true&includeCharacteristicValues=true';

// The API also lists gauges of the neighbours. Those without coordinates (all Czech ones) are dropped anyway; the rest is dropped by agency.
const FOREIGN_AGENCIES = new Set(['POVODÍ LABE', 'VIA DONAU', 'RIJKSWATERSTAAT', 'BUNDESAMT FÜR UMWELT CH']);

// Region filter: the big rivers by name (Czech where there is a Czech name), canals and the sea grouped, the rest together.
const RIVERS = { ELBE: 'Labe', RHEIN: 'Rýn', WESER: 'Vezera', NECKAR: 'Neckar', LAHN: 'Lahn', MOSEL: 'Mosela', SAALE: 'Sála', DONAU: 'Dunaj',
  EMS: 'Emže', MAIN: 'Mohan', ODER: 'Odra', SAAR: 'Saar', ILMENAU: 'Ilmenau', EIDER: 'Eidera', HUNTE: 'Hunte' };
const SEA = new Set(['NORDSEE', 'OSTSEE', 'KLEINES HAFF', 'JADE']);
export function region(water) {
  const w = (water ?? '').toUpperCase();
  if (RIVERS[w]) return RIVERS[w];
  if (SEA.has(w)) return 'Moře a pobřeží';
  if (/KANAL|WASSERSTRASSE|GEW[AÄ]+SSER|QUERFAHRT/.test(w)) return 'Kanály a vodní cesty';
  return 'Ostatní řeky';
}

const titleCase = s => String(s).toLowerCase().replace(/(^|[\s\-(/])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());

// Pure. The stations.json response -> stations of the frontend format (series hold only the current reading; build() adds the history).
export function parsePegelonline(list) {
  const out = [];
  for (const s of list ?? []) {
    if (!Number.isFinite(s.latitude) || !Number.isFinite(s.longitude)) continue;
    if (FOREIGN_AGENCIES.has(s.agency)) continue;
    const W = s.timeseries?.find(t => t.shortname === 'W' && t.unit === 'cm');
    const Q = s.timeseries?.find(t => t.shortname === 'Q');
    if (!W && !Q) continue;
    const point = t => {
      const m = t?.currentMeasurement, ts = Date.parse(m?.timestamp);
      return m && Number.isFinite(m.value) && Number.isFinite(ts) ? [[Math.round(ts / 1000), m.value]] : [];
    };
    const cv = name => {
      const c = W?.characteristicValues?.find(c => c.shortname === name && c.unit === 'cm');
      return Number.isFinite(c?.value) ? c.value : null;
    };
    out.push({
      id: s.uuid, name: titleCase(s.longname), river: titleCase(s.water?.longname ?? ''), lat: s.latitude, lon: s.longitude,
      h: [cv('M_I'), cv('M_II'), cv('M_III'), null], q: [null, null, null, null],
      pov: region(s.water?.longname), dryH: cv('NNW'), dryQ: null, ha: cv('MW'), qa: null,
      H: point(W), Q: point(Q),
    });
  }
  return out;
}

async function build(prev) {
  const stations = parsePegelonline(await fetchJson(URL_ALL, { timeoutMs: 120_000 }));
  return { updated: new Date().toISOString(), stations: mergeHistory(prev?.stations, stations) };
}

export default {
  id: 'de', name: 'Německo', center: [51.1, 10.3], zoom: 6,
  regionLabel: 'Skupina toků', allRegions: 'Všechny skupiny',
  levels: {
    names: ['Pod hladinou HM I', 'Hochwassermarke I', 'Hochwassermarke II (HSW)', 'Hochwassermarke III', 'Extrém'],
    short: ['Normální', 'HM I', 'HM II', 'HM III', 'Extrém'],
  },
  source: 'WSV / PEGELONLINE',
  haNote: 'Zdroj: WSV PEGELONLINE, charakteristická hodnota MW (střední vodní stav). Referenční období se u jednotlivých stanic liší.',
  about: `<p>Zdroj: <a href="https://www.pegelonline.wsv.de/">PEGELONLINE</a>, Wasserstraßen- und Schifffahrtsverwaltung des Bundes (WSV),
   licence <a href="https://www.govdata.de/dl-de/zero-2-0">Datenlizenz Deutschland – Zero – Version 2.0</a> (uvedení zdroje není povinné, uvádíme ho přesto).
   Jen spolkové vodní cesty (Labe, Rýn, Vezera, Dunaj, kanály, pobřeží), ne menší toky spolkových zemí. U části stanic jsou data třetích stran.
   Hochwassermarken (HM) I až III jsou hladiny, při kterých se podle předpisů o plavbě (BinSchStrO, nařízení pro Rýn, Moselu, Odru) omezuje nebo zakazuje lodní doprava;
   HM II odpovídá nejvyšší plavební hladině (HSW), po jejím dosažení se plavba v úseku zakazuje (kromě převozů). Nejsou to stupně povodňové aktivity a nemají stejný význam jako české SPA.
   Hodnoty mají jen stanice, kde jsou značky stanoveny (asi desetina).
   Barva se určuje jen u stanic, které značky mají; ostatní jsou šedé. Průměr je dlouhodobý (referenční období se u stanic liší).
   Data jsou informativní, bez záruky; WSV za jejich správnost neručí.</p>`,
  sources: { stations: { ttlMin: 30, build } },
};
