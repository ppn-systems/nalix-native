import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SubscriptionManager,
  PendingRequestManager,
  ReconnectSupervisor,
  TransportSession,
  WebSocketSession,
  ITransportSession,
  Packet,
  PacketHeader,
  ChannelConfig,
  ConnectivityState,
  NalixStatus,
  StatusCode,
} from '../src/index.js';

test('SubscriptionManager isolates event dispatching (SRP)', () => {
  const sm = new SubscriptionManager();
  const receivedPackets: Packet[] = [];
  const receivedOpcodePackets: Packet[] = [];
  const receivedStates: ConnectivityState[] = [];

  const subGlobal = sm.subscribePacket((p) => receivedPackets.push(p));
  const subOpcode = sm.subscribeOpcode(0x0100, (p) => receivedOpcodePackets.push(p));
  const subState = sm.subscribeState((s) => receivedStates.push(s));

  const packet1 = new Packet(new PacketHeader(0x0100, 0, 0, 1), new Uint8Array([1, 2, 3]));
  const packet2 = new Packet(new PacketHeader(0x0200, 0, 0, 2), new Uint8Array([4, 5, 6]));

  sm.dispatchPacket(packet1);
  sm.dispatchPacket(packet2);
  sm.dispatchState(ConnectivityState.READY);

  assert.equal(receivedPackets.length, 2);
  assert.equal(receivedOpcodePackets.length, 1);
  assert.equal(receivedStates.length, 1);
  assert.equal(receivedStates[0], ConnectivityState.READY);

  // Test unsubscribe
  subOpcode.unsubscribe();
  sm.dispatchPacket(packet1);
  assert.equal(receivedOpcodePackets.length, 1, 'Should not receive after unsubscribe');

  subGlobal.unsubscribe();
  subState.unsubscribe();
});

test('PendingRequestManager handles correlated request timeouts and resolution (SRP)', async () => {
  const pm = new PendingRequestManager();
  assert.equal(pm.count, 0);

  // Register a request with 500ms timeout
  const promise = pm.register(42, 0x0100, 500);
  assert.equal(pm.count, 1);

  // Incoming response matching seq 42
  const response = new Packet(new PacketHeader(0x0101, 0, 0, 42), new Uint8Array([0xaa]));
  const matched = pm.tryResolve(response);
  assert.equal(matched, true);
  assert.equal(pm.count, 0);

  const resolved = await promise;
  assert.equal(resolved.header.sequenceId, 42);
  assert.equal(resolved.payload[0], 0xaa);

  // Test drain on disconnect
  const promise2 = pm.register(99, 0x0100, 5000);
  assert.equal(pm.count, 1);
  pm.drain(new NalixStatus(StatusCode.UNAVAILABLE, 'Connection lost'));
  assert.equal(pm.count, 0);

  await assert.rejects(promise2, (err: any) => {
    return err instanceof NalixStatus && err.code === StatusCode.UNAVAILABLE;
  });
});

test('ReconnectSupervisor enforces backoff and attempt limits (SRP)', () => {
  let reconnectCalls = 0;
  const supervisor = new ReconnectSupervisor(
    async () => {
      reconnectCalls++;
    },
    2, // max attempts: 2
    50 // interval: 50ms
  );

  assert.equal(supervisor.attempts, 0);
  assert.equal(supervisor.isScheduled, false);

  // Attempt 1
  assert.equal(supervisor.schedule(), true);
  assert.equal(supervisor.attempts, 1);
  assert.equal(supervisor.isScheduled, true);

  // Already scheduled: should return false
  assert.equal(supervisor.schedule(), false);

  supervisor.cancel();
  assert.equal(supervisor.isScheduled, false);

  // Reset
  supervisor.reset();
  assert.equal(supervisor.attempts, 0);
});

test('WebSocketSession implements ITransportSession polymorphically (LSP/OCP)', () => {
  const session: ITransportSession = new WebSocketSession('wss://localhost:8080/ws/');
  assert.equal(session.state, ConnectivityState.IDLE);
  assert.equal(session.isConnected, false);
  assert.ok(session instanceof TransportSession);
  assert.ok(session instanceof WebSocketSession);
});
