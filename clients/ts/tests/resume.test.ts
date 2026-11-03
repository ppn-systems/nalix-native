import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TransportSession,
  ChannelConfig,
  Packet,
  PacketHeader,
  ProtocolOpCode,
  ProtocolReason,
  SessionResumeStage,
  ControlType,
  StatusCode,
  NalixStatus,
  encodeResumePayload,
  decodeResumePayload,
  computeResumeProof,
  verifyResumeResponseProof,
  hasResumeState,
  HandshakeX25519,
  SESSION_RESUME_PAYLOAD_SIZE,
} from '../src/index.js';

class MockResumeSession extends TransportSession {
  public outboundFrames: Packet[] = [];
  public inboundQueue: Packet[] = [];
  public handshakeCalled = false;
  private _connected = true;

  constructor(token: bigint = 0n, secret: Uint8Array | null = null, config?: any) {
    super(new ChannelConfig({ url: 'wss://mock.nalix.dev', ...config }));
    this._state = 'READY' as any;
    if (token) this._sessionState.sessionToken = token;
    if (secret) {
      this._sessionState.secret = secret;
      this._sessionState.encryptionEnabled = true;
    }
  }

  public get isConnected(): boolean {
    return this._connected;
  }

  public async connect(): Promise<void> {
    this._connected = true;
  }

  public async disconnect(): Promise<void> {
    this._connected = false;
  }

  public close(): void {
    this._connected = false;
  }

  public override async handshake(): Promise<any> {
    this.handshakeCalled = true;
    this._sessionState.sessionToken = 9999n;
    this._sessionState.secret = new Uint8Array(32).fill(0xee);
    this._sessionState.encryptionEnabled = true;
    return { sessionKey: this._sessionState.secret, sessionToken: 9999n, serverPublicKey: new Uint8Array(32) };
  }

  protected sendRawFrame(bytes: Uint8Array): void {
    const packet = Packet.decode(bytes);
    this.outboundFrames.push(packet);
  }

  public simulateInbound(packet: Packet): void {
    this.dispatchInboundPacket(packet);
  }
}

test('SessionResume: 43-byte payload binary encoding and decoding round-trip', () => {
  const token = 822727263349899265n;
  const proof = new Uint8Array(32).fill(0x42);
  const stage = SessionResumeStage.REQUEST;
  const reason = ProtocolReason.NONE;

  const payload = encodeResumePayload(stage, token, reason, proof);
  assert.equal(payload.length, SESSION_RESUME_PAYLOAD_SIZE);

  const decoded = decodeResumePayload(payload);
  assert.equal(decoded.stage, stage);
  assert.equal(decoded.sessionToken, token);
  assert.equal(decoded.reason, reason);
  assert.deepEqual(decoded.proof, proof);
});

test('SessionResume: Truncated payload throws INVALID_ARGUMENT', () => {
  const shortBuf = new Uint8Array(20);
  assert.throws(
    () => decodeResumePayload(shortBuf),
    (err: unknown) => err instanceof NalixStatus && err.code === StatusCode.INVALID_ARGUMENT
  );
});

test('SessionResume: Proof computation and sliding time-window verification', () => {
  const secret = new Uint8Array(32).fill(0x77);
  const token = 123456789n;

  const proof = computeResumeProof(secret, token);
  assert.equal(proof.length, 32);

  // Verification succeeds against current window
  const valid = verifyResumeResponseProof(secret, token, proof);
  assert.equal(valid, true);

  // Wrong secret fails verification
  const wrongSecret = new Uint8Array(32).fill(0x88);
  const invalid = verifyResumeResponseProof(wrongSecret, token, proof);
  assert.equal(invalid, false);

  // Wrong token fails verification
  const invalidToken = verifyResumeResponseProof(secret, 999999n, proof);
  assert.equal(invalidToken, false);
});

test('SessionResume: resumeSession succeeds on server NONE response and proof match', async () => {
  const token = 55555n;
  const secret = new Uint8Array(32).fill(0x33);
  const session = new MockResumeSession(token, secret);

  assert.equal(session.hasResumeState, true);

  // Start resume
  const resumePromise = session.resumeSession({ timeoutMs: 1000 });

  // Outbound frame was sent
  assert.equal(session.outboundFrames.length, 1);
  const outbound = session.outboundFrames[0];
  assert.equal(outbound.header.opcode, ProtocolOpCode.SESSION_SIGNAL);

  // Server generates valid response proof
  const serverProof = computeResumeProof(secret, token);
  const responsePayload = encodeResumePayload(
    SessionResumeStage.RESPONSE,
    token,
    ProtocolReason.NONE,
    serverProof
  );
  const responsePacket = new Packet(
    new PacketHeader(ProtocolOpCode.SESSION_SIGNAL, 0, 0, outbound.header.sequenceId),
    responsePayload
  );

  session.simulateInbound(responsePacket);

  const reason = await resumePromise;
  assert.equal(reason, ProtocolReason.NONE);
  assert.equal(session.isEncrypted, true);
  assert.equal(session.sessionState.sessionToken, token);
});

test('SessionResume: resumeSession detects server rejection without throwing', async () => {
  const token = 55555n;
  const secret = new Uint8Array(32).fill(0x33);
  const session = new MockResumeSession(token, secret);

  const resumePromise = session.resumeSession({ timeoutMs: 1000 });
  const outbound = session.outboundFrames[0];

  // Server responds with SESSION_NOT_FOUND (550)
  const responsePayload = encodeResumePayload(
    SessionResumeStage.RESPONSE,
    token,
    ProtocolReason.SESSION_NOT_FOUND,
    new Uint8Array(32)
  );
  session.simulateInbound(
    new Packet(
      new PacketHeader(ProtocolOpCode.SESSION_SIGNAL, 0, 0, outbound.header.sequenceId),
      responsePayload
    )
  );

  const reason = await resumePromise;
  assert.equal(reason, ProtocolReason.SESSION_NOT_FOUND);
});

test('SessionResume: resumeSession rejects tampered proof with UNAUTHENTICATED', async () => {
  const token = 55555n;
  const secret = new Uint8Array(32).fill(0x33);
  const session = new MockResumeSession(token, secret);

  const resumePromise = session.resumeSession({ timeoutMs: 1000 });
  const outbound = session.outboundFrames[0];

  // Server responds with invalid/tampered proof
  const bogusProof = new Uint8Array(32).fill(0xff);
  const responsePayload = encodeResumePayload(
    SessionResumeStage.RESPONSE,
    token,
    ProtocolReason.NONE,
    bogusProof
  );
  session.simulateInbound(
    new Packet(
      new PacketHeader(ProtocolOpCode.SESSION_SIGNAL, 0, 0, outbound.header.sequenceId),
      responsePayload
    )
  );

  await assert.rejects(resumePromise, (err: unknown) => {
    assert.ok(err instanceof NalixStatus);
    assert.equal(err.code, StatusCode.UNAUTHENTICATED);
    return true;
  });
});

test('SessionResume: connectWithResume falls back to full handshake on rejection', async () => {
  const token = 77777n;
  const secret = new Uint8Array(32).fill(0x55);
  const session = new MockResumeSession(token, secret, {
    resumeFallbackToHandshake: true,
  });

  const connectPromise = session.connectWithResume();

  // Outbound resume was sent
  const outbound = session.outboundFrames[0];

  // Server rejects resume with TOKEN_EXPIRED
  const responsePayload = encodeResumePayload(
    SessionResumeStage.RESPONSE,
    token,
    ProtocolReason.TOKEN_EXPIRED,
    new Uint8Array(32)
  );
  session.simulateInbound(
    new Packet(
      new PacketHeader(ProtocolOpCode.SESSION_SIGNAL, 0, 0, outbound.header.sequenceId),
      responsePayload
    )
  );

  const result = await connectPromise;
  assert.equal(result.resumed, false);
  assert.equal(result.reason, ProtocolReason.TOKEN_EXPIRED);
  assert.equal(session.handshakeCalled, true);
  assert.equal(session.sessionState.sessionToken, 9999n);
});

test('SessionResume: connectWithResume skips resume when no resume state exists', async () => {
  const session = new MockResumeSession(0n, null); // No token, no secret

  assert.equal(session.hasResumeState, false);
  const result = await session.connectWithResume();

  assert.equal(result.resumed, false);
  assert.equal(result.reason, ProtocolReason.SESSION_NOT_FOUND);
  assert.equal(session.handshakeCalled, true);
});

test('Extensions: rekey rotates session secret with HKDF ratcheting', async () => {
  const initialSecret = new Uint8Array(32).fill(0x11);
  const session = new MockResumeSession(100n, initialSecret);

  const expectedNewKey = HandshakeX25519.deriveRekeySecret(initialSecret);
  assert.equal(expectedNewKey.length, 32);
  assert.notDeepEqual(expectedNewKey, initialSecret);

  const rekeyPromise = session.rekey(1000);

  // Rekey request was sent
  assert.equal(session.outboundFrames.length, 1);
  const outbound = session.outboundFrames[0];
  assert.equal(outbound.header.opcode, ProtocolOpCode.SYSTEM_CONTROL);
  assert.equal(outbound.payload[2], ControlType.SESSION_REKEY);

  // Server sends SESSION_REKEY_ACK
  const ackPayload = new Uint8Array(3);
  ackPayload[2] = ControlType.SESSION_REKEY_ACK;
  session.simulateInbound(
    new Packet(
      new PacketHeader(ProtocolOpCode.SYSTEM_CONTROL, 0, 0, outbound.header.sequenceId),
      ackPayload
    )
  );

  await rekeyPromise;
  assert.deepEqual(session.sessionState.secret, expectedNewKey);
});

test('Extensions: disconnectGracefully sends DISCONNECT control frame and closes', async () => {
  const session = new MockResumeSession(100n, new Uint8Array(32));

  await session.disconnectGracefully(ProtocolReason.CLIENT_QUIT);

  assert.equal(session.outboundFrames.length, 1);
  const outbound = session.outboundFrames[0];
  assert.equal(outbound.header.opcode, ProtocolOpCode.SYSTEM_CONTROL);
  assert.equal(outbound.payload[2], ControlType.DISCONNECT);

  const view = new DataView(outbound.payload.buffer, outbound.payload.byteOffset, outbound.payload.byteLength);
  assert.equal(view.getUint16(0, true), ProtocolReason.CLIENT_QUIT);
  assert.equal(session.isConnected, false);
});
