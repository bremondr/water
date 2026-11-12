// Polsko: IMGW-PIB public data API (hydro). One JSON call returns every gauge with its latest reading, warning and alarm stage.
import { fetchJson, mergeHistory, normalizeStations } from './lib.mjs';

const URL = 'https://danepubliczne.imgw.pl/api/data/hydro';
const MAX_AGE_H = 48; // a reading older than this (against the newest in the response) is a dead gauge, not a current value

// "2026-11-11 23:20:00" -> epoch seconds. The portal's timestamps are treated as UTC (the newest readings are ~40 min older than
// the UTC clock at fetch time, which fits UTC and not Czech/Polish local time).
export function parseTime(s) {
  const m = /^(\d{4})-(\d\d)-(\d\d)[ T](\d\d):(\d\d)(?::(\d\d))?$/.exec(String(s ?? '').trim());
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0)) / 1000 : null;
}

// numbers arrive as strings ("226", "0.11"), possibly with a decimal comma; null, "" and "-" mean no value
export function num(v) {
  if (v == null) return null;
  const t = String(v).trim().replace(',', '.');
  if (t === '' || t === '-' || !/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

// Pure. IMGW hydro response (array) -> stations in the shared format. Stage in cm, discharge in m3/s as published.
export function parseHydro(rows) {
  if (!Array.isArray(rows)) throw new Error('IMGW hydro: expected an array');
  let newest = 0;
  for (const r of rows) for (const k of ['stan_wody_data_pomiaru', 'przeplyw_data']) newest = Math.max(newest, parseTime(r[k]) ?? 0);
  const fresh = t => t != null && t >= newest - MAX_AGE_H * 3600;
  const list = rows.map(r => {
    const warn = num(r.stan_ostrzegawczy), alarm = num(r.stan_alarmowy);
    const th = parseTime(r.stan_wody_data_pomiaru), tq = parseTime(r.przeplyw_data);
    const h = num(r.stan_wody), q = num(r.przeplyw);
    // about 30 lake gauges carry lat/lon "0" as a placeholder: no position, so they cannot be shown
    const lat = num(r.lat), lon = num(r.lon);
    if (!(lat > 48 && lat < 56 && lon > 13 && lon < 25)) return null;
    const pov = String(r.wojewodztwo ?? '').trim();
    return {
      id: r.id_stacji, name: String(r.stacja ?? '').trim(), river: String(r.rzeka ?? '').trim(), lat, lon,
      h: [warn, alarm, null, null], q: [null, null, null, null],
      pov: pov && pov !== '-' ? pov : 'Neurčeno',
      H: h != null && fresh(th) ? [[th, h]] : [], Q: q != null && fresh(tq) ? [[tq, q]] : [],
    };
  });
  return normalizeStations(list.filter(Boolean));
}

async function build(prev) {
  const stations = parseHydro(await fetchJson(URL));
  return { updated: new Date().toISOString(), stations: mergeHistory(prev?.stations, stations, 72) };
}

export default {
  id: 'pl', name: 'Polsko', center: [52.1, 19.4], zoom: 6,
  regionLabel: 'Vojvodství', allRegions: 'Všechna vojvodství',
  // IMGW publishes only the warning stage (stan ostrzegawczy) and alarm stage (stan alarmowy); they stand in for flood degrees 1 and 2.
  levels: {
    names: ['Pod stavem ostrzegawczym', 'Stan ostrzegawczy', 'Stan alarmowy', '3. stupeň (nepoužito)', 'Extrém (nepoužito)'],
    short: ['Normální', 'Ostrzegawczy', 'Alarmowy', '3. stupeň', 'Extrém'],
  },
  source: 'IMGW-PIB',
  about: `<p>Zdroj dat: IMGW-PIB, <a href="https://danepubliczne.imgw.pl/apiinfo">danepubliczne.imgw.pl</a> (hydrologická data, stav a průtok
   na stanicích, stav ostrzegawczy a alarmowy).</p>
   <p>Źródłem pochodzenia danych jest Instytut Meteorologii i Gospodarki Wodnej – Państwowy Instytut Badawczy.<br>
   Dane Instytutu Meteorologii i Gospodarki Wodnej – Państwowego Instytutu Badawczego zostały przetworzone.</p>
   <p>Data jsme přepočítali a zobrazujeme je barevně podle prahů: stav ostrzegawczy odpovídá 1. stupni a stav alarmowy 2. stupni
   (IMGW jiné prahy nezveřejňuje). Zdroj dává jen poslední hodnotu, historie vzniká z našich pravidelných aktualizací (cca 1x za hodinu).
   Údaje mohou být neověřené, jsou jen informativní a nenahrazují oficiální varování IMGW. Použití dat pro obchodní účely vyžaduje smlouvu s IMGW-PIB
   (Regulamin § 3 ust. 2, § 5 ust. 1).</p>`,
  sources: { stations: { ttlMin: 60, build } },
};
