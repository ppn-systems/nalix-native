import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChannelConfig, NalixClient, Packet, PacketHeader, ConnectivityState } from '../src/index.js';

test('Live WebSocket connection to atmosos.eyc.asia:443', async () => {
  const config = new ChannelConfig({
    host: 'atmosos.eyc.asia',
    port: 443,
    path: '/ws/',
    useTls: true,
    subprotocol: 'nalix.v1',
    connectTimeoutMs: 10000,
  });

  const client = new NalixClient(config);
  assert.equal(client.state, ConnectivityState.IDLE);

  // Connect live
  await client.connect();
  assert.equal(client.isConnected, true);
  assert.equal(client.state, ConnectivityState.READY);

  // Send binary SessionInit packet (OpCode: 0x0000, Flags: 0x04, Priority: 0x03, Sequence: 0x0000, 64-byte payload)
  const header = new PacketHeader(0x0000, 0x04, 0x03, 0x0000);
  const payload = new Uint8Array(64);
  crypto.getRandomValues(payload);

  const initPacket = new Packet(header, payload);
  client.send(initPacket);

  // Clean disconnect
  client.disconnect();
  assert.equal(client.state, ConnectivityState.SHUTDOWN);
  assert.equal(client.isConnected, false);
});
