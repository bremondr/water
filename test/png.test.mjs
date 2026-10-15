import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { encodePng } from '../png.mjs';

test('encodePng writes a valid RGBA PNG whose pixels decode back', () => {
  const rgba = Uint8ClampedArray.from([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0, 10, 20, 30, 40]);   // 2x2
  const png = encodePng(2, 2, rgba);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  // walk the chunks
  let off = 8; const chunks = {};
  while (off < png.length) { const len = png.readUInt32BE(off), type = png.toString('ascii', off + 4, off + 8); chunks[type] = png.subarray(off + 8, off + 8 + len); off += 12 + len; }
  assert.equal(chunks.IHDR.readUInt32BE(0), 2); assert.equal(chunks.IHDR.readUInt32BE(4), 2);
  assert.equal(chunks.IHDR[8], 8); assert.equal(chunks.IHDR[9], 6);
  const raw = inflateSync(chunks.IDAT);
  assert.equal(raw.length, (2 * 4 + 1) * 2);
  assert.deepEqual([...raw.subarray(1, 9)], [255, 0, 0, 255, 0, 255, 0, 128]);     // row 0 after its filter byte
  assert.deepEqual([...raw.subarray(10, 18)], [0, 0, 255, 0, 10, 20, 30, 40]);     // row 1
  assert.ok('IEND' in chunks);
});
