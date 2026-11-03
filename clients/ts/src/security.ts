import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { NalixStatus, StatusCode } from './status.js';

export const ENVELOPE_MAGIC = 0x584c414e; // "NALX" in LE uint32
export const ENVELOPE_HEADER_SIZE = 12;
export const ENVELOPE_VERSION = 1;
export const CHACHA20_NONCE_SIZE = 12;
export const POLY1305_TAG_SIZE = 16;

/**
 * Cipher suite types matching Nalix.Abstractions.Security.CipherSuiteType.
 */
export enum CipherSuiteType {
  None = 0,
  Salsa20 = 3,
  Chacha20 = 4,
  Salsa20Poly1305 = 7,
  Chacha20Poly1305 = 8,
}

/**
 * Nalix 12-byte fixed envelope header for AEAD authenticated encryption.
 * Layout (Little-Endian):
 *   [0..3]  : MAGIC "NALX" (0x584C414E)
 *   [4]     : Version (1)
 *   [5]     : Type (CipherSuiteType)
 *   [6]     : Flags (reserved, 0)
 *   [7]     : NonceLen (12 for ChaCha20-Poly1305)
 *   [8..11] : Seq (uint32 little-endian)
 */
export class EnvelopeHeader {
  public magic: number;
  public version: number;
  public type: CipherSuiteType;
  public flags: number;
  public nonceLen: number;
  public seq: number;

  constructor(
    version: number = ENVELOPE_VERSION,
    type: CipherSuiteType = CipherSuiteType.Chacha20Poly1305,
    flags: number = 0,
    nonceLen: number = CHACHA20_NONCE_SIZE,
    seq: number = 0
  ) {
    this.magic = ENVELOPE_MAGIC;
    this.version = version & 0xff;
    this.type = type;
    this.flags = flags & 0xff;
    this.nonceLen = nonceLen & 0xff;
    this.seq = seq >>> 0;
  }

  public encode(dst: Uint8Array, offset: number = 0): void {
    if (offset < 0 || dst.length - offset < ENVELOPE_HEADER_SIZE) {
      throw new NalixStatus(StatusCode.RESOURCE_EXHAUSTED, 'Buffer too small for envelope header');
    }
    const view = new DataView(dst.buffer, dst.byteOffset + offset, ENVELOPE_HEADER_SIZE);
    view.setUint32(0, this.magic, true);
    view.setUint8(4, this.version);
    view.setUint8(5, this.type);
    view.setUint8(6, this.flags);
    view.setUint8(7, this.nonceLen);
    view.setUint32(8, this.seq, true);
  }

  public static decode(src: Uint8Array, offset: number = 0): EnvelopeHeader {
    if (offset < 0 || src.length - offset < ENVELOPE_HEADER_SIZE) {
      throw new NalixStatus(StatusCode.OUT_OF_RANGE, 'Source too small for envelope header');
    }
    const view = new DataView(src.buffer, src.byteOffset + offset, ENVELOPE_HEADER_SIZE);
    const magic = view.getUint32(0, true);
    if (magic !== ENVELOPE_MAGIC) {
      throw new NalixStatus(StatusCode.INVALID_ARGUMENT, `Invalid envelope magic: 0x${magic.toString(16)}`);
    }
    const version = view.getUint8(4);
    const type = view.getUint8(5) as CipherSuiteType;
    const flags = view.getUint8(6);
    const nonceLen = view.getUint8(7);
    const seq = view.getUint32(8, true);

    const header = new EnvelopeHeader(version, type, flags, nonceLen, seq);
    header.magic = magic;
    return header;
  }
}

/**
 * Envelope encryption & decryption engine matching Nalix FrameCipher / AeadEngine.
 */
export class FrameCipher {
  /**
   * Encrypts plaintext into a Nalix AEAD envelope:
   * Header (12B) || Nonce (12B) || Ciphertext (NB) || Tag (16B)
   */
  public static encrypt(
    plaintext: Uint8Array,
    key: Uint8Array,
    seq: number,
    algorithm: CipherSuiteType = CipherSuiteType.Chacha20Poly1305,
    userAad?: Uint8Array
  ): Uint8Array {
    if (key.length !== 32) {
      throw new NalixStatus(StatusCode.INVALID_ARGUMENT, `Encryption key must be 32 bytes, got ${key.length}`);
    }

    if (algorithm !== CipherSuiteType.Chacha20Poly1305) {
      throw new NalixStatus(StatusCode.UNIMPLEMENTED, `Unsupported cipher suite: ${algorithm}`);
    }

    // 1. Generate 12-byte nonce
    const nonce = new Uint8Array(CHACHA20_NONCE_SIZE);
    crypto.getRandomValues(nonce);

    // 2. Prepare EnvelopeHeader
    const header = new EnvelopeHeader(ENVELOPE_VERSION, algorithm, 0, CHACHA20_NONCE_SIZE, seq);
    const headerBytes = new Uint8Array(ENVELOPE_HEADER_SIZE);
    header.encode(headerBytes, 0);

    // 3. Assemble AAD: Header (12B) || Nonce (12B) || UserAAD
    const extraAadLen = userAad ? userAad.length : 0;
    const aad = new Uint8Array(ENVELOPE_HEADER_SIZE + CHACHA20_NONCE_SIZE + extraAadLen);
    aad.set(headerBytes, 0);
    aad.set(nonce, ENVELOPE_HEADER_SIZE);
    if (userAad) {
      aad.set(userAad, ENVELOPE_HEADER_SIZE + CHACHA20_NONCE_SIZE);
    }

    // 4. Encrypt with ChaCha20-Poly1305 using @noble/ciphers
    const cipher = chacha20poly1305(key, nonce, aad);
    const ciphertextWithTag = cipher.encrypt(plaintext);

    // 5. Pack envelope: Header (12B) + Nonce (12B) + CiphertextWithTag (plaintext.length + 16B)
    const totalLength = ENVELOPE_HEADER_SIZE + CHACHA20_NONCE_SIZE + ciphertextWithTag.length;
    const envelope = new Uint8Array(totalLength);
    envelope.set(headerBytes, 0);
    envelope.set(nonce, ENVELOPE_HEADER_SIZE);
    envelope.set(ciphertextWithTag, ENVELOPE_HEADER_SIZE + CHACHA20_NONCE_SIZE);

    return envelope;
  }

  /**
   * Decrypts a Nalix AEAD envelope:
   * Header (12B) || Nonce (12B) || Ciphertext (NB) || Tag (16B)
   */
  public static decrypt(
    envelope: Uint8Array,
    key: Uint8Array,
    userAad?: Uint8Array
  ): { plaintext: Uint8Array; seq: number; algorithm: CipherSuiteType } {
    if (key.length !== 32) {
      throw new NalixStatus(StatusCode.INVALID_ARGUMENT, `Decryption key must be 32 bytes, got ${key.length}`);
    }

    if (envelope.length < ENVELOPE_HEADER_SIZE + CHACHA20_NONCE_SIZE + POLY1305_TAG_SIZE) {
      throw new NalixStatus(StatusCode.OUT_OF_RANGE, 'Envelope buffer too short for AEAD parsing');
    }

    // 1. Decode Header
    const header = EnvelopeHeader.decode(envelope, 0);
    if (header.type !== CipherSuiteType.Chacha20Poly1305) {
      throw new NalixStatus(StatusCode.UNIMPLEMENTED, `Unsupported cipher suite: ${header.type}`);
    }

    const nonceLen = header.nonceLen;
    if (envelope.length < ENVELOPE_HEADER_SIZE + nonceLen + POLY1305_TAG_SIZE) {
      throw new NalixStatus(StatusCode.OUT_OF_RANGE, 'Envelope buffer too short for nonce and tag');
    }

    // 2. Extract components
    const nonce = envelope.subarray(ENVELOPE_HEADER_SIZE, ENVELOPE_HEADER_SIZE + nonceLen);
    const ciphertextWithTag = envelope.subarray(ENVELOPE_HEADER_SIZE + nonceLen);

    // 3. Assemble AAD
    const extraAadLen = userAad ? userAad.length : 0;
    const aad = new Uint8Array(ENVELOPE_HEADER_SIZE + nonceLen + extraAadLen);
    aad.set(envelope.subarray(0, ENVELOPE_HEADER_SIZE), 0);
    aad.set(nonce, ENVELOPE_HEADER_SIZE);
    if (userAad) {
      aad.set(userAad, ENVELOPE_HEADER_SIZE + nonceLen);
    }

    // 4. Decrypt & authenticate
    try {
      const cipher = chacha20poly1305(key, nonce, aad);
      const plaintext = cipher.decrypt(ciphertextWithTag);
      return {
        plaintext,
        seq: header.seq,
        algorithm: header.type,
      };
    } catch (err: any) {
      throw new NalixStatus(StatusCode.UNAUTHENTICATED, `AEAD authentication failed: ${err.message || err}`);
    }
  }
}
