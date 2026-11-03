import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Packet, PacketHeader, NALIX_HEADER_SIZE, NalixStatus, StatusCode } from '../src/index.js';

test('Status codes and NalixStatus error class', () => {
  const ok = NalixStatus.ok();
  assert.equal(ok.isOk, true);
  assert.equal(ok.code, StatusCode.OK);
  assert.equal(ok.codeName, 'OK');

  const err = NalixStatus.error(StatusCode.NOT_FOUND, 'Target packet was not found');
  assert.equal(err.isOk, false);
  assert.equal(err.code, StatusCode.NOT_FOUND);
  assert.equal(err.codeName, 'NOT_FOUND');
  assert.match(err.message, /NOT_FOUND/);
});

test('PacketHeader encoding and decoding (Little-Endian)', () => {
  const header = new PacketHeader(0x1a2b, 0x01, 0x02, 0x0042);
  const buf = new Uint8Array(NALIX_HEADER_SIZE);
  header.encode(buf, 0);

  // Little-Endian check
  assert.equal(buf[0], 0x2b);
  assert.equal(buf[1], 0x1a);
  assert.equal(buf[2], 0x01);
  assert.equal(buf[3], 0x02);
  assert.equal(buf[4], 0x42);
  assert.equal(buf[5], 0x00);

  const decoded = PacketHeader.decode(buf, 0);
  assert.equal(decoded.opcode, 0x1a2b);
  assert.equal(decoded.flags, 0x01);
  assert.equal(decoded.priority, 0x02);
  assert.equal(decoded.sequenceId, 0x0042);
});

test('Packet payload serialization and round-trip', () => {
  const header = new PacketHeader(0x0001, 0x04, 0x02, 0x0001);
  const payload = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
  const packet = new Packet(header, payload);

  const encoded = packet.encode();
  assert.equal(encoded.length, NALIX_HEADER_SIZE + payload.length);

  const decoded = Packet.decode(encoded);
  assert.equal(decoded.header.opcode, 0x0001);
  assert.equal(decoded.header.flags, 0x04);
  assert.equal(decoded.header.priority, 0x02);
  assert.equal(decoded.header.sequenceId, 0x0001);
  assert.deepEqual(decoded.payload, payload);
});
