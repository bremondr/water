// Anglie: Environment Agency flood-monitoring API (hydrology of rivers in England). Open Government Licence v3.0.
// Two requests per build: all stations (coordinates, river, catchment) and the latest reading of every level measure.
import { fetchJson, mergeHistory } from './lib.mjs';

const BASE = 'https://environment.data.gov.uk/flood-monitoring';
// units of a river "stage" measure we accept; all are metres, the datum differs (mASD = above the station's own stage datum, mAOD = above
// Ordnance Datum Newlyn (sea level), m = unspecified, mBDAT = above a local benchmark datum)
const UNITS = new Set(['m', 'mASD', 'mAOD', 'mBDAT']);
const UNIT_RANK = { mASD: 0, m: 1, mAOD: 2, mBDAT: 3 }; // when a station has several stage measures, prefer the gauge's own datum
const MAX_AGE_S = 48 * 3600; // readings older than this are not shown (stale or dead gauge)

const first = v => (Array.isArray(v) ? v[0] : v);

// Pure. A measure id looks like '1029TH-level-stage-i-15_min-mASD' (station-level-qualifier-i-period-unit); returns null for anything that is not
// a river stage measure (groundwater, tidal level, downstream stage, reservoir...).
export function parseMeasureId(url) {
  const m = /\/([^/]+)-level-stage-i-[^-]+-([A-Za-z]+)$/.exec(String(url));
  return m && UNITS.has(m[2]) ? { station: m[1], unit: m[2] } : null;
}

// Pure. stationsJson = /id/stations response, readingsJson = /data/readings?latest response. -> [station] in the countries/lib.mjs format.
export function parseStations(stationsJson, readingsJson) {
  const best = new Map(); // station reference -> { unit, t, cm }
  for (const r of readingsJson?.items ?? []) {
    const id = parseMeasureId(r.measure);
    const v = r.value; // arrays (two values in one reading) are skipped
    const t = Date.parse(r.dateTime) / 1000;
    if (!id || typeof v !== 'number' || !Number.isFinite(v) || !Number.isFinite(t)) continue;
    const cur = best.get(id.station);
    if (!cur || UNIT_RANK[id.unit] < UNIT_RANK[cur.unit]) best.set(id.station, { unit: id.unit, t, cm: Math.round(v * 1000) / 10 });
  }
  const newest = Math.max(0, ...[...best.values()].map(b => b.t));
  const out = [];
  for (const s of stationsJson?.items ?? []) {
    const ref = first(s.stationReference);
    const b = best.get(ref);
    const lat = first(s.lat), lon = first(s.long);
    if (!b || b.t < newest - MAX_AGE_S || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (s.status && !JSON.stringify(s.status).includes('statusActive')) continue;
    const label = String(first(s.label) ?? ref).trim();
    const river = first(s.riverName) ? String(first(s.riverName)).replace(/^River\s+/i, '').trim() : '';
    out.push({
      id: ref, name: label, river, lat, lon, h: [null, null, null, null], q: [null, null, null, null],
      pov: first(s.catchmentName) || 'Ostatní', dryH: null, dryQ: null, ha: null, qa: null, H: [[b.t, b.cm]], Q: [],
    });
  }
  return out;
}

async function buildStations(prev) {
  const [stations, readings] = await Promise.all([
    fetchJson(`${BASE}/id/stations?parameter=level&_limit=10000`),
    fetchJson(`${BASE}/data/readings?latest&parameter=level&_limit=10000`),
  ]);
  const list = parseStations(stations, readings);
  if (!list.length) throw new Error('Environment Agency: no stations parsed');
  return { updated: new Date().toISOString(), stations: mergeHistory(prev?.stations, list) };
}

export default {
  id: 'gb', name: 'Anglie', center: [52.6, -1.5], zoom: 7,
  regionLabel: 'Povodí', allRegions: 'Všechna povodí',
  source: 'Environment Agency (OGL v3.0)',
  about: `<p>Zdroj: Environment Agency, <a href="https://environment.data.gov.uk/flood-monitoring/doc/reference">Flood Monitoring API</a>
   (hladiny řek v Anglii, aktualizace po 15 minutách, mapa je obnovována přibližně po 30 minutách).
   Contains public sector information licensed under the Open Government Licence v3.0. Environment Agency.</p>
   <p>Hladiny jsou v centimetrech nad datem stanice (nejčastěji místní nula vodočtu, někdy nadmořská výška v m n. m. Newlyn), proto
   se nedají porovnávat mezi stanicemi. Stanice, které hlásí jen výšku v m n. m. (kolem 550), ukazují absolutní nadmořskou výšku hladiny (např. 4 530 cm), jejich vývoj je správný, ale hodnotu nelze přímo srovnat s ostatními. Environment Agency v tomto API neposkytuje prahy povodňových stupňů, stanice jsou proto šedé
   (bez stupně) a zobrazují jen poslední naměřenou hodnotu a vývoj. Údaje jsou orientační a nejsou varováním před povodní;
   oficiální varování najdete na <a href="https://check-for-flooding.service.gov.uk/">check-for-flooding.service.gov.uk</a>.</p>`,
  sources: { stations: { ttlMin: 30, build: buildStations } },
};
