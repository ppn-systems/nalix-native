import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Packet,
  PacketHeader,
  PacketFlags,
  FrameCompression,
  LZ4BlockHeader,
  LZ4_BLOCK_HEADER_SIZE,
  FrameCipher,
  EnvelopeHeader,
  ENVELOPE_HEADER_SIZE,
  ENVELOPE_MAGIC,
  CipherSuiteType,
  FramePipeline,
  SessionState,
  ChannelConfig,
  NalixStatus,
  StatusCode,
} from '../src/index.js';

test('LZ4BlockHeader encoding and decoding (Little-Endian)', () => {
  const header = new LZ4BlockHeader(1024, 256);
  const buf = new Uint8Array(LZ4_BLOCK_HEADER_SIZE);
  header.encode(buf, 0);

  const view = new DataView(buf.buffer, buf.byteOffset, LZ4_BLOCK_HEADER_SIZE);
  assert.equal(view.getInt32(0, true), 1024);
  assert.equal(view.getInt32(4, true), 256);

  const decoded = LZ4BlockHeader.decode(buf, 0);
  assert.equal(decoded.originalLength, 1024);
  assert.equal(decoded.compressedLength, 256);
});

test('FrameCompression compresses worthwhile payloads and decompresses correctly', () => {
  // Highly compressible payload (repeated text)
  const original = new TextEncoder().encode('PPN Nalix protocol binary streaming payload test data. '.repeat(20));
  assert.ok(original.length > 512);

  const compressed = FrameCompression.compress(original);
  assert.ok(compressed !== null, 'Compression should succeed for compressible data');
  assert.ok(compressed.length < original.length, 'Compressed size must be smaller than original');

  // Verify LZ4 header in the output
  const lz4Header = LZ4BlockHeader.decode(compressed, 0);
  assert.equal(lz4Header.originalLength, original.length);
  assert.equal(lz4Header.compressedLength, compressed.length);

  // Decompress
  const decompressed = FrameCompression.decompress(compressed);
  assert.deepEqual(decompressed, original);
});

test('FrameCompression skips incompressible small payloads', () => {
  // Random bytes are incompressible
  const randomPayload = new Uint8Array(64);
  crypto.getRandomValues(randomPayload);

  const compressed = FrameCompression.compress(randomPayload);
  assert.equal(compressed, null, 'Incompressible random payload should return null');
});

test('EnvelopeHeader encoding and decoding (Little-Endian)', () => {
  const header = new EnvelopeHeader(1, CipherSuiteType.Chacha20Poly1305, 0, 12, 42);
  const buf = new Uint8Array(ENVELOPE_HEADER_SIZE);
  header.encode(buf, 0);

  const view = new DataView(buf.buffer, buf.byteOffset, ENVELOPE_HEADER_SIZE);
  assert.equal(view.getUint32(0, true), ENVELOPE_MAGIC);
  assert.equal(view.getUint8(4), 1);
  assert.equal(view.getUint8(5), CipherSuiteType.Chacha20Poly1305);
  assert.equal(view.getUint8(6), 0);
  assert.equal(view.getUint8(7), 12);
  assert.equal(view.getUint32(8, true), 42);

  const decoded = EnvelopeHeader.decode(buf, 0);
  assert.equal(decoded.magic, ENVELOPE_MAGIC);
  assert.equal(decoded.version, 1);
  assert.equal(decoded.type, CipherSuiteType.Chacha20Poly1305);
  assert.equal(decoded.nonceLen, 12);
  assert.equal(decoded.seq, 42);
});

test('FrameCipher encrypts and decrypts with ChaCha20-Poly1305 round-trip', () => {
  const key = new Uint8Array(32);
  crypto.getRandomValues(key);

  const plaintext = new TextEncoder().encode('Secret Nalix authenticated message payload.');
  const seq = 101;

  const envelope = FrameCipher.encrypt(plaintext, key, seq, CipherSuiteType.Chacha20Poly1305);
  assert.ok(envelope.length > plaintext.length);

  const res = FrameCipher.decrypt(envelope, key);
  assert.equal(res.seq, seq);
  assert.equal(res.algorithm, CipherSuiteType.Chacha20Poly1305);
  assert.deepEqual(res.plaintext, plaintext);
});

test('FrameCipher rejects tampered ciphertext and wrong key', () => {
  const key = new Uint8Array(32);
  const wrongKey = new Uint8Array(32);
  crypto.getRandomValues(key);
  crypto.getRandomValues(wrongKey);

  const plaintext = new TextEncoder().encode('Confidential data');
  const envelope = FrameCipher.encrypt(plaintext, key, 1);

  // Wrong key
  assert.throws(() => {
    FrameCipher.decrypt(envelope, wrongKey);
  }, /AEAD authentication failed/);

  // Tampered ciphertext
  const tampered = new Uint8Array(envelope);
  tampered[tampered.length - 1] ^= 0x01; // flip 1 bit in auth tag
  assert.throws(() => {
    FrameCipher.decrypt(tampered, key);
  }, /AEAD authentication failed/);
});

test('FramePipeline auto-assigns sequenceId and performs compress + encrypt outbound', () => {
  const config = new ChannelConfig({
    compressionEnabled: true,
    compressionThreshold: 128,
  });
  const state = new SessionState();
  const key = new Uint8Array(32);
  crypto.getRandomValues(key);
  state.secret = key;
  state.encryptionEnabled = true;

  let seq16Counter = 0;
  let seq32Counter = 0;
  const nextSeq16 = () => ++seq16Counter;
  const nextSeq32 = () => ++seq32Counter;

  // Create compressible packet with sequenceId = 0 (unset)
  const originalPayload = new TextEncoder().encode('Repeated data for Nalix full transport pipeline. '.repeat(15));
  const packet = new Packet(new PacketHeader(0x0500, 0, 0, 0), originalPayload);

  // Process outbound
  const processed = FramePipeline.processOutbound(packet, config, state, nextSeq16, nextSeq32);

  assert.equal(processed.header.sequenceId, 1, 'SequenceId should be auto-stamped to 1');
  assert.ok((processed.header.flags & PacketFlags.COMPRESSED) !== 0, 'COMPRESSED flag should be set');
  assert.ok((processed.header.flags & PacketFlags.ENCRYPTED) !== 0, 'ENCRYPTED flag should be set');
  assert.notDeepEqual(processed.payload, originalPayload, 'Payload on wire should be encrypted & compressed');

  // Process inbound
  const restored = FramePipeline.processInbound(processed, state);

  assert.equal(restored.header.flags & PacketFlags.COMPRESSED, 0, 'COMPRESSED flag should be cleared after decompression');
  assert.equal(restored.header.flags & PacketFlags.ENCRYPTED, 0, 'ENCRYPTED flag should be cleared after decryption');
  assert.deepEqual(restored.payload, originalPayload, 'Restored payload must match original');
});
