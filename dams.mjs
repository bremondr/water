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

const UA = 'Mozilla/5.0 (compatible; povodi-prototype)';
const num = s => { const n = parseFloat(String(s ?? '').replace(/\s/g, '').replace(',', '.')); return Number.isFinite(n) ? n : null; };
const unent = s => s.replace(/<[^>]*>/g, '').replace(/&#(\d+);/g, (_, c) => String.fromCharCode(c)).replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').trim();

// The portals bounce a cookie-less first request through a "WaitPage" splash, and the redirect chain
// only lands on the data page when the session cookie survives it, so follow redirects by hand.
async function getPage(url) {
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

async function scrapeTable(base, page) {
  const h = await getPage(`${base}/${page}.aspx`);
  const rows = {};
  for (const m of h.matchAll(/<a id="[^"]*_ctl(\d+)_[^"]*"[^>]*href="Mereni\.aspx\?id=(\w+)[^"]*"[^>]*>([^<]*)<\/a>/g))
    rows[m[1]] = { id: m[2], name: unent(m[3]) };
  for (const m of h.matchAll(/<span id="[^"]*_ctl(\d+)_(\w+)"[^>]*>([\s\S]*?)<\/span>/g))
    if (rows[m[1]]) rows[m[1]][m[2]] = unent(m[3]);
  return Object.values(rows);
}

// Dams as published (no coordinates yet).
export async function scrapeAll() {
  const out = [];
  await Promise.all(PLATFORMS.map(async p => {
    const [pre, vol] = await Promise.all([scrapeTable(p.base, 'Prehled'), scrapeTable(p.base, 'Objemy')]);
    const volById = new Map(vol.map(v => [v.id, v]));
    for (const r of pre) {
      const v = volById.get(r.id) || {};
      out.push({
        key: `${p.key}:${r.id}`, pov: p.pov,
        name: r.name.replace(/^VD\s+/, ''), river: r.Label1,
        time: r.casSLbl,                       // local Czech time, "14.10.2026 11:20"
        level: num(r.hladinaLbl),              // m a.s.l.
        volume: num(r.objemLbl),               // million m3
        inflow: num(r.pritokLbl), outflow: num(r.prutokLbl),   // m3/s
        precip: num(r.srazkyLbl), temp: num(r.teplotaLbl),     // mm / 24 h, degC
        qa: num(r.qaOdtok), q1: num(r.q1Odtok), q5: num(r.q5Odtok), q20: num(r.q20Odtok), q100: num(r.q100Odtok),
        storedMil: num(v.hladinaLbl), fillPct: num(v.objemLbl), freeMil: num(v.pritokLbl), freePct: num(v.prutokLbl),
        note: r.Label6 || '',
      });
    }
  }));
  return out;
}
