// Official flood zones (záplavová území Q5, Q20, Q100, Q500 and the active zone) from the VÚV TGM ArcGIS WFS, rasterised onto
// the same pixel grid as a terrain window so they can be compared with the modelled flood extent.
// The WFS carries no access constraints or fees; credit "© VÚV TGM, HEIS VÚV".
const WFS = 'https://ags.vuv.cz/arcgis/services/isvs_voda/isvs_voda/MapServer/WFSServer';

// layer name -> bit in the zone mask
export const ZONE_LAYERS = [['ZaplavUzemi_Q5', 1], ['ZaplavUzemi_Q20', 2], ['ZaplavUzemi_Q100', 4], ['ZaplavUzemi_Q500', 8], ['ZaplavUzemi_AktivniZony', 16]];

export async function fetchZoneFeatures(typeName, { south, west, north, east }) {
  const q = new URLSearchParams({
    service: 'WFS', version: '2.0.0', request: 'GetFeature', typeNames: typeName, outputFormat: 'GEOJSON', srsName: 'EPSG:4326',
    bbox: `${south - 0.004},${west - 0.004},${north + 0.004},${east + 0.004},urn:ogc:def:crs:EPSG::4326`, count: '1000',   // margin: the stored coordinates are ~100 m off (see datum fix)
  });
  const r = await fetch(`${WFS}?${q}`, { signal: AbortSignal.timeout(120_000) });
  if (!r.ok) throw new Error(`${r.status} ${typeName}`);
  const j = await r.json();
  if (!Array.isArray(j.features)) throw new Error(`no features array for ${typeName}: ${JSON.stringify(j).slice(0, 150)}`);
  return j.features;
}

// The WFS answers EPSG:4326 in latitude, longitude order, but GeoJSON consumers expect lon, lat. Detect per pair.
const lonLat = ([a, b]) => (a > 40 && a < 60 && b > 5 && b < 25 ? [b, a] : [a, b]);

// DATUM FIX. The zones are stored in S-JTSK (Bessel ellipsoid). The VÚV WFS hands them out as "EPSG:4326" but the numbers are
// geodetic coordinates on the Bessel ellipsoid, i.e. the datum shift to WGS84 was never applied, which leaves every outline
// ~70 m west and ~80 m south of where it belongs (found by correlating the outlines with terrain edges, 2026-10-15; the
// shift predicted from the standard S-JTSK parameters +towgs84=589,76,480 matches what the terrain shows).
// besselAsWgsToWgs() applies that geocentric translation: geodetic(Bessel) -> XYZ -> +translation -> geodetic(WGS84).
const ELL = { bessel: { a: 6377397.155, f: 1 / 299.1528128 }, wgs: { a: 6378137, f: 1 / 298.257223563 } };
const TOWGS84 = [589, 76, 480];
const toXYZ = (lat, lon, e) => { const phi = lat * Math.PI / 180, lam = lon * Math.PI / 180, e2 = 2 * e.f - e.f ** 2, N = e.a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2); return [N * Math.cos(phi) * Math.cos(lam), N * Math.cos(phi) * Math.sin(lam), N * (1 - e2) * Math.sin(phi)]; };
const toGeo = ([X, Y, Z], e) => { const e2 = 2 * e.f - e.f ** 2, p = Math.hypot(X, Y); let phi = Math.atan2(Z, p * (1 - e2)); for (let i = 0; i < 8; i++) { const N = e.a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2); phi = Math.atan2(Z + e2 * N * Math.sin(phi), p); } return [phi * 180 / Math.PI, Math.atan2(Y, X) * 180 / Math.PI]; };
export function besselAsWgsToWgs(lon, lat) {
  const [X, Y, Z] = toXYZ(lat, lon, ELL.bessel);
  const [la, lo] = toGeo([X + TOWGS84[0], Y + TOWGS84[1], Z + TOWGS84[2]], ELL.wgs);
  return [lo, la];                                       // lon, lat
}

// Pure: paint (OR) the polygons of `features` into `out` (Uint8Array width*height) with value `bit`.
// `toPixel(lon, lat)` -> [x, y] in fractional pixels. Even-odd fill per polygon so holes stay empty.
export function rasterizeFeatures(features, toPixel, width, height, bit, out, { fixDatum = false } = {}) {
  for (const f of features) {
    const g = f.geometry; if (!g) continue;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    for (const rings of polys) {
      const edges = []; let ymin = Infinity, ymax = -Infinity;
      for (const ring of rings) {
        const pts = ring.map(c => toPixel(...(fixDatum ? besselAsWgsToWgs(...lonLat(c)) : lonLat(c))));
        for (let i = 0; i < pts.length; i++) {
          const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
          if (y1 === y2) continue;
          edges.push(x1, y1, x2, y2);
          ymin = Math.min(ymin, y1, y2); ymax = Math.max(ymax, y1, y2);
        }
      }
      if (!edges.length || ymax < 0 || ymin > height) continue;
      // active edge table: edges sorted by their top y, only those crossing the current row are tested (a corridor-sized polygon has
      // hundreds of thousands of edges and thousands of rows)
      const n = edges.length / 4, top = new Float64Array(n), bot = new Float64Array(n), order = new Int32Array(n);
      for (let e = 0; e < n; e++) { top[e] = Math.min(edges[4 * e + 1], edges[4 * e + 3]); bot[e] = Math.max(edges[4 * e + 1], edges[4 * e + 3]); order[e] = e; }
      order.sort((i, j) => top[i] - top[j]);
      let next = 0, active = [];
      const y0 = Math.max(0, Math.floor(ymin)), y1 = Math.min(height - 1, Math.ceil(ymax));
      for (let y = y0; y <= y1; y++) {
        const yc = y + 0.5;
        while (next < n && top[order[next]] <= yc) active.push(order[next++]);
        let w = 0;
        for (let k = 0; k < active.length; k++) if (bot[active[k]] > yc) active[w++] = active[k];
        active.length = w;
        const xs = [];
        for (const e of active) {
          const ea = edges[4 * e + 1], eb = edges[4 * e + 3];
          if ((ea <= yc) === (eb <= yc)) continue;
          xs.push(edges[4 * e] + (yc - ea) * (edges[4 * e + 2] - edges[4 * e]) / (eb - ea));
        }
        xs.sort((u, v) => u - v);
        for (let k = 0; k + 1 < xs.length; k += 2) {
          const xa = Math.max(0, Math.ceil(xs[k] - 0.5)), xb = Math.min(width - 1, Math.floor(xs[k + 1] - 0.5));
          for (let x = xa; x <= xb; x++) out[y * width + x] |= bit;
        }
      }
    }
  }
  return out;
}

// Fetch all zone layers for a terrain window and rasterise them into one Uint8 mask (bit per layer).
export async function zoneMask(meta) {
  const { west, south, east, north } = meta.bounds, W = meta.width, H = meta.height;
  const my = a => Math.log(Math.tan(Math.PI / 4 + a * Math.PI / 360));
  const toPixel = (lon, lat) => [(lon - west) / (east - west) * W, (my(north) - my(lat)) / (my(north) - my(south)) * H];
  const out = new Uint8Array(W * H), counts = {};
  for (const [layer, bit] of ZONE_LAYERS) {
    const features = await fetchZoneFeatures(layer, meta.bounds);
    rasterizeFeatures(features, toPixel, W, H, bit, out, { fixDatum: true });
    counts[layer] = features.length;
  }
  return { mask: out, counts };
}
