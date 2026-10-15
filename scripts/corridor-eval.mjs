// Evaluates the corridor flood model against the official flood zones for real events (peak stage at every gauge on the corridor, taken
// from the ČHMÚ history) and compares ways of building the water surface:
//   flat      one gauge's level everywhere (the old single-plane idea, here with the level of the `anchor` gauge)
//   profile   level interpolated along the river between all gauges with data (continuous surface)
//   profile+  the same, extrapolating with a flat level outside the outermost gauges
//   weirs     flat pools between the known weirs and steps at them
//   node scripts/corridor-eval.mjs [corridor dir name] [anchor gauge name]
import { readFileSync } from 'node:fs';
import { buildLevelLut, floodCorridor, findSeeds, NO_S, NODATA } from '../corridor.mjs';
import { compareWithZone } from '../experiments/flood/flood.mjs';

const name = process.argv[2] ?? 'corridor-labe', anchorName = process.argv[3] ?? 'Mělník';
const dir = new URL(`../experiments/flood/data/${name}/`, import.meta.url);
const m = JSON.parse(readFileSync(new URL('manifest.json', dir)));
const u16 = f => { const b = readFileSync(new URL(f, dir)); return new Uint16Array(b.buffer, b.byteOffset, b.byteLength / 2); };
const z = u16('z.bin'), s = u16('s.bin'), zb = readFileSync(new URL('zones.bin', dir)), zones = new Uint8Array(zb.buffer, zb.byteOffset, zb.byteLength);
for (let i = 0; i < zones.length; i++) if (s[i] === NO_S) zones[i] = 0;                 // only compare inside the corridor
const { W, H, groundPixel: gp } = m, cellKm2 = gp * gp / 1e6;
const BITS = m.zones.bits, ZN = [['Q5', BITS.Q5], ['Q20', BITS.Q20], ['Q100', BITS.Q100], ['Q500', BITS.Q500], ['aktivní zóna', BITS.AktivniZony]];
const zoneCells = Object.fromEntries(ZN.map(([n, b]) => { let c = 0; for (let i = 0; i < zones.length; i++) if (zones[i] & b) c++; return [n, c * cellKm2]; }));
console.log(`${name}: ${W} x ${H} cells, ${(m.length / 1000).toFixed(1)} km of river; official zone area inside the corridor: ${ZN.map(([n]) => `${n} ${zoneCells[n].toFixed(0)} km2`).join(', ')}`);
console.log('gauges:', m.gauges.map(g => `${g.name} (s ${(g.s / 1000).toFixed(1)} km, zero ${g.zero})`).join('; '));
console.log('weirs:', m.weirs.map(w => `${w.name.replace(/^Zdymadlo /, '')} ${(w.s / 1000).toFixed(1)}`).join(', '));

const sMax = m.length + 1000;
const anchor = m.gauges.find(g => g.name === anchorName);
const run = (label, lut) => {
  const seeds = findSeeds(z, s, W, H, lut, m.centerline, Math.round(100 / gp), Math.round(160 / gp));
  const t0 = performance.now();
  const r = floodCorridor(z, s, W, H, lut, seeds);
  const out = ZN.map(([n, b]) => { const c = compareWithZone(r.mask, zones, b, null, W); return c.zoneCells ? `${n}: in ${(c.precision * 100).toFixed(0)}% cov ${(c.recall * 100).toFixed(0)}% IoU ${c.iou.toFixed(2)}` : `${n}: –`; });
  console.log(`  ${label.padEnd(10)} ${(r.count * cellKm2).toFixed(1).padStart(6)} km2, max depth ${(r.maxDepthDm / 10).toFixed(1)} m, ${seeds.length} seeds, ${(performance.now() - t0).toFixed(0)} ms | ${out.join(' | ')}`);
  return r;
};

for (const [event, peaks] of Object.entries(m.events)) {
  const pts = m.gauges.filter(g => peaks[g.id]).map(g => ({ s: g.s, level: g.zero + peaks[g.id].cm / 100, name: g.name, cm: peaks[g.id].cm }));
  console.log(`\n=== ${event}: ${pts.map(p => `${p.name} ${p.cm} cm = ${p.level.toFixed(2)} m`).join(', ')} ===`);
  if (pts.length < 2) { console.log('  fewer than two gauges with data, skipped'); continue; }
  const flatLevel = pts.find(p => p.name === anchorName)?.level ?? pts[0].level;
  run(`flat@${anchorName.slice(0, 3)}`, buildLevelLut({ points: [{ s: 0, level: flatLevel }], sMax }));
  run('profile', buildLevelLut({ points: pts, sMax, extrapolate: 'slope' }));
  run('profile+', buildLevelLut({ points: pts, sMax, extrapolate: 'flat' }));
  run('weirs', buildLevelLut({ points: pts, sMax, weirs: m.weirs.filter(w => !w.live), stepWeirs: true, extrapolate: 'flat' }));
}
