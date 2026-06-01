# ⚡ Nalix Protogen

[![GitHub repository](https://img.shields.io/badge/GitHub-ppn--systems%2Fprotogen-blue?logo=github)](https://github.com/ppn-systems/protogen)
[![.NET 10.0](https://img.shields.io/badge/.NET-10.0-blueviolet?logo=dotnet&logoColor=white)](https://dotnet.microsoft.com)
[![License](https://img.shields.io/badge/License-Apache_2.0-orange?logo=apache)](LICENSE)

A high-performance, Roslyn-powered code generation utility that compiles C# packet definitions into wire-compatible C and Rust bindings. Ensures identical byte layout, alignment, and serialization order across platforms.

---

## 🗺️ Documentation Index

To keep this project maintainable as we support additional target languages, detailed specifications are split into dedicated guides:
* **📐 [Protogen Serialization & Type Specification](docs/SPECIFICATION.md):** Primitive and complex type mappings (C/Rust), string formats, C# definition attributes (`[Packet]`, `[SerializeOrder]`), and generated code outputs.

---

## ✨ Key Features

* **Roslyn-Powered Parser:** Uses `MSBuildWorkspace` to parse `.csproj` source trees or reflection to read compiled assemblies (`.dll`).
* **Multi-Language Bindings:** Generates fully-typed native C structs (with MSVC pack pragmas) and safe Rust structs.
* **Automatic Size Verification:** Builds round-trip test suites (`packet_test.c` and `packet_tests.rs`) to prove serialization/deserialization logic is identical across target languages.

---

## 🛠️ Installation

Build the self-contained compiler binary from the repository root:

```bash
dotnet publish src/Nalix.Protogen.Cli -c Release -o ./bin
```

The output compiles to a self-contained `protogen` executable in the `./bin` directory.

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
| `-p` | `--project` | Path to the C# `.csproj` containing packet definitions. |
| `-a` | `--assembly` | Path to the compiled C# `.dll` containing packet definitions. |
| | `--c-out` | Output directory for C files (`packets.h`, `packets.c`, `packet_test.c`). |
| | `--rust-out` | Output directory for Rust files (`packets.rs`, `packets_tests.rs`). |
| `-v` | `--verbose` | Enable verbose logging for MSBuild warnings. |

### Practical Examples

```bash
# Generate C and Rust bindings from a csproj source
protogen -p ../Nalix.Codec/Nalix.Codec.csproj --c-out ./gen/c --rust-out ./gen/rs

# Generate C-only bindings from a compiled DLL assembly
protogen -a ../Nalix.Codec/bin/Release/net10.0/Nalix.Codec.dll --c-out ./gen/c
```

---

## 📐 Project Architecture

```plaintext
Nalix.Protogen.Abstractions   # Shared models, interfaces, and options contracts.
Nalix.Protogen.Roslyn         # MSBuild and Roslyn workspace packet code parser.
Nalix.Protogen.Cli            # Console Application entry point (protogen).
```

---

## ⚖️ License

Apache License 2.0. See [LICENSE](LICENSE) for details.
