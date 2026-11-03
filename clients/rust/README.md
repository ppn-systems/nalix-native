# Nalix Native Rust Client SDK

The Nalix Rust Client SDK provides an idiomatic Rust client implementation for high-performance backend and systems development.

## Architecture

- **Status Model (`status`):** Canonical status codes (0..16) and `Status` error type.
- **Wire Framing (`packet`):** Nalix v14 6-byte header with Little-Endian binary layout.
- **Channel State Machine (`channel`):** Connectivity states (`Idle`, `Connecting`, `Ready`, `TransientFailure`, `Shutdown`).
- **Client Lifecycle (`client`):** `NalixClient` lifecycle, configuration, and dispatch interface.

## Verification

```bash
cargo test
```
