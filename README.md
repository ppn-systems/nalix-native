# ⚡ Protogen

[![GitHub repository](https://img.shields.io/badge/GitHub-ppn--systems%2Fprotogen-blue?logo=github)](https://github.com/ppn-systems/protogen)
[![.NET 10.0](https://img.shields.io/badge/.NET-10.0-blueviolet?logo=dotnet&logoColor=white)](https://dotnet.microsoft.com)
[![License](https://img.shields.io/badge/License-Apache_2.0-orange?logo=apache)](LICENSE)

A high-performance, cross-platform code generator that parses C# packet definitions and emits native, zero-dependency **C (C99 / ESP-IDF / Arduino)** and **Rust** bindings matching the **Nalix v14+** binary wire protocol.

---

## 🗺️ Documentation Index

* **📐 [Architecture & Pipeline](docs/ARCHITECTURE.md):** Domain-Driven Design (DDD), SOLID architecture, Roslyn/Reflection analysis, and generator pipelines.
* **📋 [Serialization & Wire Specification](docs/SPECIFICATION.md):** Nalix v14 6-byte header, opcode discovery, primitive/complex type mappings, and memory layout rules.
* **🔌 [Integration Guide (ESP32 & Microcontrollers)](docs/INTEGRATION.md):** Complete guide for ESP-IDF, FreeRTOS, Arduino, and embedded C/Rust clients.

---

## ✨ Key Features

* **Strict Nalix v14 Wire Compatibility:** Standard 6-byte header (`OpCode: uint16`, `Flags: uint8`, `Priority: uint8`, `SequenceId: uint16`), little-endian integers, IEEE 754 floats, and length-prefixed strings.
* **Microcontroller-Safe (ESP32 / ESP8266 / ARM Cortex-M):** Alignment-safe sequential bitshift decoding and `memcpy` serialization, preventing unaligned memory access exceptions on Xtensa and RISC-V cores.
* **Cross-Compiler Packing:** Supports GCC, Clang (`__attribute__((packed))`), and MSVC (`#pragma pack(push, 1)`).
* **Zero External Dependencies:** Standalone engine requiring no runtime `<ProjectReference>` to Nalix or third-party serialization libraries.
* **Dual Contract Analysis:** Analyzes raw source code projects (`.csproj` via Roslyn Semantic Model) or compiled assemblies (`.dll` via Reflection metadata).
* **Automated Verification:** Generates self-contained round-trip test suites for both C (`gcc -Wall -Wextra`) and Rust (`cargo test`).

---

## 📐 Project Architecture (DDD & SOLID)

Protogen is structured into three clean, decoupled layers adhering to Domain-Driven Design (DDD) and SOLID principles:

```plaintext
src/
├── Protogen.Core/        # Domain Models, Constants & Contracts (Zero dependencies)
│   ├── Constants/        # ProtocolConstants, ContractMetadata
│   ├── Models/           # PacketSchema, FieldSchema, GeneratedFile
│   └── Contracts/        # IContractAnalyzer, ICodeGenerator, GenerationContext
│
├── Protogen.Engine/      # Infrastructure & Implementation Engine
│   ├── Analysis/         # RoslynProjectAnalyzer, ReflectionAssemblyAnalyzer, TypeResolver
│   └── Generators/       # CGenerator (C99 / ESP-IDF), RustGenerator
│
└── Protogen.Cli/         # Presentation Layer (Console Application)
    └── Program.cs        # CLI parser and execution orchestration
```

---

## 🛠️ Build & Installation

Build the native compiler CLI tool using the .NET 10.0 SDK:

```bash
# Build the entire solution
dotnet build src/Protogen.slnx -c Release

# Publish the standalone CLI executable to bin/
dotnet publish src/Protogen.Cli/Protogen.Cli.csproj -c Release -o bin/
```

The resulting `protogen` (or `protogen.exe` on Windows) executable is generated in `./bin`.

---

## 💻 CLI Usage

```bash
# General CLI Command Syntax
protogen --project <path-to-csproj> --c-out <dir> [--rust-out <dir>] [options]
protogen --assembly <path-to-dll> --c-out <dir> [--rust-out <dir>] [options]
```

### Options & Flags

| Flag | Long Flag | Description |
| :--- | :--- | :--- |
| `-p` | `--project` | Path to the C# `.csproj` containing packet contract source files. |
| `-a` | `--assembly` | Path to the compiled C# `.dll` containing packet contract metadata. |
| | `--c-out` | Output directory for C headers and source (`packets.h`, `packets.c`, `packet_test.c`). |
| | `--rust-out` | Output directory for Rust modules (`packets.rs`, `packets_tests.rs`). |
| `-v` | `--verbose` | Enable verbose error logging and stack traces. |
| `-h` | `--help` | Display CLI help documentation. |

### Practical Examples

```bash
# Generate C (ESP32/C99) and Rust bindings from a compiled assembly
protogen -a samples/Nalix.Codec.dll --c-out ./examples/c --rust-out ./examples/rust

# Generate C-only bindings from a C# source project
protogen -p ../Nalix.Codec/Nalix.Codec.csproj --c-out ./firmware/esp32/protocol
```

---

## 🧪 Testing the Generated Code

### C Test Suite (GCC / Clang)

```bash
cd examples/c
gcc -Wall -Wextra -Iinclude src/packets.c tests/packet_test.c -o packet_test
./packet_test
```

### Rust Test Suite (Cargo)

```bash
cd examples/rust
cargo test
```

---

## ⚖️ License

Apache License 2.0. See [LICENSE](LICENSE) for details.
