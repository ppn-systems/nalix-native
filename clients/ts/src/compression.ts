import * as lz4 from 'lz4js';
import { NalixStatus, StatusCode } from './status.js';

export const LZ4_BLOCK_HEADER_SIZE = 8;
export const MIN_GAIN_SHIFT = 3; // 12.5% compression gain requirement (1 / 2^3)

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
    if (dst.length - offset < LZ4_BLOCK_HEADER_SIZE) {
      throw new NalixStatus(StatusCode.RESOURCE_EXHAUSTED, 'Buffer too small for LZ4 block header');
    }
    const view = new DataView(dst.buffer, dst.byteOffset + offset, LZ4_BLOCK_HEADER_SIZE);
    view.setInt32(0, this.originalLength, true);
    view.setInt32(4, this.compressedLength, true);
  }

  public static decode(src: Uint8Array, offset: number = 0): LZ4BlockHeader {
    if (src.length - offset < LZ4_BLOCK_HEADER_SIZE) {
      throw new NalixStatus(StatusCode.OUT_OF_RANGE, 'Source too small for LZ4 block header');
    }
    const view = new DataView(src.buffer, src.byteOffset + offset, LZ4_BLOCK_HEADER_SIZE);
    const origLen = view.getInt32(0, true);
    const compLen = view.getInt32(4, true);
    return new LZ4BlockHeader(origLen, compLen);
  }
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
   * Returns null if compression is not worthwhile (incompressible or gain < 12.5%).
   */
  public static compress(payload: Uint8Array): Uint8Array | null {
    if (payload.length === 0) {
      return null;
    }

    const compressed = lz4.compress(payload);
    // In Nalix, compressedLength stored in header includes the 8-byte header itself
    const totalCompressedLen = compressed.length + LZ4_BLOCK_HEADER_SIZE;

    if (!this.isCompressionWorthwhile(compressed.length, payload.length)) {
      return null; // Not worth compressing
    }

    const result = new Uint8Array(totalCompressedLen);
    const header = new LZ4BlockHeader(payload.length, totalCompressedLen);
    header.encode(result, 0);
    result.set(compressed, LZ4_BLOCK_HEADER_SIZE);

    return result;
  }

  /**
   * Decompresses a Nalix LZ4 block:
   * [OriginalLength (4B LE) | CompressedLength (4B LE) | raw LZ4 block]
   */
  public static decompress(src: Uint8Array): Uint8Array {
    if (src.length < LZ4_BLOCK_HEADER_SIZE) {
      throw new NalixStatus(StatusCode.OUT_OF_RANGE, 'Buffer too small for LZ4 header decompression');
    }

    const header = LZ4BlockHeader.decode(src, 0);
    if (header.originalLength <= 0 || header.originalLength > 64 * 1024 * 1024) {
      throw new NalixStatus(StatusCode.INVALID_ARGUMENT, `Invalid original length in LZ4 header: ${header.originalLength}`);
    }

    const compressedBlock = src.subarray(LZ4_BLOCK_HEADER_SIZE);
    try {
      const decompressed = lz4.decompress(compressedBlock);
      if (decompressed.length !== header.originalLength) {
        // Some lz4 blocks might need exact sizing or match
      }
      return decompressed;
    } catch (err: any) {
      throw new NalixStatus(StatusCode.DATA_LOSS, `LZ4 decompression failed: ${err.message || err}`);
    }
  }
}
