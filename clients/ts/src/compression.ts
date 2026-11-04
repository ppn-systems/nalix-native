import { NalixStatus, StatusCode } from './status.js';

export const LZ4_BLOCK_HEADER_SIZE = 8;
export const MIN_GAIN_SHIFT = 3; // 12.5% compression gain requirement (1 / 2^3)

/** Upper bound accepted for OriginalLength (64 MiB), on both encode and decode. */
export const LZ4_MAX_ORIGINAL_LENGTH = 64 * 1024 * 1024;

/**
 * The LZ4 block format cannot expand data by more than 255x. Headers claiming more than
 * this relative to the block size are rejected before any output buffer is allocated.
 */
const LZ4_MAX_EXPANSION = 255;

// LZ4 block format end-of-block rules (spec): the last 5 bytes are literals, and the last
// match starts at least 12 bytes before the end. Encoders that break these produce blocks
// that the reference decoder rejects.
const LZ4_MIN_MATCH = 4;
const LZ4_LAST_LITERALS = 5;
const LZ4_MF_LIMIT = 12;

const LZ4_HASH_TABLE_SIZE = 1 << 16;
// Reused encoder state. Entries store position + 1, so zero means empty; it is cleared per block.
const encoderHashTable = new Uint32Array(LZ4_HASH_TABLE_SIZE);

/**
 * LZ4 block header matching Nalix.Codec.LZ4.LZ4BlockHeader.
 * Layout (Little-Endian):
 *   [0..3]: OriginalLength (int32)
 *   [4..7]: CompressedLength (int32, total length including 8-byte header)
 */
export class LZ4BlockHeader {
  public originalLength: number;
  public compressedLength: number;

  constructor(originalLength: number, compressedLength: number) {
    this.originalLength = originalLength;
    this.compressedLength = compressedLength;
  }

  public encode(dst: Uint8Array, offset: number = 0): void {
    if (offset < 0 || dst.length - offset < LZ4_BLOCK_HEADER_SIZE) {
      throw new NalixStatus(StatusCode.RESOURCE_EXHAUSTED, 'Buffer too small for LZ4 block header');
    }
    const view = new DataView(dst.buffer, dst.byteOffset + offset, LZ4_BLOCK_HEADER_SIZE);
    view.setInt32(0, this.originalLength, true);
    view.setInt32(4, this.compressedLength, true);
  }

  public static decode(src: Uint8Array, offset: number = 0): LZ4BlockHeader {
    if (offset < 0 || src.length - offset < LZ4_BLOCK_HEADER_SIZE) {
      throw new NalixStatus(StatusCode.OUT_OF_RANGE, 'Source too small for LZ4 block header');
    }
    const view = new DataView(src.buffer, src.byteOffset + offset, LZ4_BLOCK_HEADER_SIZE);
    const origLen = view.getInt32(0, true);
    const compLen = view.getInt32(4, true);
    return new LZ4BlockHeader(origLen, compLen);
  }
}

function readU32LE(src: Uint8Array, i: number): number {
  return (src[i] | (src[i + 1] << 8) | (src[i + 2] << 16) | (src[i + 3] << 24)) >>> 0;
}

/** Writes an LZ4 length extension: a run of 255 bytes followed by the remainder. */
function writeLengthExtension(out: Uint8Array, op: number, len: number): number {
  let rest = len;
  while (rest >= 255) {
    out[op++] = 255;
    rest -= 255;
  }
  out[op++] = rest;
  return op;
}

/**
 * Encodes `src` as a raw LZ4 block (LZ4 block format, no frame magic, no checksums).
 *
 * Greedy hash-table encoder. It always returns a valid block, possibly literal-only for
 * incompressible input, and it honours the end-of-block rules that the reference decoder enforces.
 */
export function lz4EncodeBlock(src: Uint8Array): Uint8Array {
  const n = src.length;
  const out = new Uint8Array(n + Math.floor(n / 255) + 16); // LZ4_compressBound
  const matchLimit = n - LZ4_LAST_LITERALS; // a match must end at or before this index
  const lastMatchStart = n - LZ4_MF_LIMIT; // a match must start at or before this index
  let op = 0;
  let anchor = 0; // first byte not yet emitted as part of a sequence
  let ip = 0;

  encoderHashTable.fill(0);
  while (ip <= lastMatchStart) {
    const seq = readU32LE(src, ip);
    const slot = Math.imul(seq, 2654435761) >>> 16;
    const ref = encoderHashTable[slot] - 1;
    encoderHashTable[slot] = ip + 1;

    if (ref < 0 || ip - ref > 0xffff || readU32LE(src, ref) !== seq) {
      ip++;
      continue;
    }

    let matchLen = LZ4_MIN_MATCH;
    while (ip + matchLen < matchLimit && src[ref + matchLen] === src[ip + matchLen]) {
      matchLen++;
    }

    // Sequence: token | literal-length ext | literals | offset (LE u16) | match-length ext
    const litLen = ip - anchor;
    const matchCode = matchLen - LZ4_MIN_MATCH;
    out[op++] = ((litLen >= 15 ? 15 : litLen) << 4) | (matchCode >= 15 ? 15 : matchCode);
    if (litLen >= 15) op = writeLengthExtension(out, op, litLen - 15);
    out.set(src.subarray(anchor, ip), op);
    op += litLen;
    const offset = ip - ref;
    out[op++] = offset & 0xff;
    out[op++] = offset >>> 8;
    if (matchCode >= 15) op = writeLengthExtension(out, op, matchCode - 15);

    ip += matchLen;
    anchor = ip;
  }

  // Final sequence: literals only, covering everything after the last match.
  const lastLits = n - anchor;
  out[op++] = (lastLits >= 15 ? 15 : lastLits) << 4;
  if (lastLits >= 15) op = writeLengthExtension(out, op, lastLits - 15);
  out.set(src.subarray(anchor), op);
  op += lastLits;

  return out.slice(0, op);
}

/**
 * Decodes a raw LZ4 block into exactly `outLength` bytes.
 *
 * Every read and write is bounds-checked, and any malformed input throws DATA_LOSS.
 * This is intentionally not lz4js.decompressBlock: that routine does no bounds checks,
 * so a corrupt match offset decodes to zeros and writes past the end are dropped
 * silently, which can still produce a buffer of the right length.
 */
export function lz4DecodeBlock(src: Uint8Array, outLength: number): Uint8Array {
  const out = new Uint8Array(outLength);
  const end = src.length;
  let ip = 0;
  let op = 0;

  const fail = (why: string): never => {
    throw new NalixStatus(StatusCode.DATA_LOSS, `LZ4 block corrupt: ${why}`);
  };
  // Reads the 255-continuation length extension that follows a saturated nibble.
  const readExtended = (base: number): number => {
    let len = base;
    let b: number;
    do {
      if (ip >= end) fail('truncated length extension');
      b = src[ip++];
      len += b;
    } while (b === 255);
    return len;
  };

  for (;;) {
    if (ip >= end) fail('truncated sequence token');
    const token = src[ip++];

    let literals = token >>> 4;
    if (literals === 15) literals = readExtended(15);
    if (literals > 0) {
      if (literals > end - ip) fail('literal run exceeds input');
      if (literals > outLength - op) fail('output exceeds OriginalLength');
      out.set(src.subarray(ip, ip + literals), op);
      ip += literals;
      op += literals;
    }

    // The final sequence of a block carries literals only and ends the input.
    if (ip === end) break;

    if (end - ip < 2) fail('truncated match offset');
    const offset = src[ip] | (src[ip + 1] << 8);
    ip += 2;
    if (offset === 0 || offset > op) fail('match offset outside decoded window');

    let matchLen = token & 0x0f;
    if (matchLen === 15) matchLen = readExtended(15);
    matchLen += 4; // MINMATCH
    if (matchLen > outLength - op) fail('output exceeds OriginalLength');

    // Byte-wise copy: matches may overlap their own output (offset < length).
    for (let m = op - offset, k = 0; k < matchLen; k++) {
      out[op++] = out[m++];
    }
  }

  if (op !== outLength) {
    fail(`decoded ${op} bytes, OriginalLength is ${outLength}`);
  }
  return out;
}

/**
 * Frame compression engine matching Nalix FrameCompression.
 */
export class FrameCompression {
  /**
   * Determines if compression provides at least 12.5% savings.
   */
  public static isCompressionWorthwhile(compressedLength: number, originalLength: number): boolean {
    return compressedLength <= originalLength - (originalLength >> MIN_GAIN_SHIFT);
  }

  /**
   * Compresses payload into a Nalix LZ4 block:
   * [OriginalLength (4B LE) | CompressedLength (4B LE) | raw LZ4 block]
   * CompressedLength is the total frame section length, including the 8-byte header.
   * Returns null if compression is not worthwhile (incompressible or gain < 12.5%).
   */
  public static compress(payload: Uint8Array): Uint8Array | null {
    if (payload.length === 0) {
      return null;
    }
    if (payload.length > LZ4_MAX_ORIGINAL_LENGTH) {
      throw new NalixStatus(
        StatusCode.RESOURCE_EXHAUSTED,
        `Payload of ${payload.length} bytes exceeds LZ4 OriginalLength limit ${LZ4_MAX_ORIGINAL_LENGTH}`
      );
    }

    const block = lz4EncodeBlock(payload);
    if (!this.isCompressionWorthwhile(block.length, payload.length)) {
      return null;
    }

    const totalLen = block.length + LZ4_BLOCK_HEADER_SIZE;
    const result = new Uint8Array(totalLen);
    new LZ4BlockHeader(payload.length, totalLen).encode(result, 0);
    result.set(block, LZ4_BLOCK_HEADER_SIZE);
    return result;
  }

  /**
   * Decompresses a Nalix LZ4 block:
   * [OriginalLength (4B LE) | CompressedLength (4B LE) | raw LZ4 block]
   *
   * Errors:
   * - INVALID_ARGUMENT: header OriginalLength is non-positive or above the 64 MiB cap.
   * - DATA_LOSS: CompressedLength does not equal the bytes supplied, the header claims an
   *   implausible expansion, or the block is corrupt or decodes to a size other than OriginalLength.
   */
  public static decompress(src: Uint8Array): Uint8Array {
    if (src.length < LZ4_BLOCK_HEADER_SIZE) {
      throw new NalixStatus(StatusCode.OUT_OF_RANGE, 'Buffer too small for LZ4 header decompression');
    }

    const header = LZ4BlockHeader.decode(src, 0);
    if (header.originalLength <= 0 || header.originalLength > LZ4_MAX_ORIGINAL_LENGTH) {
      throw new NalixStatus(StatusCode.INVALID_ARGUMENT, `Invalid original length in LZ4 header: ${header.originalLength}`);
    }
    if (header.compressedLength !== src.length) {
      throw new NalixStatus(
        StatusCode.DATA_LOSS,
        `LZ4 CompressedLength ${header.compressedLength} does not match frame length ${src.length}`
      );
    }

    const blockLength = src.length - LZ4_BLOCK_HEADER_SIZE;
    if (blockLength === 0 || header.originalLength > blockLength * LZ4_MAX_EXPANSION + 64) {
      throw new NalixStatus(
        StatusCode.DATA_LOSS,
        `LZ4 OriginalLength ${header.originalLength} is implausible for a ${blockLength}-byte block`
      );
    }

    return lz4DecodeBlock(src.subarray(LZ4_BLOCK_HEADER_SIZE), header.originalLength);
  }
}
