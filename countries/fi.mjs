// Finsko: SYKE (Suomen ympäristökeskus) hydrology OData API, daily values of water level (Vedenkorkeus) and discharge (Virtaama).
// Entities: Paikka (places; Suure_Id 1 = water level, 2 = discharge), Vedenkorkeus and Virtaama (Paikka_Id, Aika, Arvo). Server pages are 500 rows
// and carry an odata.nextLink. One bulk query per entity for the last few days, so a build is about 12 requests, not one per station.
import { fetchJson, mergeHistory, GENERIC_LEVELS } from './lib.mjs';

const API = 'https://rajapinnat.ymparisto.fi/api/Hydrologiarajapinta/1.1/odata';
const DAYS = 3;

// "622536" (DDMMSS) -> 62.4267
export function dms(s) {
  if (s == null || String(s).trim() === '') return null;
  const t = String(s).trim().padStart(6, '0');
  if (!/^\d{6}$/.test(t)) return null;
  return +t.slice(0, 2) + +t.slice(2, 4) / 60 + +t.slice(4, 6) / 3600;
}

// "2026-11-10T00:00:00" is the local (Finnish) date of a daily value -> epoch seconds of that midnight in Europe/Helsinki
export function helsinkiMidnight(iso) {
  const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)/.exec(iso ?? '');
  if (!m) return null;
  const asUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Helsinki', hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(new Date(asUtc)).map(p => [p.type, +p.value]));
  const offset = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - asUtc;
  return Math.round((asUtc - offset) / 1000);
}

// Pure. places: Paikka rows, levels/flows: Vedenkorkeus/Virtaama rows. Only places with a value in the window become stations; a level place and
// a discharge place with the same station number (Nro) are one station. Level Arvo is cm (the reference differs per place), discharge is m3/s.
export function parseStations(places, levels, flows) {
  const series = rows => { const m = new Map(); for (const r of rows) { const v = r.Arvo == null || r.Arvo === '' ? NaN : Number(r.Arvo), t = helsinkiMidnight(r.Aika); if (Number.isFinite(v) && t != null) (m.get(r.Paikka_Id) ?? m.set(r.Paikka_Id, []).get(r.Paikka_Id)).push([t, v]); } for (const a of m.values()) a.sort((x, y) => x[0] - y[0]); return m; };
  const L = series(levels), Q = series(flows);
  const groups = new Map();
  for (const p of places) {
    const kind = p.Suure_Id === 1 ? 'H' : p.Suure_Id === 2 ? 'Q' : null;
    const data = kind === 'H' ? L.get(p.Paikka_Id) : kind === 'Q' ? Q.get(p.Paikka_Id) : null;
    if (!data || dms(p.KoordLat) == null || dms(p.KoordLong) == null) continue;
    const key = String(p.Nro ?? '').trim() || `p${p.Paikka_Id}`;
    const g = groups.get(key) ?? groups.set(key, {}).get(key);
    if (g[kind]) g[kind + 'dup'] = true;
    else g[kind] = { p, data };
  }
  const out = [];
  for (const [nro, g] of groups) {
    if (g.Hdup || g.Qdup) continue; // two places of one kind under one number: ambiguous, skip
    const main = (g.Q ?? g.H).p;
    const full = String(main.Nimi ?? '').trim();
    out.push({
      id: nro, name: full, river: (main.PaaVesalNimi ?? '').trim(),
      lat: dms(main.KoordLat), lon: dms(main.KoordLong), pov: (main.PaaVesalNimi ?? '').trim() || 'Ostatní',
      h: [null, null, null, null], q: [null, null, null, null],
      H: g.H ? g.H.data : [], Q: g.Q ? g.Q.data : [],
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

async function pages(url) {
  const rows = [];
  for (let n = 0; url && n < 40; n++) { const j = await fetchJson(url); rows.push(...j.value); url = j['odata.nextLink']; }
  return rows;
}

async function build(prev) {
  const d = new Date(Date.now() - DAYS * 86400_000).toISOString().slice(0, 10);
  const win = `$filter=${encodeURIComponent(`Aika ge datetime'${d}T00:00:00'`)}&$select=Paikka_Id,Aika,Arvo`;
  const levels = await pages(`${API}/Vedenkorkeus?${win}`);
  const flows = await pages(`${API}/Virtaama?${win}`);
  const places = await pages(`${API}/Paikka?$filter=${encodeURIComponent('Suure_Id eq 1 or Suure_Id eq 2')}&$select=${['Paikka_Id', 'Suure_Id', 'Nro', 'Nimi', 'KoordLat', 'KoordLong', 'PaaVesalNimi'].join(',')}`);
  const stations = mergeHistory(prev?.stations, parseStations(places, levels, flows), 7 * 24);
  return { updated: new Date().toISOString(), stations };
}

export default {
  id: 'fi', name: 'Finsko', center: [64.5, 26.5], zoom: 5,
  regionLabel: 'Povodí', allRegions: 'Všechna povodí',
  levels: GENERIC_LEVELS,
  source: 'Syke',
  about: `<p>Zdroj: Suomen ympäristökeskus (Syke), <a href="https://www.syke.fi/en/open-data">Hydrologiarajapinta</a> (otevřená data, CC BY 4.0).
   <b>Lähde: Suomen ympäristökeskus (Syke).</b> Data jsou denní průměry (ne měření v reálném čase). Výška hladiny je v cm, vztažná úroveň se liší
   podle stanice (nula latě nebo výška nad mořem), proto ji nelze mezi stanicemi srovnávat. Stupně povodňové aktivity nejsou k dispozici, stanice jsou šedé.
   Informativní údaje bez záruky; Syke za jejich správnost ani dostupnost neodpovídá.</p>`,
  sources: { stations: { ttlMin: 180, build } },
};
