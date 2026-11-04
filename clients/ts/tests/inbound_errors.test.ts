import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocketSession } from '../src/session.js';
import { Packet, PacketFlags, PacketHeader } from '../src/packet.js';
import { FrameCompression } from '../src/compression.js';
import { NalixStatus, StatusCode } from '../src/status.js';

/** Minimal WebSocket stand-in: opens on the next tick and records outbound frames. */
class FakeWebSocket {
  static last: FakeWebSocket | null = null;
  binaryType = 'blob';
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: ArrayBuffer }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  readonly sent: Uint8Array[] = [];

  constructor(public readonly url: string) {
    FakeWebSocket.last = this;
    setTimeout(() => this.onopen?.({}), 0);
  }

  send(bytes: Uint8Array): void {
    this.sent.push(new Uint8Array(bytes));
  }

  close(): void {}

  /** Delivers a frame as the server would. */
  deliver(bytes: Uint8Array): void {
    this.onmessage?.({ data: bytes.slice().buffer });
  }
}

function withFakeWebSocket(run: () => Promise<void>): () => Promise<void> {
  return async () => {
    const original = (globalThis as any).WebSocket;
    (globalThis as any).WebSocket = FakeWebSocket;
    try {
      await run();
    } finally {
      (globalThis as any).WebSocket = original;
    }
  };
}

async function openSession(): Promise<{ session: WebSocketSession; ws: FakeWebSocket }> {
  const session = new WebSocketSession({
    url: 'ws://fake.invalid/ws',
    heartbeatIntervalMs: 0,
    autoReconnect: false,
  });
  await session.connect();
  return { session, ws: FakeWebSocket.last! };
}

/** Sends a request and returns the sequence ID the server must echo. */
async function sendRequest(session: WebSocketSession, ws: FakeWebSocket, opcode: number, timeoutMs = 2000) {
  const pending = session.request(opcode, new Uint8Array([1, 2, 3]), { timeoutMs });
  await new Promise((resolve) => setImmediate(resolve)); // let the request reach the socket
  const seq = Packet.decode(ws.sent[ws.sent.length - 1]).header.sequenceId;
  return { pending, seq };
}

test(
  'inbound decompress failure rejects the matching request with DATA_LOSS and emits onError',
  withFakeWebSocket(async () => {
    const { session, ws } = await openSession();
    const seen: NalixStatus[] = [];
    session.onError((err) => seen.push(err));

    const { pending, seq } = await sendRequest(session, ws, 0x1234);

    // COMPRESSED reply whose CompressedLength (20) does not match its 12 bytes.
    const corrupt = new Packet(
      new PacketHeader(0x1234, PacketFlags.COMPRESSED, 0, seq),
      Uint8Array.from([100, 0, 0, 0, 20, 0, 0, 0, 1, 2, 3, 4])
    );
    ws.deliver(corrupt.encode());

    await assert.rejects(pending, (err: unknown) => err instanceof NalixStatus && err.code === StatusCode.DATA_LOSS);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].code, StatusCode.DATA_LOSS);
    session.close();
  })
);

test(
  'a valid compressed reply still resolves the request with the decompressed payload',
  withFakeWebSocket(async () => {
    const { session, ws } = await openSession();
    const { pending, seq } = await sendRequest(session, ws, 0x2222);

    const text = new Uint8Array(4096);
    for (let i = 0; i < text.length; i++) text[i] = 'abcdefgh'.charCodeAt(i % 8);
    const frame = FrameCompression.compress(text);
    assert.ok(frame !== null);
    ws.deliver(new Packet(new PacketHeader(0x2222, PacketFlags.COMPRESSED, 0, seq), frame).encode());

    const reply = await pending;
    assert.deepEqual(reply.payload, text);
    assert.equal(reply.header.flags & PacketFlags.COMPRESSED, 0);
    session.close();
  })
);

test(
  'an undecodable frame with no matching request is reported via onError and does not throw',
  withFakeWebSocket(async () => {
    const { session, ws } = await openSession();
    const seen: NalixStatus[] = [];
    session.onError((err) => seen.push(err));

    assert.doesNotThrow(() => ws.deliver(new Uint8Array([1, 2, 3])));
    assert.equal(seen.length, 1);
    assert.ok(seen[0] instanceof NalixStatus);
    session.close();
  })
);
