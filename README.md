# Protogen

[![Build Status](https://img.shields.io/badge/build-passing-brightgreen)](https://github.com/ppn-systems/protogen)
[![Target Runtime](https://img.shields.io/badge/.NET-10.0-blue)](https://dotnet.microsoft.com)
[![License](https://img.shields.io/badge/license-Apache_2.0-blue)](LICENSE)

Protogen is a cross-platform protocol code generator that converts C# binary packet contracts into native C (C99, ESP-IDF, FreeRTOS) and Rust data structures matching the Nalix v14 wire protocol.

---

## Documentation Index

- [Architecture Specification](docs/ARCHITECTURE.md): Domain-Driven Design (DDD), SOLID architecture, Roslyn and Reflection analysis pipelines.
- [Wire Protocol & Type Specification](docs/SPECIFICATION.md): Nalix v14 6-byte header, opcode discovery, primitive and complex type mappings.
- [Integration Guide](docs/INTEGRATION.md): Integration patterns for ESP-IDF, Arduino, FreeRTOS, and Rust services.

---

## System Overview

Protogen operates as an unmanaged code generator targeting embedded and native environments:

- **Wire Compatibility:** Emits binary layouts matching Nalix v14 (6-byte header consisting of OpCode, Flags, Priority, and SequenceId; Little-Endian byte order; length-prefixed strings).
- **Alignment Safety:** Generates sequential bitshift decoding routines for non-aligned memory access environments (e.g., Xtensa, RISC-V, ARM Cortex-M).
- **Multi-Compiler Packing:** Emits compilation guards for GCC/Clang (`__attribute__((packed))` and `#pragma pack(push, 1)`) and MSVC.
- **Standalone Analysis:** Does not require runtime references or project dependencies to Nalix assemblies. Parses contracts via Roslyn compilation workspaces or reflection metadata.
- **Schema Validation:** Enforces strict domain rules including opcode uniqueness, field ordering determinism, and identifier safety.

---

## Project Structure

The solution adheres to clean architecture boundaries:

```plaintext
src/
├── Protogen.Core/        # Domain models, protocol constants, and validator contracts
│   ├── Constants/        # ProtocolConstants, ContractMetadata
│   ├── Models/           # PacketSchema, FieldSchema, GeneratedFile
│   ├── Contracts/        # IContractAnalyzer, ICodeGenerator, GenerationContext
│   └── Validation/       # SchemaValidator, ISchemaValidator, SchemaDiagnostic
│
├── Protogen.Engine/      # Analysis and generation implementations
│   ├── Analysis/         # RoslynProjectAnalyzer, ReflectionAssemblyAnalyzer, TypeResolver
│   └── Generators/       # CGenerator, RustGenerator
│
├── Protogen.Cli/         # Command-line interface
│   └── Program.cs        # CLI entry point, argument parsing, error codes
│
tests/
└── Protogen.Tests/       # Unit and regression test suite
```

---

## Compilation

Prerequisites: .NET 10.0 SDK.

```bash
# Build the solution in Release configuration
dotnet build src/Protogen.slnx -c Release

# Run automated tests
dotnet test src/Protogen.slnx -c Release

# Publish standalone executable
dotnet publish src/Protogen.Cli/Protogen.Cli.csproj -c Release -o bin/
```

The resulting CLI binary is emitted to `bin/protogen` (`bin/protogen.exe` on Windows).

---

## Command-Line Interface

### Syntax

```bash
protogen --project <path-to-csproj> --c-out <dir> [--rust-out <dir>] [options]
protogen --assembly <path-to-dll> --c-out <dir> [--rust-out <dir>] [options]
```

### Options

| Option | Short | Description |
| :--- | :--- | :--- |
| `--project` | `-p` | Path to the C# `.csproj` containing packet contract source files. |
| `--assembly` | `-a` | Path to the compiled C# `.dll` containing packet contract metadata. |
| `--c-out` | | Output directory for C headers and source (`packets.h`, `packets.c`, `packet_test.c`). |
| `--rust-out` | | Output directory for Rust source files (`packets.rs`, `packets_tests.rs`). |
| `--strict` | | Treat validation warnings as errors and abort execution. |
| `--verbose` | `-v` | Enable verbose diagnostic logging and stack traces. |
| `--help` | `-h` | Display command-line options and usage syntax. |

### Exit Codes

| Code | Name | Description |
| :--- | :--- | :--- |
| `0` | Success | Schema validation and code generation succeeded. |
| `1` | General Error | Unhandled runtime exception or I/O failure. |
| `2` | Validation Error | Schema validation failed (e.g., duplicate OpCodes, field order collisions). |
| `64` | Usage Error | Invalid command-line arguments or syntax. |

---

## Verification

### C Test Suite

```bash
cd examples/c
gcc -Wall -Wextra -Iinclude src/packets.c tests/packet_test.c -o packet_test
./packet_test
```

### Rust Test Suite

```bash
cd examples/rust
cargo test
```

---

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) for details.
