// Weirs / locks on the Elbe with live data from Povodí Labe's "Stavy a průtoky" portal.
// They are not reservoirs, so they are not on the portal's reservoir pages, and ČHMÚ open data does not carry them
// either. Povodí Labe publishes each as a measuring station (Mereni.aspx) with an hourly table of level and flow.
// Only stations that report the level in m a.s.l. (a pool level above a weir) are weirs; of the 124 stations on
// that portal, exactly two do: Střekov and Opatovice nad Labem (checked 2026-10-14).
import { getPage } from './dams.mjs';

const PAGE = 'https://www.pla.cz/portal/sap/cz/pc/Mereni.aspx';

// Positions: Střekov from the OSM information boards at the lock (Nominatim), Opatovice from the OSM dam way
// next to the village. Both are marked approximate.
export const WEIRS = [
  { key: 'plaw:74', id: 74, oid: 3, name: 'Střekov (Masarykovo zdymadlo)', river: 'Labe', pov: 'Povodí Labe', lat: 50.6389, lon: 14.0494, approx: true },
  { key: 'plaw:65', id: 65, oid: 3, name: 'Opatovice nad Labem', river: 'Labe', pov: 'Povodí Labe', lat: 50.0759, lon: 15.8119, approx: true },
];

const num = s => { const n = parseFloat(String(s ?? '').replace(/\s/g, '').replace(',', '.')); return Number.isFinite(n) ? n : null; };

// "14.10.2026 17:00" in Czech local time -> epoch seconds (UTC)
export function pragueToEpoch(s) {
  const m = /^(\d\d)\.(\d\d)\.(\d{4}) (\d\d):(\d\d)$/.exec(s);
  if (!m) return null;
  const [, d, mo, y, h, mi] = m.map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Prague', hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' });
  const wall = new Map(fmt.formatToParts(guess).map(p => [p.type, +p.value]));
  const asUtc = Date.UTC(wall.get('year'), wall.get('month') - 1, wall.get('day'), wall.get('hour'), wall.get('minute'));
  return (guess - (asUtc - guess)) / 1000;
}

// Pure: one Mereni.aspx page -> { name, river, qLow, nYear, rows: [{ time, h, q }] } (rows newest first, as published)
export function parseStationPage(html) {
  const text = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&mdash;/g, '—').replace(/\s+/g, ' ');
  const span = id => new RegExp(`id="[^"]*${id}"[^>]*>([^<]*)<`).exec(html)?.[1]?.trim() ?? '';
  const nyear = /Q 1 Q 2 Q 5 Q 10 Q 20 Q 50 Q 100 ((?:[\d,.]+ ){6}[\d,.]+)/.exec(text)?.[1].split(' ').map(num);
  const rows = [];
  for (const tr of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(c => c[1].replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim());
    if (cells.length >= 3 && /^\d\d\.\d\d\.\d{4} \d\d:\d\d$/.test(cells[0])) rows.push({ time: cells[0], h: num(cells[1]), q: num(cells[2]) });
  }
  return {
    name: span('NazevStaniceLbl'), river: span('NazevTokuLbl'),
    qLow: num(/Q 355 : ([\d,.]+)/.exec(text)?.[1]),            // low-flow Q355
    nYear: nyear ? Object.fromEntries(['q1', 'q2', 'q5', 'q10', 'q20', 'q50', 'q100'].map((k, i) => [k, nyear[i]])) : null,
    rows,
  };
}

export async function scrapeWeirs(weirs = WEIRS) {
  const results = await Promise.allSettled(weirs.map(async w => {
    const p = parseStationPage(await getPage(`${PAGE}?id=${w.id}&oid=${w.oid}`, 'NazevStaniceLbl'));
    if (!p.rows.length) throw new Error('page parsed but contains no measurements (layout change?)');
    const asc = p.rows.slice().reverse().map(r => ({ ...r, t: pragueToEpoch(r.time) })).filter(r => r.t != null);
    const last = p.rows[0];
    return {
      key: w.key, kind: 'weir', pov: w.pov, name: w.name, river: w.river, lat: w.lat, lon: w.lon, approx: w.approx,
      time: last.time, level: last.h, flow: last.q,                     // m a.s.l., m3/s
      qLow: p.qLow, nYear: p.nYear,
      series: { H: asc.filter(r => r.h != null).map(r => [r.t, r.h]), Q: asc.filter(r => r.q != null).map(r => [r.t, r.q]) },
      warnings: [],
    };
  }));
  const out = [], errors = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') out.push(r.value);
    else errors.push({ key: weirs[i].key, pov: `${weirs[i].pov} (${weirs[i].name})`, message: String(r.reason?.message ?? r.reason) });
  });
  return { weirs: out, errors };
}
