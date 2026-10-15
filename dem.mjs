// Terrain data for the flood-extent experiment: ČÚZK DMR 5G (bare-earth LiDAR terrain model of Czechia, 2 m grid,
// Bpv heights) through the ČÚZK ArcGIS ImageServer, so a small window around a station can be fetched without
// downloading the national data set. Open data, source: ČÚZK.
const SERVICE = 'https://ags.cuzk.cz/arcgis2/rest/services/dmr5g/ImageServer';
const R = 6378137;                                   // Web Mercator sphere radius

export const mercator = (lon, lat) => [R * lon * Math.PI / 180, R * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360))];
export const unmercator = (x, y) => [x / R * 180 / Math.PI, (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180 / Math.PI];

// Pure: a window of `halfKm` (ground distance) around a point, in Web Mercator, with a square pixel grid of `size`.
export function windowAround(lon, lat, halfKm, size) {
  const [cx, cy] = mercator(lon, lat);
  const half = halfKm * 1000 / Math.cos(lat * Math.PI / 180);        // mercator metres stretch by 1/cos(lat)
  const bbox = [cx - half, cy - half, cx + half, cy + half];
  return { bbox, size, mercPixel: 2 * half / size, groundPixel: 2 * half / size * Math.cos(lat * Math.PI / 180) };
}

// Pure: a baseline (uncompressed, tiled, 1 band, float32, little endian) GeoTIFF as ArcGIS writes it -> Float32Array.
export function readTiledFloatTiff(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint16(0, true) !== 0x4949 || dv.getUint16(2, true) !== 42) throw new Error('not a little-endian TIFF');
  const ifd = dv.getUint32(4, true), n = dv.getUint16(ifd, true), tag = {};
  for (let i = 0; i < n; i++) {
    const o = ifd + 2 + i * 12, id = dv.getUint16(o, true), type = dv.getUint16(o + 2, true), cnt = dv.getUint32(o + 4, true);
    const size = { 3: 2, 4: 4 }[type] ?? 4, inline = cnt * size <= 4;
    const at = inline ? o + 8 : dv.getUint32(o + 8, true);
    const get = k => (size === 2 ? dv.getUint16(at + k * 2, true) : dv.getUint32(at + k * 4, true));
    tag[id] = { cnt, get };
  }
  const need = (id, what) => { if (!tag[id]) throw new Error(`TIFF without ${what}`); return tag[id]; };
  const width = need(256, 'width').get(0), height = need(257, 'height').get(0);
  if (need(259, 'compression').get(0) !== 1) throw new Error('compressed TIFF, request compression None');
  if (need(258, 'bits').get(0) !== 32 || need(339, 'sample format').get(0) !== 3) throw new Error('not float32');
  const tw = need(322, 'tile width').get(0), th = need(323, 'tile height').get(0);
  const offs = need(324, 'tile offsets'), across = Math.ceil(width / tw), down = Math.ceil(height / th);
  const out = new Float32Array(width * height);
  for (let ty = 0; ty < down; ty++) for (let tx = 0; tx < across; tx++) {
    const base = offs.get(ty * across + tx);
    for (let y = 0; y < th; y++) {
      const gy = ty * th + y; if (gy >= height) break;
      for (let x = 0; x < tw; x++) { const gx = tx * tw + x; if (gx >= width) break; out[gy * width + gx] = dv.getFloat32(base + (y * tw + x) * 4, true); }
    }
  }
  return { width, height, data: out };
}

// Fetch the DMR 5G window as heights in metres (Float32Array, NaN = no data), rows north to south.
export async function fetchDem(win) {
  const q = new URLSearchParams({
    bbox: win.bbox.join(','), bboxSR: '3857', imageSR: '3857', size: `${win.width ?? win.size},${win.height ?? win.size}`, format: 'tiff', pixelType: 'F32',
    noData: '-9999', interpolation: 'RSP_BilinearInterpolation', f: 'json',
  });
  const meta = await (await fetch(`${SERVICE}/exportImage?${q}`, { signal: AbortSignal.timeout(120_000) })).json();
  if (!meta.href) throw new Error(`ČÚZK exportImage failed: ${JSON.stringify(meta).slice(0, 200)}`);
  const res = await fetch(meta.href, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`${res.status} ${meta.href}`);
  const tif = readTiledFloatTiff(Buffer.from(await res.arrayBuffer()));
  for (let i = 0; i < tif.data.length; i++) if (!(tif.data[i] > -500)) tif.data[i] = NaN;   // -9999 and anything absurd
  return { ...tif, extent: meta.extent };
}
