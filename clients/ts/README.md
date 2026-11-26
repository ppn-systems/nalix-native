# Nalix Native TypeScript SDK

The Nalix TypeScript SDK (`@ppnsys/nalix-sdk`) provides a high-performance binary transport SDK for modern web browsers, Node.js (22+), Next.js, Vite, Deno, and Bun runtimes.

Directly aligns in naming and architecture with the Nalix C# SDK (`Nalix.SDK`), centering around transport sessions (`NalixClient` / `WebSocketSession`), correlated request/response calls, typed event subscriptions, automatic reconnection, X25519 TOFU handshake, AES-ready ChaCha20-Poly1305 encryption, LZ4 compression, mid-session Rekey, and HMAC-Keccak256 Session Resumption (`SESSION_SIGNAL`).

**Compatibility:** `@ppnsys/nalix-sdk` 0.2.x implements the wire protocol of **Nalix 14.4.1** (the `Nalix.*` .NET packages of
that version are the reference). `NALIX_TARGET_VERSION` and `SDK_VERSION` are exported for diagnostics.

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
- **Proof-of-Work Admission:** When the host answers `SESSION_INIT` with `POW_REQUIRED`, the handshake solves the Keccak-256 puzzle and retries, bounded by the handshake timeout.
- **Replay Protection:** Inbound encrypted frames are checked against the same 32-slot sliding sequence window the host uses.
- **Session Resumption:** Instant reconnect via 43-byte `SESSION_SIGNAL` and sliding time-window HMAC-Keccak256 proofs with automatic handshake fallback. Auto-reconnect re-authenticates the session (resume, or handshake) before it counts as recovered.
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

Inbound frames that cannot be decrypted, decompressed or parsed are reported through `onError`. If the frame's sequence ID matches an in-flight request, that request rejects with the same `NalixStatus` (for example `DATA_LOSS`) instead of timing out:

```typescript
client.onError((err) => {
  console.warn(`Dropped inbound frame: ${err.code} ${err.message}`);
});
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

If the host rejects the resume (for example `SESSION_EXPIRED`), it ends that connection; `connectWithResume()`
then opens a fresh connection and runs a full handshake, and `reason` says why the resume failed.

To resume from a new session object (for example after a page reload kept the state in memory), pass the old
`SessionState` to the constructor. It carries the key, the token and the envelope sequence counters:

```typescript
const next = new NalixClient(url, previous.sessionState);
await next.connectWithResume();
```

### 7. Requests the Server Rejected

When the host drops a request under backpressure it answers with a `SYSTEM_DIRECTIVE` (`FAIL` / `RATE_LIMITED` /
advice `RETRY`, flagged transient) that echoes the request's sequence ID. The request rejects at once instead of
timing out:

```typescript
try {
  await client.request(0x0200, payload);
} catch (err) {
  if (err instanceof NalixStatus && err.code === StatusCode.RESOURCE_EXHAUSTED && err.details?.transient) {
    // back off and retry
  }
}
```

### 8. Connection Close & Server Shutdown

Nalix hosts end WebSocket connections with a close frame: `1000` for a normal close, `1001` when the host shuts
down and `1009` when a message is larger than the host allows. In-flight requests reject with a `NalixStatus`
whose `details.closeCode` / `details.closeReason` carry it (`1001` maps to `UNAVAILABLE` with reason
`SERVER_SHUTDOWN`), and `session.lastClose` records how the last connection ended.

`disconnect()` sends a `1000` close frame and waits for the peer's close frame, at most 2 seconds
(`CLOSE_HANDSHAKE_TIMEOUT_MS`, the bound the host uses), so a `DISCONNECT` control frame written just before
reaches the host. The state is `SHUTDOWN` immediately; `close()` does the same without waiting.

Hosts close connections that do not authenticate within their handshake timeout, so run `handshake()` (or
`connectWithResume()`) right after `connect()`. `NalixClient.connect(url)` does this for you.

---

## Verification & Testing

```bash
cd clients/ts
npm test
```

`tests/live.test.ts` runs a handshake, ping, time sync and rekey against a public Nalix host and is skipped when
the host cannot be reached.

## Encrypted frame layout

Encrypted payloads are ChaCha20-Poly1305 envelopes: `EnvelopeHeader(12) ‖ Nonce(12) ‖ Ciphertext ‖ Tag(16)`.
The AEAD additional data is `EnvelopeHeader(12) ‖ Nonce(12) ‖ FrameHeader(6)`, where the frame header is
encoded after the sequence id is assigned and with the `ENCRYPTED` flag set, matching the Nalix host.
`FramePipeline` does this automatically. When calling `FrameCipher.encrypt`/`decrypt` directly, pass the
encoded 6-byte frame header as `userAad`.

### Which frames are encrypted

Once the session secret is active (after `handshake()`, or after resume), every outbound frame is encrypted,
including control frames such as PING, TIMESYNC, REKEY and DISCONNECT. Two groups are sent in plaintext by design:

- **Handshake frames** (`SESSION_INIT`, `SESSION_PROOF`, and the `POW_REQUEST` / `POW_PROOF` / `PUBLIC_KEY_REQUEST`
  exchanges inside the handshake). They are sent before the session secret is active.
- **Resume frames** (`SESSION_SIGNAL`). They are sent on a new connection before the secure channel is re-established.

The default can be overridden per frame with the `encrypt` option of `send()` / `request()`, for example
`session.send(packet, undefined, { encrypt: false })`. `ping()`, `syncTime()` and `rekey()` no longer force plaintext.
The host accepts PING and TIMESYNC either way (the C# SDK sends them in plaintext since Nalix 14.4.0); `rekey()`
must be encrypted.

### Sequence numbers and replay protection

Every encrypted frame carries a 32-bit sequence number in its envelope header. Both sides start at 0 when a key
starts: at the beginning of a full handshake and when a rekey switches keys. A resume continues the counters, as
the host restores its own on resume. Sending more than 2^32 - 1 frames under one key throws
`RESOURCE_EXHAUSTED`; call `rekey()` before that.

Inbound encrypted frames must carry a sequence number newer than the last accepted one, or an unseen one at most
31 behind it. Others are dropped and reported through `onError` with `ALREADY_EXISTS`
(`details.reason === ProtocolReason.REPLAY_DETECTED`). A dropped replay never fails a pending request.

### Rekey ordering

`rekey()` sends `SESSION_REKEY` under the current key and switches to the new key (and restarts the counters)
right after the frame is written, before any later frame is encrypted. The host does the same when it reads the
request, so every frame after the request uses the new key on both sides. The host sends `SESSION_REKEY_ACK` in
plaintext. If the ACK is lost the new key is kept, because the host has already switched; the promise still
rejects.
