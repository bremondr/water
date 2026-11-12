// Slovinsko: ARSO (Agencija RS za okolje), one XML file with the latest reading of every automatic hydrological station.
// The file only has the newest value, so the history is built up across scheduled runs with mergeHistory.
import { fetchText, mergeHistory } from './lib.mjs';

export const URL_ARSO = 'https://www.arso.gov.si/xml/vode/hidro_podatki_zadnji.xml';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function decodeEntities(s) {
  return s.replace(/&(?:#x([0-9a-f]+)|#(\d+)|([a-z]+));/gi, (m, hex, dec, name) => {
    if (hex || dec) { try { return String.fromCodePoint(hex ? parseInt(hex, 16) : Number(dec)); } catch { return m; } }
    return ENTITIES[name.toLowerCase()] ?? m;
  });
}

const attrs = s => Object.fromEntries([...s.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)].map(m => [m[1], decodeEntities(m[2])]));
const num = v => { if (v == null || v === '') return null; const n = Number(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };
// "2026-11-12 00:00" given in CET (UTC+1, the file has no summer time field: `datum_cet`) -> epoch seconds
const cetToEpoch = t => { const m = /^(\d{4})-(\d\d)-(\d\d)[ T](\d\d):(\d\d)/.exec(t ?? ''); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 1, +m[5]) / 1000 : null; };

// Pure. XML text -> { updated, stations } (stations without a position are skipped). Tolerant tag scanner, no XML library.
export function parseArso(xml) {
  const stations = [];
  for (const m of xml.matchAll(/<postaja\b([^>]*?)(\/?)>([\s\S]*?)<\/postaja>/g)) {
    const a = attrs(m[1]);
    const f = {};
    for (const t of m[3].matchAll(/<([a-z_0-9]+)\b[^>]*?(?:\/>|>([^<]*)<\/\1>)/g)) f[t[1]] = t[2] == null ? '' : decodeEntities(t[2]).trim();
    const lat = num(a.wgs84_sirina), lon = num(a.wgs84_dolzina);
    if (!('vodostaj' in f) && !('pretok' in f)) continue; // sea buoy, no river gauge
    if (!a.sifra || lat == null || lon == null || !f.merilno_mesto) continue;
    const t = cetToEpoch(f.datum_cet || f.datum);
    const h = num(f.vodostaj), q = num(f.pretok);
    stations.push({
      id: a.sifra, name: f.merilno_mesto, river: f.reka ?? '', lat, lon, pov: f.reka || 'Ostatní',
      h: [num(f.prvi_vv_vodostaj), num(f.drugi_vv_vodostaj), num(f.tretji_vv_vodostaj), null],
      q: [num(f.prvi_vv_pretok), num(f.drugi_vv_pretok), num(f.tretji_vv_pretok), null],
      dryH: null, dryQ: null, ha: null, qa: null,
      H: t != null && h != null ? [[t, h]] : [], Q: t != null && q != null ? [[t, q]] : [],
    });
  }
  const upd = cetToEpoch((/<datum_priprave>([^<]*)</.exec(xml) ?? [])[1]);
  return { updated: upd, stations };
}

export async function buildStations(prev) {
  const { updated, stations } = parseArso(await fetchText(URL_ARSO));
  if (!stations.length) throw new Error('ARSO XML without stations');
  return { updated: new Date(updated != null ? updated * 1000 : Date.now()).toISOString(), stations: mergeHistory(prev?.stations, stations) };
}

export default {
  id: 'si', name: 'Slovinsko', center: [46.12, 14.82], zoom: 8,
  regionLabel: 'Řeka', allRegions: 'Všechny řeky',
  levels: {
    names: ['Bez vysoké vody', 'Vylití z koryta', 'Lokální záplavy', 'Rozsáhlé záplavy', 'Extrém'],
    short: ['Normální', 'Z koryta', 'Lokální', 'Rozsáhlé', 'Extrém'],
  },
  source: 'ARSO',
  about: `<p>Zdroj: Agencija RS za okolje (ARSO), <a href="${URL_ARSO}">hidro_podatki_zadnji.xml</a> (poslední hodnoty automatických stanic, obnova po 30 minutách).
   Vir: ARSO. Licence dat není na stránkách ARSO výslovně uvedena, proto je nepovažujeme za ověřenou; ARSO uvádí, že data jsou orientační
   a před-ověřená, mohou se po kontrole změnit (<a href="https://www.arso.gov.si/ostraneh.html">Izjava o začasnosti podatkov</a>).</p>
  <p>Tři stupně odpovídají „značilnim visokovodnim“ hodnotám ARSO: vylití z koryta, lokální záplavy, záplavy širšího rozsahu. Podle ARSO nejsou
   přímo spojeny s vyhlášeným stupněm ohrožení. Pokud ARSO udává práh jen v průtoku, stav se hodnotí podle průtoku. Historie se skládá z jednotlivých
   načtení (jen poslední 2 dny). Informativní údaje bez záruky, nejsou výstrahou ani předpovědí.</p>`,
  sources: { stations: { ttlMin: 30, build: buildStations } },
};
