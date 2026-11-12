// Shared helpers for country modules (countries/<id>.mjs).
//
// A country module default-exports:
//   {
//     id: 'cz',                          short lowercase id, also the folder name under data/
//     name: 'Česko',                     name in the country selector (Czech UI)
//     center: [49.8, 15.5], zoom: 7,     initial map view
//     regionLabel: 'Povodí', allRegions: 'Všechna povodí',   label of the filter built from station.pov
//     levels: { names: [5 strings], short: [5 strings] },   flood-degree names: none, 1, 2, 3, extreme (index = degree)
//     source: 'ČHMÚ',                    short credit shown in the map attribution
//     haNote: 'Zdroj: …',               optional note under the long-term mean level (station.ha) in the station panel: source and reference period
//     about: '<p>…</p>',                 HTML for the "O datech a zdrojích" note: licence, required attribution wording, disclaimer
//     sources: {                         what the build fetches; each has its own cache and minimum age
//       stations:   { ttlMin: 25, build },    required. build(prev) -> { updated, stations: [station] }; updated = ISO string (epoch numbers are converted, future times capped to now)
//       reservoirs: { ttlMin: 55, build },    optional. -> { updated, reservoirs, weirs, errors }
//       climate:    { ttlMin: 10080, build }, optional. -> { stations: { id: … } }
//     },
//   }
// build(prev) gets the previous result (or null) so it can keep what it cannot refetch (see mergeHistory).
//
// A station:
//   { id (string, unique in the country), name, river, lat, lon,
//     h: [t1, t2, t3, t4]   flood thresholds of the water level in cm (null where unknown), for flood degrees 1 to 4
//     q: [t1, t2, t3, t4]   the same for discharge in m3/s,
//     pov: 'region name',   used by the region filter,
//     dryH, dryQ,           low-water marks or null; ha, qa: long-term mean level (cm) / discharge (m3/s) or null,
//     H: [[epochSeconds, cm], …], Q: [[epochSeconds, m3/s], …]  oldest first }
// The frontend works without thresholds (the station is then grey), and without H or Q.

export const UA = 'water-map (+https://github.com/bremondr/water)';

export async function fetchText(url, { timeoutMs = 60_000, headers = {} } = {}) {
  const r = await fetch(url, { headers: { 'user-agent': UA, ...headers }, signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.text();
}
export async function fetchJson(url, opts) { return JSON.parse(await fetchText(url, { ...opts, headers: { accept: 'application/json', ...opts?.headers } })); }

// Pure. Merge the series of the previous run into this run's stations (matched by id) and keep the last `hours` hours. For sources that only
// publish the latest reading, this builds up a history across scheduled runs, without any extra requests.
export function mergeHistory(prevStations, stations, hours = 48) {
  const prev = new Map((prevStations ?? []).map(s => [s.id, s]));
  return stations.map(s => {
    const out = { ...s };
    for (const key of ['H', 'Q']) {
      const byTime = new Map();
      for (const p of [...(prev.get(s.id)?.[key] ?? []), ...(s[key] ?? [])]) if (p[1] != null) byTime.set(p[0], p);
      const all = [...byTime.values()].sort((a, b) => a[0] - b[0]);
      const t1 = all.length ? all.at(-1)[0] : 0;
      out[key] = all.filter(p => p[0] >= t1 - hours * 3600);
    }
    return out;
  });
}

// Pure. Drop stations that cannot be shown and return the rest with every field the frontend reads filled in.
export function normalizeStations(list) {
  const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const four = a => [0, 1, 2, 3].map(i => num(a?.[i]));
  const out = [];
  for (const s of list) {
    if (!s || s.id == null || !s.name || !Number.isFinite(s.lat) || !Number.isFinite(s.lon)) continue;
    if (Math.abs(s.lat) > 90 || Math.abs(s.lon) > 180) continue;
    out.push({
      id: String(s.id), name: String(s.name), river: s.river ? String(s.river) : '', lat: s.lat, lon: s.lon,
      h: four(s.h), q: four(s.q), pov: s.pov || 'Ostatní', dryH: num(s.dryH), dryQ: num(s.dryQ), ha: num(s.ha), qa: num(s.qa),
      H: (s.H ?? []).filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1])), Q: (s.Q ?? []).filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1])),
    });
  }
  return out;
}

// Pure. `updated` of a stations result as an ISO string: accepts ISO strings, Date, epoch seconds or milliseconds; a time in the future (clock skew
// or a source that mislabels local time) is capped to `now`; anything unreadable becomes `now`.
export function normalizeUpdated(u, now = Date.now()) {
  let t = u instanceof Date ? u.getTime() : typeof u === 'number' ? (u < 1e11 ? u * 1000 : u) : Date.parse(u);
  if (!Number.isFinite(t)) t = now;
  return new Date(Math.min(t, now)).toISOString();
}

// the generic names used when a country has no official flood-degree scheme
export const GENERIC_LEVELS = { names: ['Bez varování', '1. stupeň', '2. stupeň', '3. stupeň', 'Extrém'], short: ['Normální', '1. stupeň', '2. stupeň', '3. stupeň', 'Extrém'] };
