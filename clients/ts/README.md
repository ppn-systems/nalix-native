# Nalix Native TypeScript / Web Client SDK

The Nalix TypeScript Client SDK provides an unmanaged, zero-runtime-dependency binary client for modern web browsers, Node.js (22+), Deno, and Bun runtimes.

## Features

- **Direct Web & Browser Support:** Runs natively in all modern browsers (`window.WebSocket`, `ArrayBuffer`, `DataView`).
- **Zero Runtime Dependencies:** Built strictly on standard Web APIs.
- **Wire Protocol Compatibility:** Nalix v14 6-byte Little-Endian binary header framing.
- **Canonical Status Model:** 17 standardized operation status codes.
- **Deterministic Lifecycle:** State transitions (`IDLE`, `CONNECTING`, `READY`, `TRANSIENT_FAILURE`, `SHUTDOWN`).

## Installation

```bash
npm install @ppn/nalix-client
```

## Quick Start (Web Browser & Node.js)

```typescript
import { ChannelConfig, NalixClient, Packet, PacketHeader } from '@ppn/nalix-client';

// Configure WebSocket connection
const config = new ChannelConfig({
  host: 'atmosos.eyc.asia',
  port: 443,
  path: '/ws/',
  useTls: true,
  subprotocol: 'nalix.v1',
});

const client = new NalixClient(config);

// Connect
await client.connect();
console.log('Connected to Nalix server!');

// Send binary packet (OpCode: 0x0001, SYSTEM_CONTROL)
const header = new PacketHeader(0x0001, 0x04, 0x02, 0x0001);
const payload = new Uint8Array([0x00, 0x00, 0x01]); // Reason: NONE, Type: PING
const packet = new Packet(header, payload);

client.send(packet);

// Clean disconnect
client.disconnect();
```

## Verification & Testing

```bash
npm test
```
