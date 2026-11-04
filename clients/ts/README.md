# Nalix Native TypeScript SDK

The Nalix TypeScript SDK (`@ppnsys/nalix-sdk`) provides a high-performance binary transport SDK for modern web browsers, Node.js (22+), Next.js, Vite, Deno, and Bun runtimes.

Directly aligns in naming and architecture with the Nalix C# SDK (`Nalix.SDK`), centering around transport sessions (`NalixClient` / `WebSocketSession`), correlated request/response calls, typed event subscriptions, automatic reconnection, X25519 TOFU handshake, AES-ready ChaCha20-Poly1305 encryption, LZ4 compression, mid-session Rekey, and HMAC-Keccak256 Session Resumption (`SESSION_SIGNAL`).

---

## Features

- **Direct Web & Browser Support:** Runs natively in all modern browsers (`window.WebSocket`, `ArrayBuffer`, `DataView`).
- **Nalix SDK Parity:** Directly mirrors C# `Nalix.SDK.Transport` (`WebSocketSession`, `ITransportSession`).
- **Zero-Boilerplate Ergonomics:**
  - `NalixClient.connect(url)` for 1-line connection and authenticated handshake / resume.
  - `client.requestJson<T>(opcode, payload)` for typed request-response without manual serialization.
  - `client.onJson<T>(opcode, handler)` for typed push notification listeners.
  - Direct packet properties: `packet.opcode`, `packet.sequenceId`, `packet.flags`, `packet.priority`.
- **End-to-End Cryptography:** X25519 Diffie-Hellman authenticated handshake with TOFU (Trust-On-First-Use) or pinned static keys, ChaCha20-Poly1305 AEAD framing, and mid-session Rekey key rotation.
- **Session Resumption:** Instant reconnect via 43-byte `SESSION_SIGNAL` and sliding time-window HMAC-Keccak256 proofs with automatic handshake fallback.
- **Microsecond Clock Synchronization:** `session.syncTime()` and `session.ping()` based on 17-byte `SYSTEM_TIMESYNC` framing.
- **High-Performance LZ4:** Adaptive compression for outbound payloads exceeding the configurable threshold.

---

## Installation

```bash
npm install @ppnsys/nalix-sdk
```

---

## Quick Start Examples

### 1. Connect and Authenticate in One Line

```typescript
import { NalixClient } from '@ppnsys/nalix-sdk';

// Automatically connects and establishes a secure authenticated session (or resumes previous session)
const client = await NalixClient.connect('wss://atmosos.eyc.asia/ws/');
console.log('Connected & Encrypted! Token:', client.sessionState.sessionToken);
```

### 2. Typed Correlated Request / Response

Send an object and await the correlated response without manual sequence tracking:

```typescript
interface UserProfile {
  id: number;
  name: string;
  role: string;
}

// Automatically serializes request to JSON, matches sequence ID, and parses response JSON
const profile = await client.requestJson<UserProfile>(0x0200, { userId: 42 });
console.log(`Hello, ${profile.name} (${profile.role})`);
```

### 3. Typed Event Subscriptions

Listen for incoming server notifications or broadcast packets:

```typescript
interface ChatMessage {
  from: string;
  text: string;
}

// Subscribe to incoming packets with OpCode 0x0300
const sub = client.onJson<ChatMessage>(0x0300, (msg, packet) => {
  console.log(`[${msg.from}]: ${msg.text} (seq: ${packet.sequenceId})`);
});

// To stop listening later:
sub.unsubscribe();
```

### 4. Fire-and-Forget Send

```typescript
// Send binary, string, or JSON payload
const seq = client.sendJson(0x0400, { status: 'ONLINE', timestamp: Date.now() });
```

### 5. Latency & Time Synchronization

```typescript
// Measure network RTT via SYSTEM_TIMESYNC
const rttMs = await client.ping();
console.log(`RTT: ${rttMs.toFixed(2)} ms`);

// Synchronize clocks with remote server
const { rttMs: syncRtt, offsetMs } = await client.syncTime();
console.log(`Server offset: ${offsetMs.toFixed(2)} ms`);
```

### 6. Session Resume & Graceful Disconnect

```typescript
// Graceful disconnect with protocol reason
await client.disconnectGracefully();

// Reconnect with session resumption:
const { resumed } = await client.connectWithResume();
console.log(`Session resumed: ${resumed}`);
```

---

## Verification & Testing

```bash
cd clients/ts
npm test
```

## Encrypted frame layout

Encrypted payloads are ChaCha20-Poly1305 envelopes: `EnvelopeHeader(12) ‖ Nonce(12) ‖ Ciphertext ‖ Tag(16)`.
The AEAD additional data is `EnvelopeHeader(12) ‖ Nonce(12) ‖ FrameHeader(6)`, where the frame header is
encoded after the sequence id is assigned and with the `ENCRYPTED` flag set, matching the Nalix host.
`FramePipeline` does this automatically. When calling `FrameCipher.encrypt`/`decrypt` directly, pass the
encoded 6-byte frame header as `userAad`.
