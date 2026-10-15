// River centreline for the corridor flood model, from the VÚV flood-zone WFS layer "úseky toků" (reaches of the river network,
// DIBAVOD, each with its river-km range). Geometry has the same datum mislabelling as the zones (see zones.mjs).
// The line of a reach runs from its upstream end to its downstream end and its length matches the km range (checked on the Labe:
// 100.2 km of line for 100.0 km of kilometrage), so the position along the line is the river coordinate `s` (metres) used by the model.
// s is measured from the downstream end of the corridor and grows upstream, like the water level does.
import { besselAsWgsToWgs } from './zones.mjs';

const WFS = 'https://ags.vuv.cz/arcgis/services/isvs_voda/isvs_voda/MapServer/WFSServer';

export async function fetchReaches(river, { south, west, north, east }) {
  const q = new URLSearchParams({
    service: 'WFS', version: '2.0.0', request: 'GetFeature', typeNames: 'ZaplavUzemi_UsekyToku', outputFormat: 'GEOJSON', srsName: 'EPSG:4326',
    bbox: `${south},${west},${north},${east},urn:ogc:def:crs:EPSG::4326`, count: '1000',
  });
  const j = await (await fetch(`${WFS}?${q}`, { signal: AbortSignal.timeout(120_000) })).json();
  if (!Array.isArray(j.features)) throw new Error('no features from the reach layer');
  return j.features.filter(f => f.properties.NAZ_TOK === river).map(f => {
    const g = f.geometry, parts = g.type === 'LineString' ? [g.coordinates] : g.coordinates;
    // WFS order is lat, lon on the Bessel ellipsoid: fix the datum and return lon, lat
    const line = parts.flat(1).map(([a, b]) => besselAsWgsToWgs(b, a));
    return { zuid: String(f.properties.ZUID), kmP: f.properties.RICKM_P, kmK: f.properties.RICKM_K, line };
  });
}

// Pure. Great-circle distance in metres between [lon, lat] points.
export function haversine(a, b) {
  const R = 6371000, r = x => x * Math.PI / 180, dLa = r(b[1] - a[1]), dLo = r(b[0] - a[0]);
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(r(a[1])) * Math.cos(r(b[1])) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Pure. Pick reaches that cover [kmFrom, kmTo] and chain them into one line ordered from the upstream end to the downstream end. Reaches on
// the digital network (numeric ZUID) are preferred over regional extras, longer ranges over short ones (fewer joints), newer over older.
// The requested range is clipped to what the reaches offer at all (a river chain may end at the border a little before kmFrom).
export function chainReaches(reaches, kmFrom, kmTo) {
  const cand = reaches.filter(r => r.kmK - r.kmP > 5 && r.kmK > kmFrom && r.kmP < kmTo);
  if (cand.length) {                                      // clip a small shortfall at either end (3 km), but not a real gap
    const lo = Math.min(...cand.map(r => r.kmP)), hi = Math.max(...cand.map(r => r.kmK));
    if (lo - kmFrom > 0 && lo - kmFrom <= 3) kmFrom = lo;
    if (kmTo - hi > 0 && kmTo - hi <= 3) kmTo = hi;
  }
  const usable = cand.sort((a, b) => (/^\d+$/.test(b.zuid) - /^\d+$/.test(a.zuid)) || (b.kmK - b.kmP) - (a.kmK - a.kmP) || b.zuid.localeCompare(a.zuid, 'en', { numeric: true }));
  const chosen = [];
  let covered = [];                                       // list of [from, to] already covered
  const gapIn = (lo, hi) => {
    let pos = lo;
    for (const [a, b] of [...covered].sort((x, y) => x[0] - y[0])) { if (a > pos + 0.5) return [pos, Math.min(a, hi)]; pos = Math.max(pos, b); if (pos >= hi) return null; }
    return pos < hi - 0.5 ? [pos, hi] : null;
  };
  for (const r of usable) {
    const gap = gapIn(kmFrom, kmTo);
    if (!gap) break;
    if (r.kmK > gap[0] && r.kmP < gap[1]) { chosen.push(r); covered.push([r.kmP, r.kmK]); }
  }
  if (gapIn(kmFrom, kmTo)) throw new Error(`reaches do not cover km ${kmFrom}-${kmTo}: ${chosen.map(r => `${r.kmP}-${r.kmK}`).join(', ')}`);
  chosen.sort((a, b) => b.kmK - a.kmK);                   // upstream reach first
  const line = [];
  for (const r of chosen) {
    if (!line.length) { line.push(...r.line); continue; }
    // continue with the vertex of the next reach that is nearest to where the previous one ended (handles overlapping km ranges)
    let j = 0, best = Infinity;
    for (let i = 0; i < r.line.length; i++) { const d = haversine(line.at(-1), r.line[i]); if (d < best) { best = d; j = i; } }
    if (best > 600) throw new Error(`reaches ${r.zuid} and the previous one do not join (${best.toFixed(0)} m apart)`);
    line.push(...r.line.slice(best < 1 ? j + 1 : j));
  }
  return { line, reaches: chosen.map(r => ({ zuid: r.zuid, kmP: r.kmP, kmK: r.kmK })) };
}

// Pure. Cumulative length (m) along a [lon, lat] line, starting at 0 at index 0.
export function cumulative(line) {
  const c = [0];
  for (let i = 1; i < line.length; i++) c.push(c[i - 1] + haversine(line[i - 1], line[i]));
  return c;
}

// Pure. Nearest point of a line to (lon, lat): { s, dist } with s the length along the line (m) at the projected point.
export function project(line, cum, lon, lat) {
  const k = Math.cos(lat * Math.PI / 180), ref = [lon, lat];
  let best = { dist: Infinity, s: 0 };
  for (let i = 1; i < line.length; i++) {
    const [x1, y1] = line[i - 1], [x2, y2] = line[i];
    const ax = (x2 - x1) * k, ay = y2 - y1, px = (lon - x1) * k, py = lat - y1;
    const len2 = ax * ax + ay * ay;
    const t = len2 ? Math.max(0, Math.min(1, (px * ax + py * ay) / len2)) : 0;
    const q = [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t], d = haversine(ref, q);
    if (d < best.dist) best = { dist: d, s: cum[i - 1] + (cum[i] - cum[i - 1]) * t };
  }
  return best;
}
