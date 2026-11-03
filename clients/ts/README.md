# Nalix Native TypeScript / Web Client SDK

The Nalix TypeScript Client SDK (`@ppn/nalix-client`) provides a zero-runtime-dependency binary client for modern web browsers, Node.js (22+), Next.js, Vite, Deno, and Bun runtimes.

It is designed with the exact same architectural patterns and naming as the Nalix C# SDK (`Nalix.SDK`), centering around transport sessions (`WebSocketSession`), correlated request/response calls, event subscriptions, automatic reconnection, and connection health monitoring.

---

## Features

- **Direct Web & Browser Support:** Runs natively in all modern browsers (`window.WebSocket`, `ArrayBuffer`, `DataView`).
- **Zero Runtime Dependencies:** Built strictly on standard Web APIs without polyfills or external shims.
- **WebSocketSession Architecture:** Directly mirrors C# `WebSocketSession` and `TransportSession`.
- **Correlated Request / Response:** Promise-based `session.request()` that correlates sequence IDs and handles timeouts, matching C# `session.RequestAsync<T>()`.
- **Event Subscriptions:** Opcode-based event subscriptions (`session.on()`, `session.once()`) with unsubscribe tokens, matching C# `session.On<T>()`.
- **Packet Helpers:** Fluent factories (`Packet.create()`, `Packet.fromJson()`, `packet.text()`, `packet.json()`).
- **Resilient Lifecycle:** 5-state connectivity machine (`IDLE`, `CONNECTING`, `READY`, `TRANSIENT_FAILURE`, `SHUTDOWN`) with auto-reconnection and backoff.
- **Ping / RTT Estimation:** Built-in `session.ping()` matching C# `session.PingAsync()`.

---

## Installation

```bash
npm install @ppn/nalix-client
```

---

## Usage Examples

### 1. Initialize and Connect

```typescript
import { WebSocketSession } from '@ppn/nalix-client';

// Simple URL connection with auto-reconnect enabled (matching C# WebSocketSession)
const session = new WebSocketSession({
  url: 'wss://atmosos.eyc.asia/ws/',
  autoReconnect: true,
  heartbeatIntervalMs: 30000,
});

await session.connect();
console.log('Connected! State:', session.state);
```

### 2. Correlated Request / Response (Like C# `RequestAsync`)

Send a request packet and await the corresponding response without manual sequence correlation or queue filtering:

```typescript
// Send JSON request and await reply with 5-second timeout
const response = await session.request(0x0100, JSON.stringify({ userId: 1001 }), {
  timeoutMs: 5000,
});

console.log('Received response:', response.json());
```

### 3. Event Subscriptions (Like C# `session.On<T>`)

Listen for incoming server notifications or broadcast packets:

```typescript
// Subscribe to incoming packets with OpCode 0x0200
const sub = session.on(0x0200, (packet) => {
  console.log('Push notification text:', packet.text());
});

// To stop listening later:
sub.unsubscribe();
```

### 4. Fire-and-Forget Send

```typescript
// Send binary or string payload with auto-assigned sequence ID
const sequenceId = session.send(0x0300, 'telemetry event');
console.log('Sent packet with sequence ID:', sequenceId);
```

### 5. Latency & Ping (Like C# `PingAsync`)

```typescript
// Measure network round-trip time in milliseconds
const rttMs = await session.ping();
console.log(`Latency: ${rttMs} ms`);
```

### 6. Clean Disconnect

```typescript
session.close();
```

---

## Low-Level Packet Framing

For embedded or low-level binary protocols, you can construct and decode raw `Packet` and `PacketHeader` instances directly:

```typescript
import { Packet, PacketHeader } from '@ppn/nalix-client';

// 6-byte header: OpCode=0x0001, Flags=0x04, Priority=0x02, SequenceId=1
const header = new PacketHeader(0x0001, 0x04, 0x02, 1);
const payload = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
const packet = new Packet(header, payload);

const bytes = packet.encode();
const decoded = Packet.decode(bytes);
```

---

## Verification & Testing

```bash
cd clients/ts
npm test
```
