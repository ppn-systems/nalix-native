import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FrameCompression,
  LZ4BlockHeader,
  LZ4_BLOCK_HEADER_SIZE,
  lz4DecodeBlock,
  lz4EncodeBlock,
} from '../src/compression.js';
import { NalixStatus, StatusCode } from '../src/status.js';
import { GOLDEN_TEXT_3343, GOLDEN_RANDOM_600, GOLDEN_MIXED_4096 } from './lz4_golden.generated.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Deterministic xorshift32 byte stream (same algorithm as the golden generator). */
function makePrng(seed: number): () => number {
  let st = seed >>> 0;
  return () => {
    st = (st ^ (st << 13)) >>> 0;
    st = (st ^ (st >>> 17)) >>> 0;
    st = (st ^ (st << 5)) >>> 0;
    return st & 0xff;
  };
}

function randomBytes(n: number, seed: number): Uint8Array {
  const next = makePrng(seed);
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = next();
  return out;
}

function textBytes(n: number): Uint8Array {
  const pat = 'The quick brown fox jumps over the lazy dog. ';
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = pat.charCodeAt(i % pat.length);
  return out;
}

/** Zero runs of 256 bytes alternating with random bytes. */
function mixedBytes(n: number, seed: number): Uint8Array {
  const next = makePrng(seed);
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = ((i >> 8) & 1) === 0 ? 0 : next();
  return out;
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

/** Builds a valid LZ4 block that stores `src` as literals only (what an encoder emits for incompressible data). */
function literalOnlyBlock(src: Uint8Array): Uint8Array {
  const head: number[] = [];
  let rest = src.length;
  if (rest >= 15) {
    head.push(0xf0);
    rest -= 15;
    while (rest >= 255) {
      head.push(255);
      rest -= 255;
    }
    head.push(rest);
  } else {
    head.push(rest << 4);
  }
  const out = new Uint8Array(head.length + src.length);
  out.set(head, 0);
  out.set(src, head.length);
  return out;
}

function frameOf(originalLength: number, block: Uint8Array, compressedLength?: number): Uint8Array {
  const frame = new Uint8Array(LZ4_BLOCK_HEADER_SIZE + block.length);
  new LZ4BlockHeader(originalLength, compressedLength ?? frame.length).encode(frame, 0);
  frame.set(block, LZ4_BLOCK_HEADER_SIZE);
  return frame;
}

function assertStatus(code: StatusCode) {
  return (err: unknown) => err instanceof NalixStatus && err.code === code;
}

// ---------------------------------------------------------------------------
// Golden vectors: frames produced by the reference LZ4 encoder (LZ4_compress_default,
// the same library and header layout as clients/c/src/compression.c). The hex lives in
// lz4_golden.generated.ts; tests/golden/lz4_golden_gen.c regenerates it.
// ---------------------------------------------------------------------------

test('golden: text-3343 frame from the reference encoder decodes to the exact bytes', () => {
  const frame = fromHex(GOLDEN_TEXT_3343);
  assert.equal(LZ4BlockHeader.decode(frame).originalLength, 3343);
  assert.equal(LZ4BlockHeader.decode(frame).compressedLength, frame.length);
  assert.deepEqual(FrameCompression.decompress(frame), textBytes(3343));
});

test('golden: incompressible random-600 frame decodes to the exact bytes', () => {
  const frame = fromHex(GOLDEN_RANDOM_600);
  assert.deepEqual(FrameCompression.decompress(frame), randomBytes(600, 0x12345678));
});

test('golden: mixed-4096 frame decodes to the exact bytes', () => {
  const frame = fromHex(GOLDEN_MIXED_4096);
  assert.deepEqual(FrameCompression.decompress(frame), mixedBytes(4096, 0x9e3779b9));
});

// ---------------------------------------------------------------------------
// Round trips
// ---------------------------------------------------------------------------

const ROUND_TRIP_SIZES = [0, 1, 511, 512, 513, 4096, 65536];

for (const n of ROUND_TRIP_SIZES) {
  test(`round-trip ${n} bytes: compressible payloads through compress/decompress`, () => {
    const data = textBytes(n);
    const frame = FrameCompression.compress(data);
    if (n === 0) {
      assert.equal(frame, null, 'empty payload is never compressed');
      return;
    }
    if (n >= 512) {
      assert.ok(frame !== null, `${n}-byte repetitive text should be worth compressing`);
    }
    if (frame === null) {
      return; // Not worthwhile: the caller sends it uncompressed, nothing to decode
    }
    assert.equal(LZ4BlockHeader.decode(frame).compressedLength, frame.length);
    assert.deepEqual(FrameCompression.decompress(frame), data);
  });

  test(`round-trip ${n} bytes: incompressible payloads (literal-only block)`, () => {
    const data = randomBytes(n, n + 1);
    // Random data is not worth compressing, so exercise the decoder with a literal-only block.
    if (n === 0) {
      assert.deepEqual(lz4DecodeBlock(literalOnlyBlock(data), 0), data);
      return;
    }
    const frame = frameOf(n, literalOnlyBlock(data));
    assert.deepEqual(FrameCompression.decompress(frame), data);
    assert.equal(FrameCompression.compress(data), null, 'incompressible payload must not be framed as compressed');
  });
}

test('block encoder output is decoded back by the bounds-checked decoder', () => {
  const data = mixedBytes(65536, 42);
  const block = lz4EncodeBlock(data);
  assert.ok(block !== null);
  assert.deepEqual(lz4DecodeBlock(block, data.length), data);
});

/**
 * Walks the sequences of a block and reports where its last match starts and ends.
 * Used to check the end-of-block rules that the reference decoder enforces.
 */
function lastMatchSpan(block: Uint8Array): { start: number; end: number } | null {
  let ip = 0;
  let op = 0;
  let span: { start: number; end: number } | null = null;
  while (ip < block.length) {
    const token = block[ip++];
    let lit = token >>> 4;
    if (lit === 15) {
      let b: number;
      do {
        b = block[ip++];
        lit += b;
      } while (b === 255);
    }
    ip += lit;
    op += lit;
    if (ip >= block.length) break; // final literal-only sequence
    ip += 2;
    let ml = token & 0x0f;
    if (ml === 15) {
      let b: number;
      do {
        b = block[ip++];
        ml += b;
      } while (b === 255);
    }
    ml += 4;
    span = { start: op, end: op + ml };
    op += ml;
  }
  assert.equal(ip, block.length, 'sequence walk must end exactly at the block end');
  return span;
}

test('encoder honours LZ4 end-of-block rules on fuzzed inputs (last 5 literals, last match 12+ bytes from end)', () => {
  const next = makePrng(0xabcdef01);
  for (let iter = 0; iter < 400; iter++) {
    const n = next() * 16 + (next() & 0xff); // up to ~4 KiB, includes short inputs
    // Small alphabet so that matches are frequent, with occasional random bytes.
    const data = new Uint8Array(n);
    for (let i = 0; i < n; i++) data[i] = next() % 8 === 0 ? next() : 97 + (next() % 4);
    const block = lz4EncodeBlock(data);
    assert.deepEqual(lz4DecodeBlock(block, n), data, `round trip, iteration ${iter}, n=${n}`);

    const span = lastMatchSpan(block);
    if (span !== null) {
      assert.ok(span.start <= n - 12, `last match starts too late (n=${n}, start=${span.start})`);
      assert.ok(span.end <= n - 5, `last match ends too late (n=${n}, end=${span.end})`);
    }
  }
});

// ---------------------------------------------------------------------------
// Rejection of truncated, corrupt and implausible input
// ---------------------------------------------------------------------------

const textFrame = () => fromHex(GOLDEN_TEXT_3343);

test('rejects a frame truncated after the header was written (CompressedLength mismatch)', () => {
  const frame = textFrame();
  for (const cut of [1, 20, 60]) {
    assert.throws(() => FrameCompression.decompress(frame.subarray(0, frame.length - cut)), assertStatus(StatusCode.DATA_LOSS));
  }
  assert.throws(() => FrameCompression.decompress(frame.subarray(0, 7)), assertStatus(StatusCode.OUT_OF_RANGE));
});

test('rejects a block truncated with a consistent header', () => {
  const block = textFrame().subarray(LZ4_BLOCK_HEADER_SIZE);
  for (const keep of [0, 1, 10, 40, block.length - 1]) {
    assert.throws(
      () => FrameCompression.decompress(frameOf(3343, block.subarray(0, keep))),
      assertStatus(StatusCode.DATA_LOSS),
      `block cut to ${keep} bytes`
    );
  }
});

test('rejects corrupt match offsets', () => {
  const frame = textFrame();
  // First match offset (45, little-endian) sits at block index 47.
  assert.equal(frame[8 + 47], 0x2d);
  assert.equal(frame[8 + 48], 0x00);

  const zero = frame.slice();
  zero[8 + 47] = 0x00;
  assert.throws(() => FrameCompression.decompress(zero), assertStatus(StatusCode.DATA_LOSS));

  const beyondWindow = frame.slice();
  beyondWindow[8 + 47] = 0x00;
  beyondWindow[8 + 48] = 0x04; // offset 1024 > 45 bytes decoded so far
  assert.throws(() => FrameCompression.decompress(beyondWindow), assertStatus(StatusCode.DATA_LOSS));
});

test('rejects OriginalLength that does not match the decoded size', () => {
  const block = textFrame().subarray(LZ4_BLOCK_HEADER_SIZE);
  for (const claimed of [1, 3000, 3344]) {
    assert.throws(
      () => FrameCompression.decompress(frameOf(claimed, block)),
      assertStatus(StatusCode.DATA_LOSS),
      `claimed ${claimed}`
    );
  }
});

test('rejects out-of-range OriginalLength with INVALID_ARGUMENT', () => {
  const block = textFrame().subarray(LZ4_BLOCK_HEADER_SIZE);
  for (const claimed of [0, -5, 70 * 1024 * 1024]) {
    assert.throws(() => FrameCompression.decompress(frameOf(claimed, block)), assertStatus(StatusCode.INVALID_ARGUMENT));
  }
});

test('rejects implausible expansion before allocating the output', () => {
  // 60 MiB claimed from a 20-byte block: impossible for LZ4 (max ~255:1).
  const tiny = literalOnlyBlock(new Uint8Array(12));
  assert.throws(
    () => FrameCompression.decompress(frameOf(60 * 1024 * 1024, tiny)),
    assertStatus(StatusCode.DATA_LOSS)
  );
});

test('rejects a frame whose CompressedLength is below the header size or wrong', () => {
  const block = textFrame().subarray(LZ4_BLOCK_HEADER_SIZE);
  for (const compLen of [0, 7, 75, 77]) {
    assert.throws(
      () => FrameCompression.decompress(frameOf(3343, block, compLen)),
      assertStatus(StatusCode.DATA_LOSS),
      `CompressedLength ${compLen}`
    );
  }
});

test('random corruption never escapes as a non-NalixStatus error or a wrong-size result', () => {
  const next = makePrng(0xdeadbeef);
  for (let iter = 0; iter < 3000; iter++) {
    const len = 8 + (next() % 200);
    const body = new Uint8Array(len - LZ4_BLOCK_HEADER_SIZE);
    for (let i = 0; i < body.length; i++) body[i] = next();
    const claimed = 1 + ((next() << 8) | next()) % 4096;
    const frame = frameOf(claimed, body);
    try {
      const out = FrameCompression.decompress(frame);
      assert.equal(out.length, claimed);
    } catch (err) {
      assert.ok(err instanceof NalixStatus, `unexpected error type at iteration ${iter}: ${String(err)}`);
    }
  }
});
