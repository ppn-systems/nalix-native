import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PacketHeader,
  Packet,
  StatusCode,
  NalixStatus,
  LZ4BlockHeader,
  FrameCompression,
  EnvelopeHeader,
  FrameCipher,
  ChannelConfig,
  TransportSession,
} from '../src/index.js';

class MockSession extends TransportSession {
  public sent: Uint8Array[] = [];
  public get isConnected(): boolean {
    return true;
  }
  public async connect(): Promise<void> {}
  public async disconnect(): Promise<void> {}
  public close(): void {}
  protected sendRawFrame(bytes: Uint8Array): void {
    this.sent.push(bytes);
  }
}

test('Edge Cases: PacketHeader bounds and validation errors', () => {
  // Truncated buffer (< 6 bytes)
  const tooShort = new Uint8Array([0x01, 0x00, 0x00, 0x00]);
  assert.throws(
    () => PacketHeader.decode(tooShort),
    (err: unknown) => err instanceof NalixStatus && err.code === StatusCode.OUT_OF_RANGE
  );

  // Negative offset
  const buf = new Uint8Array(10);
  assert.throws(
    () => PacketHeader.decode(buf, -1),
    (err: unknown) => err instanceof NalixStatus && err.code === StatusCode.OUT_OF_RANGE
  );

  // Offset out of range
  assert.throws(
    () => PacketHeader.decode(buf, 6),
    (err: unknown) => err instanceof NalixStatus && err.code === StatusCode.OUT_OF_RANGE
  );

  // Negative offset for encode
  const header = new PacketHeader(0x0100, 0, 0, 1);
  assert.throws(
    () => header.encode(buf, -1),
    (err: unknown) => err instanceof NalixStatus && err.code === StatusCode.RESOURCE_EXHAUSTED
  );

  // Offset out of range for encode
  assert.throws(
    () => header.encode(buf, 8),
    (err: unknown) => err instanceof NalixStatus && err.code === StatusCode.RESOURCE_EXHAUSTED
  );
});

test('Edge Cases: LZ4BlockHeader validation errors', () => {
  // Truncated buffer (< 8 bytes)
  const tooShort = new Uint8Array(7);
  assert.throws(
    () => LZ4BlockHeader.decode(tooShort),
    (err: unknown) => err instanceof NalixStatus && err.code === StatusCode.OUT_OF_RANGE
  );

  // Negative offset
  assert.throws(
    () => LZ4BlockHeader.decode(new Uint8Array(8), -1),
    (err: unknown) => err instanceof NalixStatus && err.code === StatusCode.OUT_OF_RANGE
  );

  // Buffer too small for encode
  const tooSmallForEncode = new Uint8Array(5);
  const lz4Header = new LZ4BlockHeader(100, 50);
  assert.throws(
    () => lz4Header.encode(tooSmallForEncode),
    (err: unknown) => err instanceof NalixStatus && err.code === StatusCode.RESOURCE_EXHAUSTED
  );
});

test('Edge Cases: FrameCompression corrupted payload handling', () => {
  // Buffer claiming valid original length = 100, but compressed body is invalid noise
  const bogus = new Uint8Array(16);
  const view = new DataView(bogus.buffer);
  view.setInt32(0, 100, true); // Original length: 100 bytes
  view.setInt32(4, 16, true);  // Compressed length: 16 bytes
  bogus.fill(0xff, 8);         // Bogus compressed bytes

  assert.throws(
    () => FrameCompression.decompress(bogus),
    (err: unknown) => err instanceof NalixStatus && err.code === StatusCode.DATA_LOSS
  );

  // Invalid original length (negative)
  view.setInt32(0, -5, true);
  assert.throws(
    () => FrameCompression.decompress(bogus),
    (err: unknown) => err instanceof NalixStatus && err.code === StatusCode.INVALID_ARGUMENT
  );

  // Invalid original length (> 64MB)
  view.setInt32(0, 70 * 1024 * 1024, true);
  assert.throws(
    () => FrameCompression.decompress(bogus),
    (err: unknown) => err instanceof NalixStatus && err.code === StatusCode.INVALID_ARGUMENT
  );
});

test('Edge Cases: EnvelopeHeader and FrameCipher tampering checks', () => {
  // Truncated envelope header (< 20 bytes)
  const tooShort = new Uint8Array(19);
  assert.throws(
    () => EnvelopeHeader.decode(tooShort),
    (err: unknown) => err instanceof NalixStatus && err.code === StatusCode.INVALID_ARGUMENT
  );

  // Bad envelope magic
  const badMagic = new Uint8Array(20);
  const view = new DataView(badMagic.buffer);
  view.setUint32(0, 0x12345678, true); // Wrong magic (expected 0x584C414E)
  assert.throws(
    () => EnvelopeHeader.decode(badMagic),
    (err: unknown) => err instanceof NalixStatus && err.code === StatusCode.INVALID_ARGUMENT
  );

  // Tampered ciphertext decryption fails authentication
  const key = new Uint8Array(32).fill(0x42);
  const plaintext = new TextEncoder().encode('Confidential payload');
  const encrypted = FrameCipher.encrypt(plaintext, key, 1);

  // Corrupt a byte in the ciphertext body
  encrypted[25] ^= 0x55;

  assert.throws(
    () => FrameCipher.decrypt(encrypted, key),
    (err: unknown) => err instanceof NalixStatus && err.code === StatusCode.UNAUTHENTICATED
  );
});

test('Edge Cases: Unicode strings, zero payloads, and JSON parsing', () => {
  // Multi-byte unicode round-trip
  const unicodeStr = 'Xin chào thế giới 🚀 🌟 日本語 Русский 🌍';
  const packet = Packet.create(0x0500, unicodeStr);
  assert.equal(packet.text(), unicodeStr);

  // Empty payload
  const emptyPacket = Packet.create(0x0501, new Uint8Array(0));
  assert.equal(emptyPacket.payload.length, 0);
  assert.equal(emptyPacket.text(), '');

  // JSON parsing success via Packet.fromJson
  const obj = { id: 123, name: 'nalix', nested: { active: true } };
  const jsonPacket = Packet.fromJson(0x0502, obj);
  assert.deepEqual(jsonPacket.json(), obj);

  // JSON parsing failure on malformed content
  const malformedPacket = Packet.create(0x0503, '{ invalid json:');
  assert.throws(() => malformedPacket.json(), SyntaxError);
});

test('Edge Cases: MaxMessageSize limit enforcement', async () => {
  const session = new MockSession(
    new ChannelConfig({
      url: 'wss://test.nalix.dev',
      maxMessageSize: 128, // Strict 128-byte limit
    })
  );

  // Payload exceeding 128 bytes
  const oversizedPayload = new Uint8Array(200);

  // session.send() should throw RESOURCE_EXHAUSTED
  assert.throws(
    () => session.send(0x0600, oversizedPayload),
    (err: unknown) => err instanceof NalixStatus && err.code === StatusCode.RESOURCE_EXHAUSTED
  );

  // session.request() should reject with RESOURCE_EXHAUSTED
  await assert.rejects(
    session.request(0x0600, oversizedPayload),
    (err: unknown) => err instanceof NalixStatus && err.code === StatusCode.RESOURCE_EXHAUSTED
  );
});
