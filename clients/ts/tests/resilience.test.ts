import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PendingRequestManager,
  SubscriptionManager,
  ReconnectSupervisor,
  ChannelConfigOptions,
  Packet,
  PacketHeader,
  StatusCode,
  NalixStatus,
  TransportSession,
  ConnectivityState,
} from '../src/index.js';

class MockTransportSession extends TransportSession {
  public outboundRaw: Uint8Array[] = [];
  private _connected = true;

  constructor(config?: Partial<ChannelConfigOptions>) {
    super({ url: 'wss://mock.nalix.dev', ...config } as any);
    this._state = ConnectivityState.READY;
  }

  public get isConnected(): boolean {
    return this._connected;
  }

  public async connect(): Promise<void> {
    this._connected = true;
    this.setState(ConnectivityState.READY);
  }

  public async disconnect(): Promise<void> {
    this._connected = false;
    this.setState(ConnectivityState.IDLE);
    this._pendingRequests.drain(new NalixStatus(StatusCode.UNAVAILABLE, 'Transport disconnected'));
  }

  public close(): void {
    this._connected = false;
    this.setState(ConnectivityState.SHUTDOWN);
    this._pendingRequests.drain(new NalixStatus(StatusCode.CANCELLED, 'Session closed'));
    this._subscriptions.clear();
  }

  protected sendRawFrame(bytes: Uint8Array): void {
    this.outboundRaw.push(bytes);
  }

  public simulateInbound(packet: Packet): void {
    this.dispatchInboundPacket(packet);
  }
}

test('Resilience: Draining pending requests on abrupt disconnection', async () => {
  const session = new MockTransportSession();
  
  // Start two pending requests
  const p1 = session.request(0x0200, new Uint8Array([1]));
  const p2 = session.request(0x0201, new Uint8Array([2]));

  // Simulate abrupt disconnect
  await session.disconnect();

  await assert.rejects(p1, (err: unknown) => {
    assert.ok(err instanceof NalixStatus);
    assert.equal(err.code, StatusCode.UNAVAILABLE);
    return true;
  });

  await assert.rejects(p2, (err: unknown) => {
    assert.ok(err instanceof NalixStatus);
    assert.equal(err.code, StatusCode.UNAVAILABLE);
    return true;
  });
});

test('Resilience: Single request cancellation isolates from other pending requests', async () => {
  const pendingMgr = new PendingRequestManager();
  
  const p1 = pendingMgr.register(1, 0x0200, 1000);
  const p2 = pendingMgr.register(2, 0x0201, 1000);

  // Cancel only req 1
  const cancelled = pendingMgr.cancel(1, new NalixStatus(StatusCode.CANCELLED, 'User cancelled req1'));
  assert.equal(cancelled, true);

  await assert.rejects(p1, (err: unknown) => {
    assert.ok(err instanceof NalixStatus);
    assert.equal(err.code, StatusCode.CANCELLED);
    return true;
  });

  // req 2 should still be unresolved and can resolve normally
  const respPacket = new Packet(new PacketHeader(0x0201, 0, 0, 2), new Uint8Array([99]));
  const resolved = pendingMgr.tryResolve(respPacket);
  assert.equal(resolved, true);

  const result = await p2;
  assert.equal(result.header.sequenceId, 2);
  assert.deepEqual(result.payload, new Uint8Array([99]));
});

test('Resilience: Request timeout fires when deadline is exceeded', async () => {
  const pendingMgr = new PendingRequestManager();
  const reqPromise = pendingMgr.register(42, 0x0100, 50); // 50ms timeout

  await assert.rejects(reqPromise, (err: unknown) => {
    assert.ok(err instanceof NalixStatus);
    assert.equal(err.code, StatusCode.DEADLINE_EXCEEDED);
    return true;
  });
});

test('Resilience: Concurrent requests resolve out-of-order under high concurrency', async () => {
  const session = new MockTransportSession();
  const count = 50;
  const promises: Promise<Packet>[] = [];

  for (let i = 0; i < count; i++) {
    promises.push(session.request(0x0300, new Uint8Array([i])));
  }

  assert.equal(session.outboundRaw.length, count);

  // Parse out the sequenceIds from the sent raw frames (LE offset 4..5)
  const sentSeqIds: number[] = session.outboundRaw.map((raw) => {
    const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    return view.getUint16(4, true);
  });

  // Simulate server responding in reverse order
  for (let i = count - 1; i >= 0; i--) {
    const resp = new Packet(
      new PacketHeader(0x0301, 0, 0, sentSeqIds[i]),
      new Uint8Array([i * 2])
    );
    session.simulateInbound(resp);
  }

  const results = await Promise.all(promises);
  assert.equal(results.length, count);
  for (let i = 0; i < count; i++) {
    assert.deepEqual(results[i].payload, new Uint8Array([i * 2]));
  }
});

test('Resilience: Subscription unregistering prevents memory leaks and stale execution', () => {
  const mgr = new SubscriptionManager();
  let callCount = 0;

  const sub = mgr.subscribeOpcode(0x0400, () => {
    callCount++;
  });

  const packet = new Packet(new PacketHeader(0x0400, 0, 0, 1), new Uint8Array([0]));
  mgr.dispatchPacket(packet);
  assert.equal(callCount, 1);

  // Unregister
  sub.unsubscribe();
  mgr.dispatchPacket(packet);
  assert.equal(callCount, 1, 'Callback should not be called after unsubscribe');
});

test('Resilience: ReconnectSupervisor schedules exponential backoff and caps retries', () => {
  let reconnectCount = 0;
  const supervisor = new ReconnectSupervisor(
    async () => {
      reconnectCount++;
    },
    2, // max attempts
    50 // interval
  );

  assert.equal(supervisor.attempts, 0);
  assert.equal(supervisor.isScheduled, false);

  // Attempt 1
  assert.equal(supervisor.schedule(), true);
  assert.equal(supervisor.attempts, 1);
  assert.equal(supervisor.isScheduled, true);

  // Already scheduled
  assert.equal(supervisor.schedule(), false);

  // Simulate timer completing (clearing internal timer)
  (supervisor as any)._timer = null;

  // Attempt 2
  assert.equal(supervisor.schedule(), true);
  assert.equal(supervisor.attempts, 2);
  (supervisor as any)._timer = null;

  // Attempt 3 exceeds max attempts (2)
  assert.equal(supervisor.schedule(), false);

  // Cancel disables further scheduling
  supervisor.cancel();
  assert.equal(supervisor.schedule(), false);

  // Reset allows scheduling again
  supervisor.reset();
  assert.equal(supervisor.attempts, 0);
  assert.equal(supervisor.schedule(), true);
  supervisor.cancel();
});
