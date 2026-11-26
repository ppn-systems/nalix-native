/**
 * Behaviour ported from Nalix 14.3.10 .. 14.4.1 (see CHANGELOG 0.2.0).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { x25519 } from '@noble/curves/ed25519.js';
import {
  ChannelConfig,
  ConnectivityState,
  ControlFlags,
  ControlType,
  FrameCipher,
  FramePipeline,
  HandshakeX25519,
  NALIX_TARGET_VERSION,
  NalixStatus,
  Packet,
  PacketFlags,
  PacketHeader,
  ProtocolAdvice,
  ProtocolOpCode,
  ProtocolReason,
  SDK_VERSION,
  SequenceCounter,
  SessionResumeStage,
  SessionState,
  StatusCode,
  TransportSession,
  WebSocketSession,
  closeToStatus,
  computeResumeProof,
  decodeDirective,
  decodePowChallenge,
  encodeDirective,
  encodePowProof,
  encodeResumePayload,
  hasLeadingZeroBits,
  solvePowChallenge,
} from '../src/index.js';

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

/** A transport session whose wire is an in-memory array; inbound frames go through the real inbound path. */
class WireSession extends TransportSession {
  public sent: Uint8Array[] = [];
  public failNextSend = false;
  private _connected = true;

  constructor(options: Record<string, unknown> = {}) {
    super(new ChannelConfig({ url: 'wss://mock.nalix.dev/ws/', ...options }));
    this._state = ConnectivityState.READY;
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

  protected sendRawFrame(bytes: Uint8Array): void {
    if (this.failNextSend) {
      this.failNextSend = false;
      throw new NalixStatus(StatusCode.UNAVAILABLE, 'socket gone');
    }
    this.sent.push(bytes.slice());
  }

  /** Feeds raw bytes as if they came off the socket. */
  public receive(bytes: Uint8Array): void {
    this.handleInboundFrame(bytes);
  }

  public lastSent(): Packet {
    return Packet.decode(this.sent[this.sent.length - 1]);
  }
}

/** Builds an encrypted server frame with an explicit envelope sequence number. */
function serverFrame(opcode: number, payload: Uint8Array, key: Uint8Array, seq32: number, seq16 = 0): Uint8Array {
  const header = new PacketHeader(opcode, PacketFlags.ENCRYPTED, 0, seq16);
  const aad = new Uint8Array(6);
  header.encode(aad, 0);
  return new Packet(header, FrameCipher.encrypt(payload, key, seq32, undefined, aad)).encode();
}

function plainFrame(opcode: number, payload: Uint8Array, seq16 = 0): Uint8Array {
  return new Packet(new PacketHeader(opcode, PacketFlags.SYSTEM, 0, seq16), payload).encode();
}

function controlPayload(type: ControlType, reason: ProtocolReason = ProtocolReason.NONE): Uint8Array {
  const p = new Uint8Array(3);
  new DataView(p.buffer).setUint16(0, reason, true);
  p[2] = type;
  return p;
}

const tick = () => new Promise((r) => setImmediate(r));

// ---------------------------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------------------------

test('14.4: version constants match package.json and the target Nalix release', () => {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.equal(SDK_VERSION, pkg.version);
  assert.equal(NALIX_TARGET_VERSION, '14.4.1');
});

test('14.4: new opcodes and reason codes have the host values', () => {
  assert.equal(ProtocolOpCode.DATAGRAM_TICKET, 0x000c);
  assert.equal(ProtocolOpCode.TUNNEL_CHALLENGE, 0x00f1);
  assert.equal(ProtocolOpCode.TUNNEL_PROOF, 0x00f2);
  assert.equal(ProtocolOpCode.OBSERVABILITY_ACCESS, 0x00ff);
  assert.equal(ProtocolReason.RATE_LIMITED, 207);
  assert.equal(ProtocolReason.POW_REQUIRED, 270);
  assert.equal(ProtocolReason.REPLAY_DETECTED, 266);
  assert.equal(ProtocolReason.SERVER_SHUTDOWN, 300);
  assert.equal(ProtocolReason.TIME_SKEW, 554);
  assert.equal(ProtocolReason.RESERVED_901, 901);
  assert.equal(ProtocolAdvice.FIX_AND_RETRY, 7);
  assert.equal(ControlFlags.SLOW_DOWN, 8);
});

// ---------------------------------------------------------------------------------------------
// SequenceCounter
// ---------------------------------------------------------------------------------------------

test('SequenceCounter: issues 1.. and refuses to wrap', () => {
  const c = new SequenceCounter();
  assert.equal(c.next(), 1);
  assert.equal(c.next(), 2);
  const top = new SequenceCounter(0xffffffff - 1);
  assert.equal(top.next(), 0xffffffff);
  assert.throws(() => top.next(), (e: any) => e instanceof NalixStatus && e.code === StatusCode.RESOURCE_EXHAUSTED);
  assert.equal(top.isApproachingOverflow(), true);
  top.reset();
  assert.equal(top.next(), 1);
});

test('SequenceCounter: replay window matches the host (window 32)', () => {
  const c = new SequenceCounter();
  assert.equal(c.isValid(undefined, 32), true, 'plaintext frames carry no sequence');
  assert.equal(c.isValid(7, 32), true, 'anything goes before the first frame');
  c.updateTo(10);
  assert.equal(c.isValid(10, 32), false, 'duplicate');
  assert.equal(c.isValid(11, 32), true, 'newer');
  assert.equal(c.isValid(9, 32), true, 'older but unseen, inside the window');
  c.updateTo(9);
  assert.equal(c.isValid(9, 32), false, 'older and already seen');
  assert.equal(c.isValid(0, 32), false);
  c.updateTo(100);
  assert.equal(c.isValid(68, 32), false, 'outside the window');
  assert.equal(c.isValid(69, 32), true, 'last slot of the window');
  assert.equal(c.isValid(99, 0), false, 'window 0 accepts only newer');
});

// ---------------------------------------------------------------------------------------------
// Inbound replay protection
// ---------------------------------------------------------------------------------------------

test('inbound: replayed encrypted frames are dropped and reported, fresh ones dispatched', () => {
  const key = new Uint8Array(32).fill(3);
  const s = new WireSession();
  s.setSecret(key);
  const seen: number[] = [];
  const errors: NalixStatus[] = [];
  s.on(0x0300, (p) => seen.push(p.payload[0]));
  s.onError((e) => errors.push(e));

  const f5 = serverFrame(0x0300, new Uint8Array([5]), key, 5);
  s.receive(f5);
  s.receive(f5); // exact replay
  s.receive(serverFrame(0x0300, new Uint8Array([4]), key, 4)); // reordered, inside the window
  s.receive(serverFrame(0x0300, new Uint8Array([6]), key, 6));
  s.receive(plainFrame(0x0300, new Uint8Array([0])));

  assert.deepEqual(seen, [5, 4, 6, 0]);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, StatusCode.ALREADY_EXISTS);
  assert.equal(errors[0].details?.reason, ProtocolReason.REPLAY_DETECTED);
  assert.equal(s.sessionState.receiveSequence.current, 6);
});

test('inbound: a replayed frame cannot fail a live request with the same sequence id', async () => {
  const key = new Uint8Array(32).fill(4);
  const s = new WireSession();
  s.setSecret(key);
  s.receive(serverFrame(0x0301, new Uint8Array([1]), key, 9, 1));
  const pending = s.request(0x0301, new Uint8Array([1]), { timeoutMs: 1000, sequenceId: 1 });
  s.receive(serverFrame(0x0301, new Uint8Array([1]), key, 9, 1)); // stale copy
  s.receive(serverFrame(0x0301, new Uint8Array([2]), key, 10, 1)); // the real reply
  const reply = await pending;
  assert.equal(reply.payload[0], 2);
});

// ---------------------------------------------------------------------------------------------
// Sequence counters across handshake / resume
// ---------------------------------------------------------------------------------------------

/** Minimal host: handshake (optionally behind proof-of-work) and session resume. */
class MockHost {
  staticKey = x25519.keygen();
  ephemeral = x25519.keygen();
  nonce = crypto.getRandomValues(new Uint8Array(32));
  sessionKey: Uint8Array | null = null;
  token = 0x1122334455667788n;
  powDifficulty = 0;
  powSolved = false;
  resumeReason: ProtocolReason = ProtocolReason.NONE;
  sendSeq = 0;
  received: Packet[] = [];
  private client: { pub: Uint8Array; nonce: Uint8Array } | null = null;
  private master: Uint8Array | null = null;
  private transcript: Uint8Array | null = null;

  constructor(private readonly deliver: (bytes: Uint8Array) => void) {}

  onFrame(bytes: Uint8Array): void {
    const pkt = Packet.decode(bytes);
    if ((pkt.header.flags & PacketFlags.ENCRYPTED) !== 0) {
      const st = new SessionState();
      st.secret = this.sessionKey;
      FramePipeline.processInbound(pkt, st);
    }
    this.received.push(pkt);
    const reply = (opcode: number, payload: Uint8Array, encrypt: boolean) =>
      setTimeout(() => {
        this.deliver(
          encrypt
            ? serverFrame(opcode, payload, this.sessionKey!, ++this.sendSeq, pkt.header.sequenceId)
            : plainFrame(opcode, payload, pkt.header.sequenceId)
        );
      }, 1);

    switch (pkt.header.opcode) {
      case ProtocolOpCode.SESSION_INIT: {
        if (this.powDifficulty > 0 && !this.powSolved) {
          reply(ProtocolOpCode.SYSTEM_CONTROL, controlPayload(ControlType.ERROR, ProtocolReason.POW_REQUIRED), false);
          return;
        }
        this.client = { pub: pkt.payload.slice(0, 32), nonce: pkt.payload.slice(32, 64) };
        const ee = x25519.getSharedSecret(this.ephemeral.secretKey, this.client.pub);
        const se = x25519.getSharedSecret(this.staticKey.secretKey, this.client.pub);
        this.master = HandshakeX25519.computeMasterSecret(ee, se);
        this.transcript = HandshakeX25519.computeTranscriptHash(this.client.pub, this.client.nonce, this.ephemeral.publicKey, this.nonce);
        const out = new Uint8Array(96);
        out.set(this.ephemeral.publicKey, 0);
        out.set(this.nonce, 32);
        out.set(HandshakeX25519.computeServerProof(this.master, this.transcript), 64);
        reply(ProtocolOpCode.SESSION_CHALLENGE, out, false);
        return;
      }
      case ProtocolOpCode.SYSTEM_CONTROL: {
        if (pkt.payload[2] === ControlType.POW_REQUEST) {
          const ch = new Uint8Array(73);
          ch.set(crypto.getRandomValues(new Uint8Array(32)), 0);
          ch[32] = this.powDifficulty;
          new DataView(ch.buffer).setBigInt64(33, 123456789n, true);
          ch.set(crypto.getRandomValues(new Uint8Array(32)), 41);
          reply(ProtocolOpCode.POW_CHALLENGE, ch, false);
        } else if (pkt.payload[2] === ControlType.PUBLIC_KEY_REQUEST) {
          reply(ProtocolOpCode.SESSION_TOFU, this.staticKey.publicKey, false);
        }
        return;
      }
      case ProtocolOpCode.POW_PROOF: {
        const challenge = decodePowChallenge(pkt.payload.subarray(0, 73));
        const solution = Number(new DataView(pkt.payload.buffer, pkt.payload.byteOffset).getBigInt64(73, true));
        const puzzle = new Uint8Array(49);
        puzzle.set(pkt.payload.subarray(0, 41), 0);
        new DataView(puzzle.buffer).setBigInt64(41, BigInt(solution), true);
        assert.ok(hasLeadingZeroBits(keccak_256(puzzle), challenge.difficulty), 'host verifies the proof-of-work');
        this.powSolved = true;
        return;
      }
      case ProtocolOpCode.SESSION_PROOF: {
        this.sessionKey = HandshakeX25519.deriveSessionKey(this.master!, this.client!.nonce, this.nonce, this.transcript!);
        this.sendSeq = 0; // the host restarts its counters when it installs the key
        const out = new Uint8Array(40);
        out.set(HandshakeX25519.computeServerFinishProof(this.master!, this.transcript!), 0);
        new DataView(out.buffer).setBigUint64(32, this.token, true);
        reply(ProtocolOpCode.SESSION_ESTABLISHED, out, true);
        return;
      }
      case ProtocolOpCode.SESSION_SIGNAL: {
        // Resume keeps the host's counters (ppn-systems/nalix#479).
        const proof = this.resumeReason === ProtocolReason.NONE ? computeResumeProof(this.sessionKey!, this.token) : new Uint8Array(32);
        reply(ProtocolOpCode.SESSION_SIGNAL, encodeResumePayload(SessionResumeStage.RESPONSE, this.token, this.resumeReason, proof), false);
        return;
      }
    }
  }
}

class HostedSession extends WireSession {
  host: MockHost;
  constructor(options: Record<string, unknown> = {}) {
    super(options);
    this.host = new MockHost((b) => this.receive(b));
  }
  protected override sendRawFrame(bytes: Uint8Array): void {
    super.sendRawFrame(bytes);
    this.host.onFrame(bytes);
  }
}

test('handshake: restarts both sequence directions; resume continues them', async () => {
  const s = new HostedSession();
  // Leftover counters from an earlier key must not leak into the new session.
  s.sessionState.sendSequence.reset(500);
  s.sessionState.receiveSequence.reset(700);

  await s.handshake({ timeoutMs: 2000 });
  assert.equal(s.isEncrypted, true);
  assert.deepEqual(s.sessionState.secret, s.host.sessionKey);
  // SESSION_ESTABLISHED (host seq 1) was accepted under the restarted receive counter.
  assert.equal(s.sessionState.receiveSequence.current, 1);
  assert.equal(s.sessionState.sendSequence.current, 0, 'handshake frames are plaintext');

  s.send(0x0400, new Uint8Array([1]));
  s.send(0x0400, new Uint8Array([2]));
  assert.equal(s.sessionState.sendSequence.current, 2);

  const reason = await s.resumeSession({ timeoutMs: 2000 });
  assert.equal(reason, ProtocolReason.NONE);
  assert.equal(s.sessionState.sendSequence.current, 2, 'resume keeps the send counter');
  assert.equal(s.sessionState.receiveSequence.current, 1, 'resume keeps the receive counter');
  s.send(0x0400, new Uint8Array([3]));
  assert.equal(s.sessionState.sendSequence.current, 3);
});

test('resume: a rejected resume falls back to a handshake on a fresh transport', async () => {
  class CountingSession extends HostedSession {
    connects = 0;
    disconnects = 0;
    override async connect(): Promise<void> {
      this.connects++;
      await super.connect();
    }
    override async disconnect(): Promise<void> {
      this.disconnects++;
      await super.disconnect();
    }
  }
  const s = new CountingSession();
  await s.handshake({ timeoutMs: 2000 });
  s.host.resumeReason = ProtocolReason.SESSION_EXPIRED;
  s.host.received = [];

  const result = await s.connectWithResume({ timeoutMs: 2000 });
  assert.deepEqual(result, { resumed: false, reason: ProtocolReason.SESSION_EXPIRED });
  assert.equal(s.disconnects, 1, 'the rejected connection is dropped');
  assert.equal(s.connects, 1, 'and replaced before the handshake');
  assert.equal(s.host.received[0].header.opcode, ProtocolOpCode.SESSION_SIGNAL);
  assert.equal(s.host.received[1].header.opcode, ProtocolOpCode.SESSION_INIT);
  assert.equal(s.isEncrypted, true);
});

test('handshake: TOFU is fetched after SESSION_CHALLENGE and every handshake frame is plaintext', async () => {
  const s = new HostedSession({ allowTofu: true });
  await s.handshake({ timeoutMs: 2000 });
  const ops = s.host.received.map((p) => p.header.opcode);
  assert.deepEqual(ops, [ProtocolOpCode.SESSION_INIT, ProtocolOpCode.SYSTEM_CONTROL, ProtocolOpCode.SESSION_PROOF]);
  for (const p of s.host.received) {
    assert.equal(p.header.flags & PacketFlags.ENCRYPTED, 0);
  }
});

test('handshake: proof-of-work is solved when the host answers POW_REQUIRED', async () => {
  const s = new HostedSession();
  s.host.powDifficulty = 10;
  const result = await s.handshake({ serverPublicKey: s.host.staticKey.publicKey, timeoutMs: 5000 });
  assert.equal(result.sessionToken, s.host.token);
  assert.equal(s.host.powSolved, true);
  const ops = s.host.received.map((p) => p.header.opcode);
  assert.deepEqual(ops, [
    ProtocolOpCode.SESSION_INIT,
    ProtocolOpCode.SYSTEM_CONTROL, // POW_REQUEST
    ProtocolOpCode.POW_PROOF,
    ProtocolOpCode.SESSION_INIT,
    ProtocolOpCode.SESSION_PROOF,
  ]);
});

test('handshake: a failed handshake leaves no key installed', async () => {
  const s = new WireSession(); // nobody answers
  s.setSecret(new Uint8Array(32).fill(1));
  await assert.rejects(s.handshake({ serverPublicKey: new Uint8Array(32).fill(9), timeoutMs: 50 }));
  assert.equal(s.sessionState.secret, null);
  assert.equal(s.isEncrypted, false);
});

test('pow: solver output satisfies the difficulty and the timeout bounds it', async () => {
  const challenge = { nonce: new Uint8Array(32).fill(0xab), difficulty: 12, timestampTicks: 42n, mac: new Uint8Array(32).fill(1) };
  const solution = await solvePowChallenge(challenge);
  const proof = encodePowProof(challenge, solution);
  const puzzle = new Uint8Array(49);
  puzzle.set(proof.subarray(0, 41), 0);
  puzzle.set(proof.subarray(73, 81), 41);
  assert.ok(hasLeadingZeroBits(keccak_256(puzzle), 12));
  assert.equal(await solvePowChallenge({ ...challenge, difficulty: 0 }), 0);

  await assert.rejects(
    solvePowChallenge({ ...challenge, difficulty: 64 }, performance.now() + 20, 256),
    (e: any) => e.code === StatusCode.DEADLINE_EXCEEDED
  );
  assert.throws(() => decodePowChallenge(new Uint8Array(73)), (e: any) => e.code === StatusCode.DATA_LOSS);
});

// ---------------------------------------------------------------------------------------------
// Rekey ordering (ppn-systems/nalix#510)
// ---------------------------------------------------------------------------------------------

test('rekey: switches key and counters right after SESSION_REKEY; later frames use the new key', async () => {
  const oldKey = new Uint8Array(32).fill(0x21);
  const s = new WireSession();
  s.setSecret(oldKey);
  s.send(0x0500, new Uint8Array([1]));
  s.receive(serverFrame(0x0500, new Uint8Array([1]), oldKey, 40));
  const newKey = HandshakeX25519.deriveRekeySecret(oldKey);

  const done = s.rekey(1000);
  const req = s.lastSent();
  const oldState = new SessionState();
  oldState.secret = oldKey;
  FramePipeline.processInbound(req, oldState);
  assert.equal(req.payload[2], ControlType.SESSION_REKEY);
  assert.deepEqual(s.sessionState.secret, newKey);
  assert.equal(s.sessionState.sendSequence.current, 0);
  assert.equal(s.sessionState.receiveSequence.current, 0);

  // A frame sent before the ACK arrives already uses the new key, as the host has switched on reading the request.
  s.send(0x0500, new Uint8Array([3]));
  const beforeAck = s.lastSent();
  const newKeyState = new SessionState();
  newKeyState.secret = newKey;
  assert.equal(FramePipeline.processInboundWithSeq(beforeAck, newKeyState).seq, 1);

  // The host restarted its counters too; its frames under the new key start at 1. The ACK itself is plaintext.
  s.receive(serverFrame(0x0500, new Uint8Array([7]), newKey, 1));
  s.receive(plainFrame(ProtocolOpCode.SYSTEM_CONTROL, controlPayload(ControlType.SESSION_REKEY_ACK), req.header.sequenceId));
  await done;

  s.send(0x0500, new Uint8Array([2]));
  const next = s.lastSent();
  const newState = new SessionState();
  newState.secret = newKey;
  const { seq } = FramePipeline.processInboundWithSeq(next, newState);
  assert.equal(seq, 2, 'the counter restarted at the switch: 1 before the ACK, 2 after');
});

test('rekey: unsent request keeps the old key; lost ACK keeps the new key', async () => {
  const oldKey = new Uint8Array(32).fill(0x22);
  const s = new WireSession();
  s.setSecret(oldKey);
  s.failNextSend = true;
  await assert.rejects(s.rekey(100));
  assert.deepEqual(s.sessionState.secret, oldKey);

  await assert.rejects(s.rekey(20), (e: any) => e.code === StatusCode.DEADLINE_EXCEEDED);
  assert.deepEqual(s.sessionState.secret, HandshakeX25519.deriveRekeySecret(oldKey));
});

// ---------------------------------------------------------------------------------------------
// FAIL directives (ppn-systems/nalix#520)
// ---------------------------------------------------------------------------------------------

test('directive: encode/decode round trip uses the host layout', () => {
  const payload = encodeDirective({
    type: ControlType.FAIL,
    reason: ProtocolReason.RATE_LIMITED,
    action: ProtocolAdvice.RETRY,
    control: ControlFlags.IS_TRANSIENT,
    arg0: 0x1234,
    arg1: 7,
    arg2: 9,
  });
  assert.deepEqual(Array.from(payload), [0x11, 207, 0, 1, 1, 0x34, 0x12, 0, 0, 7, 0, 0, 0, 9, 0]);
  const d = decodeDirective(new Packet(new PacketHeader(ProtocolOpCode.SYSTEM_DIRECTIVE, PacketFlags.SYSTEM, 3, 77), payload));
  assert.equal(d.sequenceId, 77);
  assert.equal(d.reason, ProtocolReason.RATE_LIMITED);
  assert.equal(d.arg0, 0x1234);
});

test('directive: RATE_LIMITED reply fails the matching request at once', async () => {
  const s = new WireSession();
  const pending = s.request(0x0600, new Uint8Array([1]), { timeoutMs: 5000 });
  const other = s.request(0x0601, new Uint8Array([1]), { timeoutMs: 5000 });
  const seq = Packet.decode(s.sent[0]).header.sequenceId;
  const directive = encodeDirective({
    type: ControlType.FAIL,
    reason: ProtocolReason.RATE_LIMITED,
    action: ProtocolAdvice.RETRY,
    control: ControlFlags.IS_TRANSIENT,
    arg0: 0x0600,
    arg1: 0,
    arg2: 0,
  });
  // A directive naming another opcode does not touch the request.
  s.receive(plainFrame(ProtocolOpCode.SYSTEM_DIRECTIVE, encodeDirective({ ...decodeDirective(new Packet(new PacketHeader(ProtocolOpCode.SYSTEM_DIRECTIVE, 0, 0, seq), directive)), arg0: 0x0999 }), seq));
  s.receive(plainFrame(ProtocolOpCode.SYSTEM_DIRECTIVE, directive, seq));

  await assert.rejects(pending, (e: any) => {
    assert.equal(e.code, StatusCode.RESOURCE_EXHAUSTED);
    assert.equal(e.details.reason, ProtocolReason.RATE_LIMITED);
    assert.equal(e.details.advice, ProtocolAdvice.RETRY);
    assert.equal(e.details.transient, true);
    return true;
  });
  // The unrelated request is still pending.
  const otherSeq = Packet.decode(s.sent[1]).header.sequenceId;
  s.receive(plainFrame(0x0601, new Uint8Array([9]), otherSeq));
  assert.equal((await other).payload[0], 9);
});

// ---------------------------------------------------------------------------------------------
// WebSocket close / shutdown
// ---------------------------------------------------------------------------------------------

class FakeWs {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static all: FakeWs[] = [];
  static autoAnswerClose = true;
  readyState = FakeWs.CONNECTING;
  binaryType = 'blob';
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: ArrayBuffer }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onclose: ((ev: any) => void) | null = null;
  sent: Uint8Array[] = [];
  closeCalls: Array<{ code?: number; reason?: string }> = [];

  constructor(public url: string) {
    FakeWs.all.push(this);
    setTimeout(() => {
      this.readyState = FakeWs.OPEN;
      this.onopen?.({});
    }, 0);
  }
  send(b: Uint8Array) {
    this.sent.push(new Uint8Array(b));
  }
  close(code?: number, reason?: string) {
    this.closeCalls.push({ code, reason });
    this.readyState = FakeWs.CLOSING;
    if (FakeWs.autoAnswerClose) {
      setTimeout(() => this.serverClose(code ?? 1005, reason ?? '', true), 5);
    }
  }
  /** The peer's close frame arrives (or the connection drops). */
  serverClose(code: number, reason: string, wasClean = true) {
    this.readyState = FakeWs.CLOSED;
    this.onclose?.({ code, reason, wasClean });
  }
  deliver(bytes: Uint8Array) {
    this.onmessage?.({ data: bytes.slice().buffer });
  }
}

function withFakeWs(run: () => Promise<void>): () => Promise<void> {
  return async () => {
    const original = (globalThis as any).WebSocket;
    (globalThis as any).WebSocket = FakeWs;
    FakeWs.all = [];
    FakeWs.autoAnswerClose = true;
    try {
      await run();
    } finally {
      (globalThis as any).WebSocket = original;
    }
  };
}

test('close: status mapping for host close codes', () => {
  const shutdown = closeToStatus({ code: 1001, reason: 'Server shutting down', wasClean: true, initiatedByClient: false });
  assert.equal(shutdown.code, StatusCode.UNAVAILABLE);
  assert.equal(shutdown.details?.reason, ProtocolReason.SERVER_SHUTDOWN);
  assert.equal(shutdown.details?.closeCode, 1001);
  assert.match(shutdown.message, /1001: Server shutting down/);
  assert.equal(closeToStatus({ code: 1009, reason: '', wasClean: true, initiatedByClient: false }).code, StatusCode.RESOURCE_EXHAUSTED);
  assert.equal(closeToStatus({ code: 1000, reason: '', wasClean: true, initiatedByClient: false }).details?.reason, ProtocolReason.REMOTE_CLOSED);
});

test(
  'close: a host shutdown (1001) fails in-flight requests with the close status',
  withFakeWs(async () => {
    const session = new WebSocketSession({ url: 'ws://fake.invalid/ws', autoReconnect: false });
    await session.connect();
    const ws = FakeWs.all[0];
    const pending = session.request(0x0700, new Uint8Array([1]), { timeoutMs: 5000 });
    await tick();
    ws.serverClose(1001, 'Server shutting down');
    await assert.rejects(pending, (e: any) => {
      assert.equal(e.code, StatusCode.UNAVAILABLE);
      assert.equal(e.details.closeCode, 1001);
      assert.equal(e.details.reason, ProtocolReason.SERVER_SHUTDOWN);
      return true;
    });
    assert.equal(session.state, ConnectivityState.TRANSIENT_FAILURE);
    assert.deepEqual(session.lastClose, { code: 1001, reason: 'Server shutting down', wasClean: true, initiatedByClient: false });
  })
);

test(
  'close: disconnect() sends 1000 and waits for the peer close frame',
  withFakeWs(async () => {
    const session = new WebSocketSession({ url: 'ws://fake.invalid/ws', autoReconnect: false });
    await session.connect();
    const ws = FakeWs.all[0];
    const started = performance.now();
    const done = session.disconnect();
    assert.equal(session.state, ConnectivityState.SHUTDOWN, 'SHUTDOWN is immediate');
    let resolved = false;
    done.then(() => (resolved = true));
    await tick();
    assert.equal(resolved, false, 'still waiting for the peer close frame');
    await done;
    assert.ok(performance.now() - started < 1000);
    assert.deepEqual(ws.closeCalls, [{ code: 1000, reason: 'Client disconnected' }]);
    assert.equal(session.lastClose?.initiatedByClient, true);
  })
);

test(
  'close: disconnect() gives up on a silent peer after the closing-handshake bound',
  withFakeWs(async () => {
    FakeWs.autoAnswerClose = false;
    const session = new WebSocketSession({ url: 'ws://fake.invalid/ws', autoReconnect: false });
    await session.connect();
    const started = performance.now();
    await session.disconnect();
    const waited = performance.now() - started;
    assert.ok(waited >= 1900 && waited < 3000, `waited ${waited}ms`);
  })
);

test(
  'reconnect: an authenticated session resumes after the transport comes back',
  withFakeWs(async () => {
    const key = new Uint8Array(32).fill(0x31);
    const session = new WebSocketSession({
      url: 'ws://fake.invalid/ws',
      autoReconnect: true,
      reconnectIntervalMs: 5,
      maxReconnectAttempts: 3,
    });
    await session.connect();
    session.setSecret(key);
    session.sessionState.sessionToken = 42n;
    session.sessionState.sendSequence.reset(10);

    FakeWs.all[0].serverClose(1006, '', false);
    // Wait for the second socket and answer its resume request.
    for (let i = 0; i < 200 && FakeWs.all.length < 2; i++) await new Promise((r) => setTimeout(r, 5));
    const ws2 = FakeWs.all[1];
    for (let i = 0; i < 200 && ws2.sent.length === 0; i++) await new Promise((r) => setTimeout(r, 5));
    const resumeReq = Packet.decode(ws2.sent[0]);
    assert.equal(resumeReq.header.opcode, ProtocolOpCode.SESSION_SIGNAL);
    assert.equal(resumeReq.payload[0], SessionResumeStage.REQUEST);
    ws2.deliver(
      plainFrame(
        ProtocolOpCode.SESSION_SIGNAL,
        encodeResumePayload(SessionResumeStage.RESPONSE, 42n, ProtocolReason.NONE, computeResumeProof(key, 42n)),
        resumeReq.header.sequenceId
      )
    );
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(session.isConnected, true);
    assert.equal(session.isEncrypted, true);
    session.send(0x0800, new Uint8Array([1]));
    const { seq } = FramePipeline.processInboundWithSeq(Packet.decode(ws2.sent[1]), session.sessionState);
    assert.equal(seq, 11, 'the send counter continues across reconnect + resume');
    await session.disconnect();
  })
);

test(
  'reconnect: disconnect() during the reconnect backoff stops it',
  withFakeWs(async () => {
    const session = new WebSocketSession({
      url: 'ws://fake.invalid/ws',
      autoReconnect: true,
      reconnectIntervalMs: 30,
      maxReconnectAttempts: 3,
    });
    await session.connect();
    FakeWs.all[0].serverClose(1006, '', false);
    await session.disconnect();
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(FakeWs.all.length, 1, 'no new socket after disconnect()');
    assert.equal(session.state, ConnectivityState.SHUTDOWN);
  })
);
