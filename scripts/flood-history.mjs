// Flood history of the fetched stations from the ČHMÚ historical open data, to see what has happened since the N-year flows of the
// stations were last evaluated (the NY files say 2000):
//  - annual maximum stage (cm) 2000-2025 from the measured and hourly water levels, with the date, and the largest events
//  - annual maximum of the monthly maximum discharge (m3/s, MMQ, from 1975) and a Gumbel fit to get updated 5/20/100-year flows
//  - the same events expressed against the published (year 2000) N-year flows
//   node scripts/flood-history.mjs [stationId ...]
import { readFileSync } from 'node:fs';

const dir = new URL('../experiments/flood/data/', import.meta.url);
const ids = process.argv.length > 2 ? process.argv.slice(2) : JSON.parse(readFileSync(new URL('index.json', dir))).map(s => s.id);
const H = 'https://opendata.chmi.cz/hydrology/historical/data', CHAR = 'https://opendata.chmi.cz/hydrology/characteristic/data';
const getJson = async url => { try { const r = await fetch(url, { signal: AbortSignal.timeout(60_000) }); return r.ok ? r.json() : null; } catch { return null; } };
const values = doc => doc?.tsList?.[0]?.tsData?.data?.values ?? [];

// Gumbel (method of moments): flow for return period T
function gumbel(series) {
  const n = series.length, mean = series.reduce((a, b) => a + b, 0) / n, sd = Math.sqrt(series.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1));
  const beta = sd * Math.sqrt(6) / Math.PI, mu = mean - 0.5772 * beta;
  return T => mu - beta * Math.log(-Math.log(1 - 1 / T));
}

for (const id of ids) {
  const meta = JSON.parse(readFileSync(new URL(`${id}.json`, dir))), st = meta.station;
  console.log(`\n=== ${st.name} (${st.river}) ===`);
  // stage: measured values (HC, irregular, from 1994) and hourly (HH, from 2002), whichever exists; keep the maximum per year
  const yearMax = {};
  for (let y = 2000; y <= 2025; y++) {
    for (const [folder, code] of [['measured_water_level', 'OH'], ['hourly', 'HQ']]) {
      // some years/stations carry the discharge (M3_S) in the "level" folders (Prague and Ústí 2002), so only accept centimetres
      const doc = await getJson(`${H}/${folder}/H_${id}_${code}_${y}.json`);
      const rows = doc?.tsList?.[0]?.unit === 'CM' ? values(doc) : [];
      for (const [dt, v] of rows) if (typeof v === 'number' && (!yearMax[y] || v > yearMax[y].cm)) yearMax[y] = { cm: v, dt: dt.slice(0, 16).replace('T', ' ') };
    }
  }
  const years = Object.keys(yearMax);
  if (!years.length) console.log('no stage data since 2000'); else {
    const top = Object.entries(yearMax).sort((a, b) => b[1].cm - a[1].cm).slice(0, 6);
    console.log('largest annual maximum stages since 2000 (cm):', top.map(([y, v]) => `${v.dt.slice(0, 10)} ${v.cm}`).join(' | '));
    console.log(`first year with data: ${years[0]}, years with data: ${years.length}; flood-activity levels: ${st.spaH.map((v, i) => v == null ? null : `${i + 1}.SPA ${v}`).filter(Boolean).join(', ')}`);
  }
  // discharge: annual maximum of the monthly maxima since 1975
  const annual = {};
  for (let y = 1975; y <= 2025; y++) {
    const rows = values(await getJson(`${H}/monthly_max/H_${id}_MMQ_${y}.json`));
    for (const [dt, v] of rows) if (typeof v === 'number' && (!annual[y] || v > annual[y].q)) annual[y] = { q: v, dt: dt.slice(0, 10) };
  }
  const ys = Object.keys(annual);
  if (ys.length < 15) { console.log(`discharge: only ${ys.length} years of monthly maxima`); continue; }
  const qs = ys.map(y => annual[y].q), n = qs.length;
  const ny = (await getJson(`${CHAR}/hydrological_characteristic/NY_${id}.json`))?.charList?.[0]?.charData?.data?.values ?? [];
  const pub = T => ny.find(v => v[0] === T)?.[1];
  const topQ = Object.entries(annual).sort((a, b) => b[1].q - a[1].q).slice(0, 6);
  console.log(`annual maximum discharge ${ys[0]}-${ys.at(-1)} (${n} years), largest: ${topQ.map(([y, v]) => `${v.dt} ${v.q}`).join(' | ')} m3/s`);
  const rankOf = q => qs.filter(x => x >= q).length;
  console.log('return period of the largest events from this record (Weibull, n+1 / rank):', topQ.slice(0, 4).map(([, v]) => `${v.dt.slice(0, 7)}: ${((n + 1) / rankOf(v.q)).toFixed(0)} y`).join(', '));
  const all = gumbel(qs), since = gumbel(Object.entries(annual).filter(([y]) => +y <= 2000).map(([, v]) => v.q));
  console.log('N-year flow   published (evaluated to 2000)   Gumbel fit, record to 2000   Gumbel fit, record to 2025');
  for (const T of [5, 20, 100]) console.log(`Q${String(T).padEnd(4)}         ${String(pub(T) ?? '–').padStart(8)}                    ${since(T).toFixed(0).padStart(8)}                     ${all(T).toFixed(0).padStart(8)}`);
  console.log('(monthly maxima are daily means, so they understate the instantaneous peaks that N-year flows describe)');
}
