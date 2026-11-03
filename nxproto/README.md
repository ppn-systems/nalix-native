# NXProto - Protocol Contract Code Generator

**NXProto** is the high-performance, modular protocol code generation engine for the Nalix messaging framework. It analyzes C# binary packet contracts via Roslyn compilation workspaces or reflection metadata and emits zero-dependency, native, wire-compatible bindings for:

- **C (C99, ESP-IDF, FreeRTOS, Embedded STM32)**
- **Rust (native, `no_std`-ready, packed memory layout)**
- **TypeScript / Web (DataView, Little-Endian binary codecs, browser & Node.js)**

## Architectural Design (DDD & SOLID)

NXProto is partitioned into decoupled projects adhering strictly to Domain-Driven Design (DDD) and SOLID principles:

### Core Domain Layer (`NXProto.Core`)
- **Entities & Value Objects:**
  - `PacketSchema`: Rich domain entity representing a packet definition, with self-contained invariant validation (`Validate()`), fixed wire size calculation (`CalculateWireSize()`), and dynamic payload detection (`HasVariableFields`).
  - `FieldSchema`: Value object defining serialized fields (Order, Size, Unmanaged, Nullable, Type mappings).
  - `GeneratedFile`: Value object representing an output source/header artifact.
- **Contracts (ISP & DIP):**
  - `ICodeGenerator`: Open-Closed interface for emitting target language bindings.
  - `IContractAnalyzer`: Interface for parsing contract targets (project or assembly).
  - `IGeneratorFactory`: Factory interface resolving code generators by language alias.

### Engine & Infrastructure Layer (`NXProto.Engine`)
- **Analysis Services (SRP):**
  - `RoslynProjectAnalyzer`: Analyzes C# projects using Roslyn workspaces and semantic models.
  - `ReflectionAssemblyAnalyzer`: Analyzes compiled assemblies via reflection metadata.
  - `OpCodeEvaluator`: Evaluates static OpCodes from interfaces, attributes, or const fields.
  - `TypeResolver`: Type mapping domain service converting C# types to C99, Rust, and TypeScript.
- **Generators (OCP):**
  - `CGenerator`: Emits `#pragma pack(push, 1)` structs, Little-Endian bitshift encoders/decoders, and array memory management routines.
  - `RustGenerator`: Emits `#[repr(C, packed)]` structs and endian-safe serialization traits.
  - `TypeScriptGenerator`: Emits TypeScript classes with `encode()` and `decode()` using DataView Little-Endian accessors.
  - `GeneratorFactory`: Factory discovering and resolving generator implementations by language name.

### Presentation Layer (`NXProto.Cli`)
- `CommandLineParser`: Dedicated service for CLI argument parsing and validation.
- `GenerationRunner`: Orchestration service coordinating analysis, generation, and file writing.
- Executable binary: `nxproto`.

### Test Suite (`tests/`)
- `NXProto.Core.Tests`: Unit tests for domain models, validation rules, sizing, and invariants.
- `NXProto.Engine.Tests`: Unit tests for TypeResolver, OpCodeEvaluator, and each generator (C, Rust, TypeScript).
- `NXProto.Cli.Tests`: Unit tests for CLI parsing, help handling, and error states.
- `NXProto.IntegrationTests`: End-to-end integration tests generating code into temporary directories and asserting syntax validity.

## Usage

```bash
# Display help
dotnet run --project nxproto/src/NXProto.Cli -- --help

# Generate C, Rust, and TypeScript bindings from a C# contract project
dotnet run --project nxproto/src/NXProto.Cli -- \
  --project ./path/to/Contracts.csproj \
  --c-out ./dist/c \
  --rust-out ./dist/rust \
  --ts-out ./dist/ts

# Or using compiled assembly
dotnet run --project nxproto/src/NXProto.Cli -- \
  --assembly ./bin/Release/Contracts.dll \
  --c-out ./dist/c \
  --rust-out ./dist/rust \
  --ts-out ./dist/ts
```

## Running Tests

```bash
dotnet test nxproto/NXProto.slnx
```
