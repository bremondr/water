// Downloads a terrain window (ČÚZK DMR 5G) around a ČHMÚ station for the flood-extent experiment.
//   node scripts/fetch-dem.mjs <stationId> [halfKm=2.5] [size=2000]
// Writes experiments/flood/data/<id>.json (location, gauge zero, thresholds, window) and <id>.bin (Uint16, 0.1 m
// units, 65535 = no data, rows north to south). The data folder is gitignored: re-create it with this script.
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { windowAround, fetchDem, unmercator } from '../dem.mjs';

const [id, halfKm = '2.5', size = '2000'] = process.argv.slice(2);
if (!id) { console.error('usage: node scripts/fetch-dem.mjs <stationId> [halfKm] [size]'); process.exit(1); }

const meta = (await (await fetch('https://opendata.chmi.cz/hydrology/now/metadata/meta3.json')).json()).data.data;
const col = Object.fromEntries(meta.header.split(',').map((c, i) => [c, i]));
const row = meta.values.find(v => v[col.objID] === id);
if (!row) throw new Error(`station ${id} not found in the ČHMÚ metadata`);
const st = { id, name: row[col.STATION_NAME], river: row[col.STREAM_NAME], lat: row[col.GEOGR1], lon: row[col.GEOGR2],
  zero: row[col.WGS_ELE],                                           // gauge zero ("nulový bod"), m a.s.l.
  spaH: [row[col.SPA1H], row[col.SPA2H], row[col.SPA3H], row[col.SPA4H]] };   // flood-activity levels, cm on the gauge
console.log(`${st.name} (${st.river}) ${st.lat.toFixed(4)}, ${st.lon.toFixed(4)}, gauge zero ${st.zero} m a.s.l.`);

const win = windowAround(st.lon, st.lat, +halfKm, +size);
console.log(`window ${(2 * halfKm).toFixed(1)} km square, ${size}x${size} px, ~${win.groundPixel.toFixed(2)} m per pixel on the ground`);
const dem = await fetchDem(win);

const u16 = new Uint16Array(dem.data.length);
let valid = 0, min = Infinity, max = -Infinity;
for (let i = 0; i < u16.length; i++) {
  const z = dem.data[i];
  if (Number.isFinite(z)) { u16[i] = Math.round(z * 10); valid++; if (z < min) min = z; if (z > max) max = z; } else u16[i] = 65535;
}
const [west, south] = unmercator(win.bbox[0], win.bbox[1]), [east, north] = unmercator(win.bbox[2], win.bbox[3]);
const out = new URL('../experiments/flood/data/', import.meta.url);
await mkdir(out, { recursive: true });
await writeFile(new URL(`${id}.bin`, out), Buffer.from(u16.buffer));
await writeFile(new URL(`${id}.json`, out), JSON.stringify({
  station: st, width: dem.width, height: dem.height, bbox3857: win.bbox, bounds: { west, south, east, north },
  groundPixel: win.groundPixel, unit: 0.1, noData: 65535, min: +min.toFixed(1), max: +max.toFixed(1),
  source: 'ČÚZK, DMR 5G (digitální model reliéfu České republiky 5. generace), Bpv', fetched: new Date().toISOString(),
}, null, 1));
console.log(`${valid} of ${u16.length} cells valid, heights ${min.toFixed(1)} to ${max.toFixed(1)} m a.s.l.  ->  experiments/flood/data/${id}.{json,bin}`);

// list of available datasets for the experiment page
let index = [];
try { index = JSON.parse(await readFile(new URL('index.json', out), 'utf8')); } catch { /* first dataset */ }
index = [...index.filter(x => x.id !== id), { id, name: st.name, river: st.river }].sort((a, b) => a.name.localeCompare(b.name, 'cs'));
await writeFile(new URL('index.json', out), JSON.stringify(index, null, 1));
