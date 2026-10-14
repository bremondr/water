// Reservoir scraper for the five state-enterprise basin authorities (povodí).
// None of them has an API. All five run the same "MGE Data" portal, whose reservoir pages are
// server-rendered tables, so one parser serves them all:
//   Prehled.aspx = level, volume, inflow, outflow, precipitation, air temp, outflow return-period flows
//   Objemy.aspx  = storage fill (the page reuses the same element ids with a different meaning per column)
export const PLATFORMS = [
  { key: 'pla', pov: 'Povodí Labe',   base: 'https://www.pla.cz/portal/nadrze/cz/pc' },
  { key: 'pvl', pov: 'Povodí Vltavy', base: 'https://www.pvl.cz/portal/Nadrze/cz/pc' },
  { key: 'poh', pov: 'Povodí Ohře',   base: 'https://sap.poh.cz/portal/Nadrze/cz/pc' },
  { key: 'pod', pov: 'Povodí Odry',   base: 'https://www.pod.cz/portal/Nadrze/cz/pc' },
  { key: 'pmo', pov: 'Povodí Moravy', base: 'https://sap.pmo.cz/portal/Nadrze/cz/pc' },
];

// ČHMÚ publishes no gauge between Orlík and Zbraslav (its "VD Orlík"/"VD Vrané" stations have no data),
// so the nearest flow measurements below the whole cascade are Zbraslav (river km 65,2) and Praha - Chuchle
// (km 60,1). The client looks these up in the station data it already has.
export const CASCADE_REF = ['0-203-1-169000', '0-203-1-200100'];

const UA = 'Mozilla/5.0 (compatible; povodi-prototype)';
const num = s => { const n = parseFloat(String(s ?? '').replace(/\s/g, '').replace(',', '.')); return Number.isFinite(n) ? n : null; };
const unent = s => s.replace(/<[^>]*>/g, '').replace(/&#(\d+);/g, (_, c) => String.fromCharCode(c)).replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').trim();

// The portals bounce a cookie-less first request through a "WaitPage" splash, and the redirect chain
// only lands on the data page when the session cookie survives it, so follow redirects by hand.
export async function getPage(url) {
  const jar = new Map();
  for (let attempt = 0; attempt < 3; attempt++) {
    let u = url, html = '';
    for (let hop = 0; hop < 6; hop++) {
      const res = await fetch(u, {
        redirect: 'manual', headers: { 'user-agent': UA, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') },
      });
      for (const c of res.headers.getSetCookie?.() ?? []) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar.set(kv.slice(0, i), kv.slice(i + 1)); }
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) { u = new URL(res.headers.get('location'), u).href; continue; }
      if (!res.ok) throw new Error(`${res.status} ${u}`);
      html = await res.text(); break;
    }
    if (html.includes('Mereni.aspx')) return html;   // got the data table
  }
  throw new Error(`no data table at ${url}`);
}

// Pure: one portal page -> [{ id, name, Label1 (river), casSLbl, hladinaLbl, ... }], values as displayed text.
export function parseTable(html) {
  const rows = {};
  for (const m of html.matchAll(/<a id="[^"]*_ctl(\d+)_[^"]*"[^>]*href="Mereni\.aspx\?id=(\w+)[^"]*"[^>]*>([^<]*)<\/a>/g))
    rows[m[1]] = { id: m[2], name: unent(m[3]) };
  for (const m of html.matchAll(/<span id="[^"]*_ctl(\d+)_(\w+)"[^>]*>([\s\S]*?)<\/span>/g))
    if (rows[m[1]]) rows[m[1]][m[2]] = unent(m[3]);
  return Object.values(rows);
}

// Pure: join the two parsed pages of one portal into reservoir records (no coordinates yet).
export function joinTables(platform, pre, vol) {
  const volById = new Map(vol.map(v => [v.id, v]));
  return pre.map(r => {
    const v = volById.get(r.id) || {};
    return {
      key: `${platform.key}:${r.id}`, pov: platform.pov,
      name: r.name.replace(/^VD\s+/, ''), river: r.Label1,
      time: r.casSLbl,                       // local Czech time, "14.10.2026 11:20"
      level: num(r.hladinaLbl),              // m a.s.l.
      volume: num(r.objemLbl),               // million m3
      inflow: num(r.pritokLbl), outflow: num(r.prutokLbl),   // m3/s
      precip: num(r.srazkyLbl), temp: num(r.teplotaLbl),     // mm / 24 h, degC
      qa: num(r.qaOdtok), q1: num(r.q1Odtok), q5: num(r.q5Odtok), q20: num(r.q20Odtok), q100: num(r.q100Odtok),
      storedMil: num(v.hladinaLbl), fillPct: num(v.objemLbl), freeMil: num(v.pritokLbl), freePct: num(v.prutokLbl),
      note: r.Label6 || '',
    };
  });
}

// Dams as published (no coordinates yet). One portal failing must not take the others down, so each is
// settled on its own: returns { dams, errors: [{ key, pov, message }] }.
export async function scrapeAll(platforms = PLATFORMS) {
  const results = await Promise.allSettled(platforms.map(async p => {
    const [pre, vol] = await Promise.all(['Prehled', 'Objemy'].map(async page => parseTable(await getPage(`${p.base}/${page}.aspx`))));
    if (!pre.length) throw new Error('page parsed but contains no rows (layout change?)');
    return joinTables(p, pre, vol);
  }));
  const dams = [], errors = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') dams.push(...r.value);
    else errors.push({ key: platforms[i].key, pov: platforms[i].pov, message: String(r.reason?.message ?? r.reason) });
  });
  return { dams, errors };
}

// Pure: attach positions and apply data-quality rules. `coords` is dam-coords.json: key -> [lat, lon, approx?].
// Dams without a position are left out.
export function finalizeReservoirs(all, coords) {
  const out = all
    .filter(d => !/přepočítaná/i.test(d.name))                   // Povodí Moravy lists Dalešice twice
    .map(d => ({
      ...d, lat: coords[d.key]?.[0], lon: coords[d.key]?.[1],
      approx: coords[d.key]?.[2] === 1,                              // position is a village/locality centre, not the dam
      note: d.note === `VD ${d.name}` ? '' : d.note,                  // Odra repeats the name as a note
      warnings: [],
    }))
    .filter(d => d.lat != null);
  for (const d of out) {
    // The Vltava cascade (Orlík, Kamýk, Slapy, Štěchovice) is published with outflow exactly 0,00 while
    // inflow is 10-25 m3/s and the river below carries ~30-40 m3/s (ČHMÚ Praha-Chuchle, Zbraslav). It is a
    // placeholder for "not reported", so hide it instead of showing a false zero.
    if (d.outflow === 0 && (d.inflow ?? 0) >= 1) {
      d.warnings.push(`Portál uvádí odtok 0,00 m³/s při přítoku ${String(d.inflow).replace('.', ',')} m³/s. Řeka pod nádrží přitom teče, takže jde o nenahlášenou hodnotu, ne o skutečnou nulu. Odtok je skrytý, orientační průtok pod kaskádou je níže.`);
      d.outflow = null;
      d.refGauges = CASCADE_REF;
    }
    if (d.inflow != null && d.inflow < 0)
      d.warnings.push('Záporný přítok je dopočtený z bilance nádrže (změna objemu a odtok), není měřený.');
  }
  out.sort((a, b) => a.name.localeCompare(b.name, 'cs'));
  return out;
}
