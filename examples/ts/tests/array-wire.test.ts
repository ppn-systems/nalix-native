// Golden wire-format checks for array fields (docs/SPECIFICATION.md §2.5.2):
// [int32 count (LE)][count elements]; string elements are [int32 length][utf8 bytes].
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ArrayProbe } from '../src/array-probe.js';

test('array fields encode with little-endian count prefixes and exact element layout', () => {
  const p = new ArrayProbe();
  p.token = new Uint8Array(16).fill(0x11);
  p.ids = [new Uint8Array(16).fill(0xaa), new Uint8Array(16).fill(0xbb)];
  p.tags = ['hi', ''];
  p.scores = [-2, 0x01020304];
  p.big = [-1n];
  p.flags = [true, false];
  p.ratio = [1.5];
  p.raw = new Uint8Array([9, 8]);
  p.title = 'ok';
  p.key = new Uint8Array(32).fill(0x22);

  const bytes = p.encode();
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = 6 + 16;

  assert.equal(dv.getInt32(o, true), 2); o += 4;
  assert.deepEqual([...bytes.slice(o, o + 16)], [...new Uint8Array(16).fill(0xaa)]); o += 16;
  assert.deepEqual([...bytes.slice(o, o + 16)], [...new Uint8Array(16).fill(0xbb)]); o += 16;

  assert.equal(dv.getInt32(o, true), 2); o += 4;
  assert.equal(dv.getInt32(o, true), 2); o += 4;
  assert.equal(new TextDecoder().decode(bytes.slice(o, o + 2)), 'hi'); o += 2;
  assert.equal(dv.getInt32(o, true), 0); o += 4;

  assert.equal(dv.getInt32(o, true), 2); o += 4;
  assert.equal(dv.getInt32(o, true), -2); o += 4;
  assert.equal(dv.getInt32(o, true), 0x01020304); o += 4;

  assert.equal(dv.getInt32(o, true), 1); o += 4;
  assert.equal(dv.getBigInt64(o, true), -1n); o += 8;

  assert.equal(dv.getInt32(o, true), 2); o += 4;
  assert.deepEqual([bytes[o], bytes[o + 1]], [1, 0]); o += 2;

  assert.equal(dv.getInt32(o, true), 1); o += 4;
  assert.equal(dv.getFloat64(o, true), 1.5); o += 8;

  assert.equal(dv.getInt32(o, true), 2); o += 4;
  assert.deepEqual([bytes[o], bytes[o + 1]], [9, 8]); o += 2;

  assert.equal(dv.getInt32(o, true), 2); o += 4;
  assert.equal(new TextDecoder().decode(bytes.slice(o, o + 2)), 'ok'); o += 2;

  assert.equal(bytes.length, o + 32);
});

test('array fields survive an encode/decode round trip', () => {
  const p = new ArrayProbe();
  p.ids = [new Uint8Array(16).fill(1)];
  p.tags = ['a', 'bc', ''];
  p.scores = [1, 2, 3];
  p.big = [123456789012345678n];
  p.flags = [false, true];
  p.ratio = [0.25];
  p.raw = new Uint8Array([7]);
  p.title = 'round';
  const back = ArrayProbe.decode(p.encode());
  assert.deepEqual(back.ids, p.ids);
  assert.deepEqual(back.tags, p.tags);
  assert.deepEqual(back.scores, p.scores);
  assert.deepEqual(back.big, p.big);
  assert.deepEqual(back.flags, p.flags);
  assert.deepEqual(back.ratio, p.ratio);
  assert.deepEqual(back.raw, p.raw);
  assert.equal(back.title, p.title);
});
