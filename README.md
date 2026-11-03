# Nalix Native

[![Build Status](https://img.shields.io/badge/build-passing-brightgreen)](https://github.com/ppn-systems/nalix-native)
[![Target Runtime](https://img.shields.io/badge/.NET-10.0-blue)](https://dotnet.microsoft.com)
[![License](https://img.shields.io/badge/license-Apache_2.0-blue)](LICENSE)

Nalix Native is the official cross-platform native SDK and tooling repository for the Nalix binary messaging protocol. It provides native high-performance client SDKs (C99, Rust) and an unmanaged code generator (`protogen`) for native systems and embedded runtimes (ESP-IDF, FreeRTOS, STM32, Linux, Windows).

---

## Documentation Index

- [Architecture Specification](docs/ARCHITECTURE.md): Domain-Driven Design (DDD), SOLID principles, native client contracts, and Roslyn/Reflection analysis pipelines.
- [Wire Protocol & Type Specification](docs/SPECIFICATION.md): Nalix v14 6-byte header, opcode discovery, primitive and complex type mappings.
- [Integration Guide](docs/INTEGRATION.md): Integration patterns for ESP-IDF, FreeRTOS, Linux/POSIX, and Rust services.

---

## Repository Structure

The monorepo organizes tooling, client libraries, and codec examples according to canonical protocol engineering standards:

```plaintext
nalix-native/
├── clients/                      # Target client SDKs
│   ├── c/                        # C99 client SDK (ESP-IDF, FreeRTOS, POSIX)
│   │   ├── include/nalix/        # Public API headers (status, packet, channel, client)
│   │   ├── src/                  # Client implementation
│   │   ├── tests/                # Verification test suite
│   │   └── CMakeLists.txt        # CMake build configuration
│   └── rust/                     # Rust client SDK (nalix-client crate)
│       ├── src/                  # Client implementation (status, packet, channel, client)
│       └── Cargo.toml            # Crate manifest
│
├── tools/                        # Tooling and generators
│   └── protogen/                 # Binary contract code generator
│       ├── src/
│       │   ├── Protogen.Core/    # Domain models and protocol contracts
│       │   ├── Protogen.Engine/  # Analysis (Roslyn, Reflection) & Generators (C, Rust)
│       │   ├── Protogen.Cli/     # Command-line tool executable
│       │   └── Protogen.slnx     # Tool solution
│       └── tests/
│           └── Protogen.Tests/   # Generator unit tests
│
├── examples/                     # Generated packet samples & round-trip tests
│   ├── c/                        # Generated C packet codecs & GCC test runner
│   └── rust/                     # Generated Rust packet codecs & Cargo test runner
│
├── docs/                         # Specifications and architecture documentation
├── .github/workflows/            # CI/CD verification & release automation
└── Nalix.Native.slnx             # Root solution for .NET components
```

---

## Client SDK Architecture

The client libraries provide clean, modular, and decoupled abstractions tailored for the high-performance Nalix binary wire protocol:

1. **Status Code Model:** Canonical status codes (0..16: `OK`, `CANCELLED`, `UNKNOWN`, `INVALID_ARGUMENT`, `DEADLINE_EXCEEDED`, `NOT_FOUND`, `ALREADY_EXISTS`, `PERMISSION_DENIED`, `RESOURCE_EXHAUSTED`, `FAILED_PRECONDITION`, `ABORTED`, `OUT_OF_RANGE`, `UNIMPLEMENTED`, `INTERNAL`, `UNAVAILABLE`, `DATA_LOSS`, `UNAUTHENTICATED`).
2. **Wire Framing:** Nalix v14 6-byte header (`OpCode`, `Flags`, `Priority`, `SequenceId`) with Little-Endian byte order.
3. **Channel State Machine:** Deterministic connection lifecycle (`IDLE`, `CONNECTING`, `READY`, `TRANSIENT_FAILURE`, `SHUTDOWN`).
4. **Transport Decoupling:** Core packet framing and channel management are decoupled from underlying physical transports (TCP, UDP, KCP, WebSocket, or serial/UART).

---

## Tooling: Protogen

`protogen` converts C# binary packet contracts into zero-dependency C and Rust data structures and codecs.

### Compilation (.NET 10)

```bash
# Build tool via root solution
dotnet build Nalix.Native.slnx -c Release

# Run generator test suite
dotnet test Nalix.Native.slnx -c Release

# Publish standalone executable
dotnet publish tools/protogen/src/Protogen.Cli/Protogen.Cli.csproj -c Release -o bin/
```

### CLI Usage

```bash
protogen --project <path-to-csproj> --c-out <dir> [--rust-out <dir>] [options]
protogen --assembly <path-to-dll> --c-out <dir> [--rust-out <dir>] [options]
```

| Option | Short | Description |
| :--- | :--- | :--- |
| `--project` | `-p` | Path to the C# `.csproj` containing packet contract source files. |
| `--assembly` | `-a` | Path to the compiled C# `.dll` containing packet contract metadata. |
| `--c-out` | | Output directory for C headers and source (`packets.h`, `packets.c`, `packet_test.c`). |
| `--rust-out` | | Output directory for Rust source files (`packets.rs`, `packets_tests.rs`). |
| `--verbose` | `-v` | Enable verbose diagnostic logging and stack traces. |
| `--help` | `-h` | Display command-line options and usage syntax. |

---

## Verification & Testing

### 1. Protogen (.NET Test Suite)

```bash
dotnet test tools/protogen/src/Protogen.slnx -c Release
```

### 2. C Client & Codec Test Suite

```bash
# Test C Client SDK
gcc -Wall -Wextra -Iclients/c/include clients/c/src/status.c clients/c/src/packet.c clients/c/src/client.c clients/c/tests/client_test.c -o client_test
./client_test

# Test Generated C Codecs
gcc -Wall -Wextra -Iexamples/c/include examples/c/src/packets.c examples/c/tests/packet_test.c -o packet_test
./packet_test
```

### 3. Rust Client & Codec Test Suite

```bash
# Test Rust Client SDK
cargo test --manifest-path clients/rust/Cargo.toml

# Test Generated Rust Codecs
cargo test --manifest-path examples/rust/Cargo.toml
```

---

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) for details.
