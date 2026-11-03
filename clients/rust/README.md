# Nalix Native Rust Client SDK

The Nalix Rust Client SDK (`nalix-client`) provides idiomatic Rust transport sessions (`TcpSession`, `WebSocketSession`, `TransportSession`) for high-performance backend, edge, and systems services.

## Architecture

- **Status Model (`status`):** Canonical status codes (0..16) and `Status` error type.
- **Wire Framing (`packet`):** Nalix v14 6-byte header with Little-Endian binary layout and fluent `Packet::create` builders.
- **Channel State Machine (`channel`):** Connectivity states (`Idle`, `Connecting`, `Ready`, `TransientFailure`, `Shutdown`).
- **Transport Sessions (`session`):** Dedicated `TcpSession` and `WebSocketSession` matching Nalix C#'s architecture, with correlated `session.request()`, `session.send_raw()`, and clean lifecycle control.

## Quick Start

### 1. TCP Session

```rust
use nalix_client::{TcpSession, Packet};

let mut session = TcpSession::connect_to("127.0.0.1:57200")?;

let packet = Packet::create(0x0100, b"Hello Nalix".to_vec());
session.send(&packet)?;

session.disconnect()?;
```

### 2. WebSocket Session

```rust
use nalix_client::{WebSocketSession, Packet};

let mut session = WebSocketSession::connect_to("atmosos.eyc.asia:443", "/ws/", true)?;

let mut packet = Packet::create(0x0000, vec![0x42u8; 64]);
let response = session.request(&mut packet)?;

session.disconnect()?;
```

## Verification

```bash
cargo test
```
