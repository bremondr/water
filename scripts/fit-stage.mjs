// For each station: which gauge stage makes the modelled flood (flat water plane, no distance limit) agree best with each official
// flood zone? Prints the best stage per zone with precision/recall/IoU, next to the stage the rating curve gives for the N-year
// flow of the same return period (an independent expectation) and the station's flood-activity levels.
//   node scripts/fit-stage.mjs [stationId ...]      (default: every dataset in experiments/flood/data/index.json)
import { readFileSync } from 'node:fs';
import { floodForStage, compareWithZone, pixelOf } from '../experiments/flood/flood.mjs';

const dir = new URL('../experiments/flood/data/', import.meta.url);
const read = name => readFileSync(new URL(name, dir));
const ids = process.argv.length > 2 ? process.argv.slice(2) : JSON.parse(read('index.json')).map(s => s.id);
const ZONES = [['Q5', 1, 5], ['Q20', 2, 20], ['Q100', 4, 100], ['aktivní zóna', 16, null]];   // [name, bit, return period]
const CHAR = 'https://opendata.chmi.cz/hydrology/characteristic/data';

async function getJson(url) { const r = await fetch(url); return r.ok ? r.json() : null; }
// stage (cm) at which the rating curve reaches flow q (m3/s); linear interpolation, null outside the curve
function stageForFlow(curve, q) {
  const pts = curve.slice().sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < pts.length; i++) {
    const [h0, q0] = pts[i - 1], [h1, q1] = pts[i];
    if (q >= q0 && q <= q1) return q1 === q0 ? h0 : h0 + (h1 - h0) * (q - q0) / (q1 - q0);
  }
  return null;
}

for (const id of ids) {
  const meta = JSON.parse(read(`${id}.json`)), st = meta.station;
  if (!meta.zones) { console.log(`\n${st.name}: no zones downloaded, skipped`); continue; }
  const b = read(`${id}.bin`), z = new Uint16Array(b.buffer, b.byteOffset, b.byteLength / 2);
  const zb = read(meta.zones.file), zones = new Uint8Array(zb.buffer, zb.byteOffset, zb.byteLength);
  const { width, height } = meta, { x: cx, y: cy } = pixelOf(meta, st.lon, st.lat);

  // independent expectation: N-year flow -> stage via the rating curve
  const ny = (await getJson(`${CHAR}/hydrological_characteristic/NY_${id}.json`))?.charList?.[0]?.charData?.data?.values ?? [];
  const rcDoc = await getJson(`${CHAR}/discharge_rating_curve/RC_${id}.json`);
  const rc = (Array.isArray(rcDoc) ? rcDoc.at(-1) : rcDoc)?.curveData?.data?.values ?? [];
  const expected = n => { const q = ny.find(v => v[0] === n)?.[1]; return q != null && rc.length ? { q, cm: stageForFlow(rc, q) } : null; };

  const present = ZONES.filter(([, bit]) => zones.some ? true : true).filter(([, bit]) => { for (let i = 0; i < zones.length; i += 97) if (zones[i] & bit) return true; return false; });
  const best = Object.fromEntries(present.map(([n]) => [n, null]));
  let scan = null;
  const from = (() => { const f = floodForStage({ z, width, height, cx, cy, zeroM: st.zero, stageCm: 0, noData: meta.noData }); scan = Math.round((z[f.seed] / 10 - st.zero) * 100); return scan; })();
  const to = Math.max(...st.spaH.filter(Boolean), from + 300) + 300;
  for (let cm = from; cm <= to; cm += 10) {
    const f = floodForStage({ z, width, height, cx, cy, zeroM: st.zero, stageCm: cm, noData: meta.noData });
    for (const [name, bit] of present) {
      const c = compareWithZone(f.mask, zones, bit);
      if (c.iou != null && (!best[name] || c.iou > best[name].iou)) best[name] = { cm, ...c };
    }
  }
  console.log(`\n=== ${st.name} (${st.river}), gauge zero ${st.zero} m a.s.l., terrain river level ${scan} cm, flood-activity levels ${st.spaH.map((v, i) => v == null ? null : `${i + 1}.SPA ${v}`).filter(Boolean).join(', ')} ===`);
  console.log('zone          best stage   IoU   in zone  zone covered   rating-curve stage for the N-year flow');
  for (const [name, , n] of present) {
    const r = best[name]; if (!r) { console.log(name.padEnd(13), 'no match'); continue; }
    const e = n ? expected(n) : null;
    console.log(`${name.padEnd(13)} ${String(r.cm).padStart(6)} cm  ${r.iou.toFixed(2)}   ${(r.precision * 100).toFixed(0).padStart(4)} %   ${(r.recall * 100).toFixed(0).padStart(6)} %      ${e ? (e.cm == null ? `Q${n} = ${e.q} m3/s, above the rating curve` : `Q${n} = ${e.q} m3/s -> ${e.cm.toFixed(0)} cm`) : n ? 'no N-year data' : '–'}`);
  }
}
