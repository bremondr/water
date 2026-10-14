// Official flood zones (záplavová území Q5, Q20, Q100, Q500 and the active zone) from the VÚV TGM ArcGIS WFS, rasterised onto
// the same pixel grid as a terrain window so they can be compared with the modelled flood extent.
// The WFS carries no access constraints or fees; credit "© VÚV TGM, HEIS VÚV".
const WFS = 'https://ags.vuv.cz/arcgis/services/isvs_voda/isvs_voda/MapServer/WFSServer';

// layer name -> bit in the zone mask
export const ZONE_LAYERS = [['ZaplavUzemi_Q5', 1], ['ZaplavUzemi_Q20', 2], ['ZaplavUzemi_Q100', 4], ['ZaplavUzemi_Q500', 8], ['ZaplavUzemi_AktivniZony', 16]];

export async function fetchZoneFeatures(typeName, { south, west, north, east }) {
  const q = new URLSearchParams({
    service: 'WFS', version: '2.0.0', request: 'GetFeature', typeNames: typeName, outputFormat: 'GEOJSON', srsName: 'EPSG:4326',
    bbox: `${south},${west},${north},${east},urn:ogc:def:crs:EPSG::4326`, count: '1000',
  });
  const r = await fetch(`${WFS}?${q}`, { signal: AbortSignal.timeout(120_000) });
  if (!r.ok) throw new Error(`${r.status} ${typeName}`);
  const j = await r.json();
  if (!Array.isArray(j.features)) throw new Error(`no features array for ${typeName}: ${JSON.stringify(j).slice(0, 150)}`);
  return j.features;
}

// The WFS answers EPSG:4326 in latitude, longitude order, but GeoJSON consumers expect lon, lat. Detect per pair.
const lonLat = ([a, b]) => (a > 40 && a < 60 && b > 5 && b < 25 ? [b, a] : [a, b]);

// Pure: paint (OR) the polygons of `features` into `out` (Uint8Array width*height) with value `bit`.
// `toPixel(lon, lat)` -> [x, y] in fractional pixels. Even-odd fill per polygon so holes stay empty.
export function rasterizeFeatures(features, toPixel, width, height, bit, out) {
  for (const f of features) {
    const g = f.geometry; if (!g) continue;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    for (const rings of polys) {
      const edges = []; let ymin = Infinity, ymax = -Infinity;
      for (const ring of rings) {
        const pts = ring.map(c => toPixel(...lonLat(c)));
        for (let i = 0; i < pts.length; i++) {
          const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
          if (y1 === y2) continue;
          edges.push(x1, y1, x2, y2);
          ymin = Math.min(ymin, y1, y2); ymax = Math.max(ymax, y1, y2);
        }
      }
      if (!edges.length || ymax < 0 || ymin > height) continue;
      const y0 = Math.max(0, Math.floor(ymin)), y1 = Math.min(height - 1, Math.ceil(ymax));
      for (let y = y0; y <= y1; y++) {
        const yc = y + 0.5, xs = [];
        for (let e = 0; e < edges.length; e += 4) {
          const ea = edges[e + 1], eb = edges[e + 3];
          if ((ea <= yc) === (eb <= yc)) continue;
          xs.push(edges[e] + (yc - ea) * (edges[e + 2] - edges[e]) / (eb - ea));
        }
        xs.sort((a, b) => a - b);
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
    rasterizeFeatures(features, toPixel, W, H, bit, out);
    counts[layer] = features.length;
  }
  return { mask: out, counts };
}
