import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  WebSocketSession,
  ConnectivityState,
  ProtocolOpCode,
} from '../src/index.js';

test('Live WebSocket session to atmosos.eyc.asia:443 with handshake, ping, and timesync', async (t) => {
  const session = new WebSocketSession('wss://atmosos.eyc.asia/ws/');
  assert.equal(session.state, ConnectivityState.IDLE);

  const states: ConnectivityState[] = [];
  const stateSub = session.onStateChange((s) => states.push(s));

  try {
    await session.connect();
  } catch (err) {
    stateSub.unsubscribe();
    t.skip(`Live server atmosos.eyc.asia:443 unreachable: ${(err as Error).message}`);
    return;
  }

  assert.equal(session.isConnected, true);
  assert.equal(session.state, ConnectivityState.READY);

  // 1. Perform full TOFU Handshake
  const hsResult = await session.handshake();
  assert.ok(hsResult.sessionToken > 0n, 'Handshake should produce a valid session token');
  assert.equal(hsResult.serverStaticKey.length, 32, 'Server static identity key must be 32 bytes');
  assert.equal(session.isEncrypted, true, 'Session should be encrypted after handshake');

  // 2. Perform Timesync Ping
  const pingRtt = await session.ping(5000);
  assert.ok(pingRtt >= 0, `Ping RTT should be non-negative: ${pingRtt}ms`);

  // 3. Perform Clock Synchronization
  const sync = await session.syncTime(5000);
  assert.ok(sync.rttMs >= 0, `SyncTime RTT should be non-negative: ${sync.rttMs}ms`);
  assert.ok(typeof sync.offsetMs === 'number', 'SyncTime offset should be a number');

  // 4. Clean shutdown
  stateSub.unsubscribe();
  session.close();
  assert.equal(session.state, ConnectivityState.SHUTDOWN);
  assert.equal(session.isConnected, false);
});
