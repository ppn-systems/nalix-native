# Nalix Native

[![CI](https://github.com/ppn-systems/nalix-native/actions/workflows/ci.yml/badge.svg)](https://github.com/ppn-systems/nalix-native/actions)
[![Target Runtime](https://img.shields.io/badge/.NET-10.0-blue)](https://dotnet.microsoft.com)
[![License](https://img.shields.io/badge/license-Apache_2.0-blue)](LICENSE)

Nalix Native is the official cross-platform native SDK and tooling repository for the Nalix binary messaging protocol. It provides native high-performance client SDKs (C99, Rust, TypeScript / Web) organized around transport sessions (`WebSocketSession`, `TcpSession`, `TransportSession`) and an unmanaged code generator (`protogen`) for native systems, web applications, and embedded runtimes (Web Browsers, Node.js, ESP-IDF, FreeRTOS, STM32, Linux, Windows).

---

## Documentation

- [Architecture Specification](docs/ARCHITECTURE.md): Domain-Driven Design (DDD), SOLID principles, transport sessions, and Roslyn/Reflection analysis pipelines.
- [Wire Protocol & Type Specification](docs/SPECIFICATION.md): Nalix v14 6-byte header, opcode discovery, primitive and complex type mappings.
- [Integration Guide](docs/INTEGRATION.md): Integration patterns for Web Browsers, Node.js, ESP-IDF, FreeRTOS, Linux/POSIX, and Rust services.

---

## Monorepo Layout

```plaintext
nalix-native/
├── clients/                      # Target client SDKs (Transport Sessions)
│   ├── c/                        # C99 client SDK (ESP-IDF, FreeRTOS, POSIX)
│   │   ├── include/nalix/        # Public API headers (status, packet, channel, session)
│   │   ├── src/                  # Session implementation
│   │   ├── tests/                # Verification test suite
│   │   └── CMakeLists.txt        # CMake build configuration
│   ├── rust/                     # Rust client SDK (nalix-client crate)
│   │   ├── src/                  # Session implementation (TcpSession, WebSocketSession)
│   │   └── Cargo.toml            # Crate manifest
│   └── ts/                       # TypeScript / Web client SDK (@ppn/nalix-client)
│       ├── src/                  # Session implementation (WebSocketSession)
│       ├── tests/                # Verification test suite
│       └── package.json          # Package manifest
│
├── nxproto/                      # Protocol contract code generator (C#, C, Rust, TypeScript)
│   ├── src/
│   │   ├── NXProto.Core/         # Domain models, value objects, protocol contracts
│   │   ├── NXProto.Engine/       # Analysis (Roslyn, Reflection) & Generators (C, Rust, TypeScript)
│   │   └── NXProto.Cli/          # Command-line tool executable (nxproto)
│   ├── tests/
│   │   ├── NXProto.Core.Tests/   # Domain logic & schema unit tests
│   │   ├── NXProto.Engine.Tests/ # Generator & analyzer unit tests
│   │   ├── NXProto.Cli.Tests/    # CLI arguments & option parser unit tests
│   │   └── NXProto.IntegrationTests/ # End-to-end integration test suite
│   └── NXProto.slnx              # NXProto solution
│
├── examples/                     # Generated packet samples & round-trip tests
│   ├── c/                        # Generated C packet codecs & GCC test runner
│   ├── rust/                     # Generated Rust packet codecs & Cargo test runner
│   └── ts/                       # Generated TypeScript packet codecs & Node.js test runner
│
├── docs/                         # Specifications and architecture documentation
├── .github/workflows/            # CI/CD verification & release automation
└── Nalix.Native.slnx             # Root solution for .NET components
```

---

## Client SDK Architecture

The client libraries provide clean, modular, and decoupled abstractions directly matching the Nalix C# architecture:

1. **Transport Sessions (`WebSocketSession`, `TcpSession`):** Direct mirror of Nalix C#'s `TransportSession` model with correlated request/response (`session.request()`), event subscriptions (`session.on()`), ping/latency estimation (`session.ping()`), and automatic reconnection.
2. **Standard Status Model:** 17 canonical status codes mapping directly across C, Rust, TypeScript, and .NET.
3. **Wire Framing:** Nalix v14 6-byte header (`OpCode`, `Flags`, `Priority`, `SequenceId`) with Little-Endian byte order.
4. **Channel State Machine:** Deterministic connection lifecycle (`IDLE`, `CONNECTING`, `READY`, `TRANSIENT_FAILURE`, `SHUTDOWN`).
5. **Direct Web Browser Support:** TypeScript client runs natively in all browsers via `WebSocket`, `ArrayBuffer`, and `DataView` with zero runtime dependencies.

---

## Quick Start & Verification

### 1. NXProto Code Generator

```bash
# Build NXProto CLI and Engine
dotnet build nxproto/src/NXProto.Cli/NXProto.Cli.csproj

# Run test suites (Core, Engine, CLI, Integration)
dotnet test nxproto/NXProto.slnx

# Run code generator against C# project or assembly
dotnet run --project nxproto/src/NXProto.Cli/NXProto.Cli.csproj -- \
    --project path/to/Contracts.csproj \
    --c-out ./dist/c \
    --rust-out ./dist/rust \
    --ts-out ./dist/ts
```

### 2. C Client & Codec Test Suite

```bash
# Build C client library and tests with CMake
cmake -B clients/c/build -S clients/c
cmake --build clients/c/build
ctest --test-dir clients/c/build --output-on-failure

# Run generated C packet codec tests
cmake -B examples/c/build -S examples/c
cmake --build examples/c/build
ctest --test-dir examples/c/build --output-on-failure
```

### 3. Rust Client & Codec Test Suite

```bash
# Test Rust Client SDK (nalix-client)
cargo test --manifest-path clients/rust/Cargo.toml

# Test generated Rust codecs
cargo test --manifest-path examples/rust/Cargo.toml
```

### 4. TypeScript / Web Client & Codec Test Suite

```bash
# Test TypeScript Client SDK (@ppn/nalix-client)
cd clients/ts && npm test

# Test generated TypeScript codecs
cd examples/ts && npm test
```

---

## License

Copyright (c) 2025-2026 PPN Corporation. All rights reserved.  
Licensed under the [Apache License, Version 2.0](LICENSE).
