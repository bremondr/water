import test from 'node:test';
import assert from 'node:assert/strict';
import { besselAsWgsToWgs, rasterizeFeatures } from '../zones.mjs';

test('datum fix: Bessel-as-WGS84 coordinates move ~70 m west and ~80 m south in central Bohemia', () => {
  const [lon, lat] = besselAsWgsToWgs(14.4692, 50.3523);
  const east = (lon - 14.4692) * 111320 * Math.cos(50.3523 * Math.PI / 180), north = (lat - 50.3523) * 111320;
  assert.ok(east < -65 && east > -80, `east shift ${east.toFixed(1)} m`);
  assert.ok(north < -75 && north > -90, `north shift ${north.toFixed(1)} m`);
});

test('the shift is similar across the Czech Republic (tens of metres, west and south)', () => {
  for (const [lon, lat] of [[12.2, 50.2], [14.4, 50.1], [16.6, 49.2], [18.2, 49.8]]) {
    const [lo, la] = besselAsWgsToWgs(lon, lat);
    const east = (lo - lon) * 111320 * Math.cos(lat * Math.PI / 180), north = (la - lat) * 111320;
    assert.ok(Math.hypot(east, north) > 60 && Math.hypot(east, north) < 140, `${lon},${lat}: ${Math.hypot(east, north).toFixed(0)} m`);
    assert.ok(east < 0 && north < 0, `${lon},${lat}: expected west and south, got ${east.toFixed(0)} E ${north.toFixed(0)} N`);
  }
});

test('rasterizeFeatures with fixDatum shifts the outline relative to the raw coordinates', () => {
  // 1 pixel = 1e-4 degree (~7-11 m); the same polygon lands a few pixels further west and south after the fix
  const toPixel = (lon, lat) => [(lon - 14.46) / 1e-4, (50.36 - lat) / 1e-4];
  const poly = [{ geometry: { type: 'Polygon', coordinates: [[[50.352, 14.468], [50.352, 14.470], [50.354, 14.470], [50.354, 14.468]]] } }];
  const a = new Uint8Array(200 * 200), b = new Uint8Array(200 * 200);
  rasterizeFeatures(poly, toPixel, 200, 200, 1, a);
  rasterizeFeatures(poly, toPixel, 200, 200, 1, b, { fixDatum: true });
  const centre = m => { let n = 0, sx = 0, sy = 0; m.forEach((v, i) => { if (v) { n++; sx += i % 200; sy += Math.floor(i / 200); } }); return [sx / n, sy / n]; };
  const [ax, ay] = centre(a), [bx, by] = centre(b);
  assert.ok(ax - bx > 3 && ax - bx < 12, `x moved ${(ax - bx).toFixed(1)} px west`);
  assert.ok(by - ay > 3 && by - ay < 12, `y moved ${(by - ay).toFixed(1)} px south`);
});
