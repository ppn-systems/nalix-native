import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Packet,
  PacketHeader,
  PacketFlags,
  ProtocolOpCode,
  ControlType,
  TransportSession,
  ConnectivityState,
} from '../src/index.js';

/** Captures every outbound frame so tests can inspect the wire header flags. */
class CaptureSession extends TransportSession {
  public outbound: Uint8Array[] = [];

  constructor() {
    super({ url: 'wss://mock.nalix.dev' } as any);
    this._state = ConnectivityState.READY;
  }

  public get isConnected(): boolean {
    return true;
  }

  public async connect(): Promise<void> {}
  public async disconnect(): Promise<void> {}
  public close(): void {}

  protected sendRawFrame(bytes: Uint8Array): void {
    this.outbound.push(bytes);
  }

  public lastFlags(): number {
    const frame = this.outbound[this.outbound.length - 1];
    return PacketHeader.decode(frame, 0).flags;
  }
}

const SECRET = new Uint8Array(32).fill(7);

/** Fire-and-forget a control call: the frame is sent synchronously, the reply never arrives. */
function fire(p: Promise<unknown>): void {
  p.catch(() => {});
}

test('before encryption is enabled, ping/timesync/rekey frames stay plaintext', () => {
  const s = new CaptureSession();
  fire(s.ping(10));
  assert.equal(s.lastFlags() & PacketFlags.ENCRYPTED, 0);
  fire(s.syncTime(10));
  assert.equal(s.lastFlags() & PacketFlags.ENCRYPTED, 0);
});

test('after handshake (secret set), PING frames carry the ENCRYPTED flag', () => {
  const s = new CaptureSession();
  s.setSecret(SECRET);
  fire(s.ping(10));
  assert.notEqual(s.lastFlags() & PacketFlags.ENCRYPTED, 0, 'PING must be encrypted after handshake');
});

test('after handshake (secret set), TIMESYNC frames carry the ENCRYPTED flag', () => {
  const s = new CaptureSession();
  s.setSecret(SECRET);
  fire(s.syncTime(10));
  const frame = s.outbound[s.outbound.length - 1];
  assert.equal(PacketHeader.decode(frame, 0).opcode, ProtocolOpCode.SYSTEM_TIMESYNC);
  assert.notEqual(s.lastFlags() & PacketFlags.ENCRYPTED, 0, 'TIMESYNC must be encrypted after handshake');
});

test('after handshake, REKEY control frames are encrypted', () => {
  const s = new CaptureSession();
  s.setSecret(SECRET);
  fire(s.rekey(10));
  assert.notEqual(s.lastFlags() & PacketFlags.ENCRYPTED, 0, 'REKEY must be encrypted after handshake');
});

test('ping payload is ciphertext after handshake, not the plaintext control payload', () => {
  const s = new CaptureSession();
  s.setSecret(SECRET);
  fire(s.ping(10));
  const frame = s.outbound[s.outbound.length - 1];
  const payloadLen = frame.length - 6;
  // Plaintext PING payload is 17 bytes; AEAD adds a tag, so the encrypted body is longer.
  assert.ok(payloadLen > 17, `expected ciphertext longer than plaintext PING payload, got ${payloadLen}`);
  assert.notEqual(frame[6], ControlType.PING);
});

test('handshake frames (SESSION_INIT, SESSION_PROOF) stay plaintext even when encryption is enabled', () => {
  const s = new CaptureSession();
  s.setSecret(SECRET);
  for (const opcode of [ProtocolOpCode.SESSION_INIT, ProtocolOpCode.SESSION_PROOF]) {
    s.send(Packet.create(opcode, new Uint8Array(32)));
    assert.equal(s.lastFlags() & PacketFlags.ENCRYPTED, 0, `opcode 0x${opcode.toString(16)} must be plaintext`);
  }
});

test('resume frame (SESSION_SIGNAL) is plaintext by design: sent before the secure channel exists', () => {
  // Resume happens on a fresh connection before encryption is active, so the frame is unencrypted.
  const s = new CaptureSession();
  s.send(Packet.create(ProtocolOpCode.SESSION_SIGNAL, new Uint8Array(43)));
  assert.equal(s.lastFlags() & PacketFlags.ENCRYPTED, 0);
});

test('resume frame stays plaintext even if a session reports encryption enabled', () => {
  const s = new CaptureSession();
  s.setSecret(SECRET);
  s.send(Packet.create(ProtocolOpCode.SESSION_SIGNAL, new Uint8Array(43)));
  assert.equal(s.lastFlags() & PacketFlags.ENCRYPTED, 0);
});

test('an explicit encrypt option still overrides the default policy', () => {
  const s = new CaptureSession();
  s.setSecret(SECRET);
  s.send(Packet.create(ProtocolOpCode.SYSTEM_TIMESYNC, new Uint8Array(17)), undefined, { encrypt: false });
  assert.equal(s.lastFlags() & PacketFlags.ENCRYPTED, 0);
});
