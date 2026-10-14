// Long-term hydrological characteristics per river station, from the ČHMÚ open data "characteristic" set:
//   CHAR_MDQ_<id>.json   M-day discharges (flow-duration curve, Q30 .. Q364), long-term average Qa and Pa
//   CHAR_MONQ_<id>.json  per calendar month: average / minimum / maximum daily discharge
// Both cover a fixed reference period (1991-2020 at the time of writing) and change rarely, so they are fetched
// once and cached for days, separately from the 10-minute live data.
const BASE = 'https://opendata.chmi.cz/hydrology/characteristic';

async function getJson(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (r.status === 404) return null;                 // station without that characteristic
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

const table = c => c.charData.data.values;          // [[x, y], ...]

// Pure: the two raw documents of one station -> compact record (or null if neither has usable data).
export function parseClimate(mdq, monq) {
  const rec = {};
  const qm = mdq?.charList?.find(c => c.charType === 'QM');
  if (qm) {
    rec.period = qm.referencePeriod ?? null;         // e.g. "1991 - 2020"
    rec.qa = qm.Qa ?? null;                          // long-term average discharge, m3/s
    rec.pa = qm.Pa ?? null;                          // long-term average precipitation, mm
    rec.mdq = table(qm);                             // [[days exceeded per year, m3/s], ...]
  }
  const month = type => {
    const c = monq?.charList?.find(x => x.charType === type);
    if (!c) return null;
    const out = Array(12).fill(null);
    for (const [m, q] of table(c)) if (m >= 1 && m <= 12) out[m - 1] = q;
    return out;
  };
  const avg = month('QM_AVG'), min = month('QM_MIN'), max = month('QM_MAX');
  if (avg) { rec.avg = avg; rec.min = min; rec.max = max; rec.period ??= monq.charList[0].referencePeriod ?? null; }
  return Object.keys(rec).length ? rec : null;
}

// Pure: how many days a year a flow is reached or exceeded, interpolated on the M-day curve.
// Returns { days, bound } where bound is '<' / '>' when the flow is outside the published range.
export function exceedanceDays(mdq, q) {
  if (!mdq?.length || q == null) return null;
  const pts = mdq.slice().sort((a, b) => a[0] - b[0]);          // days ascending, flow descending
  if (q > pts[0][1]) return { days: pts[0][0], bound: '<' };
  if (q < pts.at(-1)[1]) return { days: pts.at(-1)[0], bound: '>' };
  for (let i = 1; i < pts.length; i++) {
    const [d0, q0] = pts[i - 1], [d1, q1] = pts[i];
    if (q <= q0 && q >= q1) return { days: q0 === q1 ? d0 : Math.round(d0 + (d1 - d0) * (q0 - q) / (q0 - q1)), bound: '' };
  }
  return null;
}

export async function buildClimate() {
  const meta = await getJson(`${BASE}/metadata/hydrological_characteristic/meta1.json`);
  const ids = meta.data.data.values.map(v => v[0]);
  const stations = {};
  let i = 0, failed = 0;
  async function worker() {
    while (i < ids.length) {
      const id = ids[i++];
      try {
        const [mdq, monq] = await Promise.all([
          getJson(`${BASE}/data/hydrological_characteristic/CHAR_MDQ_${id}.json`),
          getJson(`${BASE}/data/hydrological_characteristic/CHAR_MONQ_${id}.json`),
        ]);
        const rec = parseClimate(mdq, monq);
        if (rec) stations[id] = rec;
      } catch { failed++; }
    }
  }
  await Promise.all(Array.from({ length: 12 }, worker));
  if (!Object.keys(stations).length) throw new Error('no climate data returned');
  if (failed) console.error(`[climate] ${failed} of ${ids.length} stations failed and are missing`);
  return { updated: new Date().toISOString(), stations };
}
