import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  WebSocketSession,
  Packet,
  PacketHeader,
  ConnectivityState,
  ProtocolOpCode,
} from '../src/index.js';

test('Live WebSocket session to atmosos.eyc.asia:443 with ergonomic APIs', async () => {
  // Construct WebSocketSession directly from URL string
  const session = new WebSocketSession('wss://atmosos.eyc.asia/ws/');
  assert.equal(session.state, ConnectivityState.IDLE);

  // Register state change listener
  const states: ConnectivityState[] = [];
  const stateSub = session.onStateChange((s) => states.push(s));

  // Connect live
  await session.connect();
  assert.equal(session.isConnected, true);
  assert.equal(session.state, ConnectivityState.READY);

  // Register an OpCode subscription (matching C# session.On<T>)
  let receivedSessionSignal = false;
  const sub = session.on(ProtocolOpCode.SESSION_SIGNAL, (_packet) => {
    receivedSessionSignal = true;
  });

  // Shorthand send with random 64-byte payload (SessionInit)
  const payload = new Uint8Array(64);
  crypto.getRandomValues(payload);

  const seqId = session.send(ProtocolOpCode.SESSION_INIT, payload, {
    flags: 0x04,
    priority: 0x03,
  });
  assert.ok(seqId > 0, 'SequenceId should be auto-assigned');

  // Unsubscribe listener
  sub.unsubscribe();
  stateSub.unsubscribe();

  // Clean close
  session.close();
  assert.equal(session.state, ConnectivityState.SHUTDOWN);
  assert.equal(session.isConnected, false);
});
