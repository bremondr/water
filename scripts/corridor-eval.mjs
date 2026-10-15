// Evaluates the corridor flood model against the official flood zones for real events (peak stage at every gauge on the corridor, taken
// from the ČHMÚ history) and compares ways of building the water surface:
//   flat      one gauge's level everywhere (the old single-plane idea, here with the level of the `anchor` gauge)
//   profile   level interpolated along each river between its gauges (continuous surface, slope beyond the outermost gauges)
//   profile+  the same with a flat level beyond the outermost gauges
//   weirs     flat pools between the known weirs and steps at them (main river)
// Tributaries start at the level of the main river at their mouth. Zone agreement is also listed per reach for the Q100 zone.
//   node scripts/corridor-eval.mjs [corridor dir name] [anchor gauge name]
import { readFileSync } from 'node:fs';
import { scenarioLuts, floodCorridor, findSeeds, NO_S } from '../corridor.mjs';
import { compareWithZone } from '../experiments/flood/flood.mjs';

const name = process.argv[2] ?? 'corridor-labe', anchorName = process.argv[3] ?? 'Mělník';
const dir = new URL(`../experiments/flood/data/${name}/`, import.meta.url);
const m = JSON.parse(readFileSync(new URL('manifest.json', dir)));
const u16 = f => { const b = readFileSync(new URL(f, dir)); return new Uint16Array(b.buffer, b.byteOffset, b.byteLength / 2); };
const z = u16('z.bin'), s = u16('s.bin'), rb = readFileSync(new URL('r.bin', dir)), r = new Uint8Array(rb.buffer, rb.byteOffset, rb.byteLength);
const zb = readFileSync(new URL('zones.bin', dir)), zones = new Uint8Array(zb.buffer, zb.byteOffset, zb.byteLength);
for (let i = 0; i < zones.length; i++) if (s[i] === NO_S) zones[i] = 0;                 // only compare inside the corridor
const { W, H, groundPixel: gp } = m, cellKm2 = gp * gp / 1e6;
const BITS = m.zones.bits, ZN = [['Q5', BITS.Q5], ['Q20', BITS.Q20], ['Q100', BITS.Q100], ['Q500', BITS.Q500], ['aktivní zóna', BITS.AktivniZony]];
const zoneCells = Object.fromEntries(ZN.map(([n, b]) => { let c = 0; for (let i = 0; i < zones.length; i++) if (zones[i] & b) c++; return [n, c * cellKm2]; }));
console.log(`${name}: ${W} x ${H} cells at ${gp.toFixed(1)} m; reaches: ${m.reaches.map(x => `${x.name} ${(x.length / 1000).toFixed(0)} km`).join(', ')}`);
console.log(`official zone area inside the corridor: ${ZN.map(([n]) => `${n} ${zoneCells[n].toFixed(0)} km2`).join(', ')}`);
console.log('gauges:', m.gauges.map(g => `${g.name} (${m.reaches[g.reach].id}, s ${(g.s / 1000).toFixed(1)} km)`).join('; '));

const run = (label, { lut, offsets }) => {
  const opts = { r, offsets }, seedSet = new Set();
  m.reaches.forEach(reach => { for (const i of findSeeds(z, s, W, H, lut, reach.centerline, Math.round(100 / gp), Math.round(160 / gp), opts)) seedSet.add(i); });
  const t0 = performance.now();
  const res = floodCorridor(z, s, W, H, lut, [...seedSet], opts);
  const out = ZN.map(([n, b]) => { const c = compareWithZone(res.mask, zones, b, null, W); return c.zoneCells ? `${n}: in ${(c.precision * 100).toFixed(0)}% cov ${(c.recall * 100).toFixed(0)}% IoU ${c.iou.toFixed(2)}` : `${n}: –`; });
  console.log(`  ${label.padEnd(10)} ${(res.count * cellKm2).toFixed(1).padStart(6)} km2, max depth ${(res.maxDepthDm / 10).toFixed(1)} m, ${(performance.now() - t0).toFixed(0)} ms | ${out.join(' | ')}`);
  // Q100 zone coverage per reach
  const cov = m.reaches.map((rc, k) => { let zc = 0, both = 0; for (let i = 0; i < zones.length; i++) if (r[i] === k && (zones[i] & BITS.Q100)) { zc++; if (res.mask[i]) both++; } return zc ? `${rc.id} ${(100 * both / zc).toFixed(0)}% of ${(zc * cellKm2).toFixed(0)} km2` : null; }).filter(Boolean);
  console.log(`  ${''.padEnd(10)} Q100 zone covered per reach: ${cov.join(', ')}`);
};

for (const [event, peaks] of Object.entries(m.events)) {
  const used = m.gauges.filter(g => peaks[g.id]);
  console.log(`\n=== ${event}: ${used.map(g => `${g.name} ${peaks[g.id].cm} cm`).join(', ')} ===`);
  if (!used.some(g => g.reach === 0) || used.filter(g => g.reach === 0).length < 2) { console.log('  fewer than two gauges on the main river with data, skipped'); continue; }
  const anchor = used.find(g => g.name === anchorName) ?? used[0];
  const flat = Int32Array.of(Math.round((anchor.zero + peaks[anchor.id].cm / 100) * 10));
  const flatLut = new Int32Array(Math.ceil((m.length + 5000) / 10) + 1).fill(flat[0]);
  run(`flat@${anchorName.slice(0, 3)}`, { lut: flatLut, offsets: m.reaches.map(() => 0) });
  run('profile', scenarioLuts(m, peaks, { extrapolate: 'slope' }));
  run('profile+', scenarioLuts(m, peaks, { extrapolate: 'flat' }));
  run('weirs', scenarioLuts(m, peaks, { extrapolate: 'flat', stepWeirs: true }));
}
