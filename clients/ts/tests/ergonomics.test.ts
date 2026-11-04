import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Packet,
  PacketHeader,
  NalixClient,
  TransportSession,
  ChannelConfig,
} from '../src/index.js';

class MockErgonomicSession extends TransportSession {
  public sentFrames: Packet[] = [];
  public get isConnected(): boolean {
    return true;
  }
  public async connect(): Promise<void> {}
  public async disconnect(): Promise<void> {}
  public close(): void {}

  protected sendRawFrame(bytes: Uint8Array): void {
    this.sentFrames.push(Packet.decode(bytes));
  }

  public simulateInbound(packet: Packet): void {
    this.dispatchInboundPacket(packet);
  }
}

test('Ergonomics: Packet property accessors and automatic JSON serialization', () => {
  // 1. Direct object passed to Packet.create automatically serializes to JSON
  const payloadObj = { username: 'nalix_user', role: 'admin', tags: ['fast', 'secure'] };
  const packet = Packet.create(0x0700, payloadObj, { flags: 0x80, sequenceId: 10 });

  assert.equal(packet.opcode, 0x0700);
  assert.equal(packet.sequenceId, 10);
  assert.equal(packet.flags, 0x80);
  assert.equal(packet.priority, 0);

  // Property setters work directly on packet
  packet.opcode = 0x0701;
  packet.sequenceId = 20;
  assert.equal(packet.header.opcode, 0x0701);
  assert.equal(packet.header.sequenceId, 20);

  // Deserializing via .json()
  const parsed = packet.json<typeof payloadObj>();
  assert.deepEqual(parsed, payloadObj);
});

test('Ergonomics: session.sendJson and session.onJson typed dispatching', () => {
  const session = new MockErgonomicSession(new ChannelConfig('wss://mock.nalix.dev'));

  interface ChatMessage {
    from: string;
    text: string;
  }

  let receivedMsg: ChatMessage | null = null;
  let receivedPkt: Packet | null = null;

  // 1. Register typed JSON listener
  session.onJson<ChatMessage>(0x0800, (data, pkt) => {
    receivedMsg = data;
    receivedPkt = pkt;
  });

  // 2. Simulate inbound packet carrying JSON
  const incoming = Packet.create(0x0800, { from: 'Alice', text: 'Hello Nalix!' });
  session.simulateInbound(incoming);

  assert.ok(receivedMsg !== null);
  assert.ok(receivedPkt !== null);
  assert.equal((receivedMsg as any).from, 'Alice');
  assert.equal((receivedMsg as any).text, 'Hello Nalix!');
  assert.equal((receivedPkt as any).opcode, 0x0800);

  // 3. Shorthand sendJson
  const seq = session.sendJson(0x0801, { status: 'ok' });
  assert.ok(seq > 0);
  assert.equal(session.sentFrames.length, 1);
  assert.deepEqual(session.sentFrames[0].json(), { status: 'ok' });
});

test('Ergonomics: session.requestJson simplifies correlated Request-Response', async () => {
  const session = new MockErgonomicSession(new ChannelConfig('wss://mock.nalix.dev'));

  interface UserQuery {
    userId: number;
  }
  interface UserProfile {
    id: number;
    name: string;
  }

  const requestPromise = session.requestJson<UserProfile, UserQuery>(0x0900, { userId: 42 });

  // Awaiter registered, outbound frame sent
  assert.equal(session.sentFrames.length, 1);
  const sent = session.sentFrames[0];
  assert.deepEqual(sent.json(), { userId: 42 });

  // Simulate server response matching sequenceId
  const responsePacket = Packet.create(0x0901, { id: 42, name: 'Bob' }, { sequenceId: sent.sequenceId });
  session.simulateInbound(responsePacket);

  const profile = await requestPromise;
  assert.equal(profile.id, 42);
  assert.equal(profile.name, 'Bob');
});

test('Ergonomics: NalixClient alias is exported and accessible', () => {
  assert.ok(typeof NalixClient === 'function');
  const client = new NalixClient('wss://mock.nalix.dev');
  assert.ok(client instanceof NalixClient);
});
