# Protogen Architecture Specification

## 1. System Overview

Protogen is a domain-driven code generation utility designed to convert C# packet contract declarations into unmanaged, byte-for-byte wire-compatible C and Rust data models.

The system is partitioned into three decoupled assemblies adhering to Domain-Driven Design (DDD) layer boundaries and SOLID principles:

```mermaid
graph TD
    subgraph Presentation ["Presentation Layer"]
        CLI["Protogen.Cli (Console Application)"]
    end

    subgraph Core ["Domain Core (Protogen.Core)"]
        Contracts["Contracts: IContractAnalyzer, ICodeGenerator"]
        DomainModels["Models: PacketSchema, FieldSchema, GeneratedFile"]
        Constants["Constants: ProtocolConstants, ContractMetadata"]
    end

    subgraph Engine ["Infrastructure & Engine (Protogen.Engine)"]
        RoslynAnalyzer["RoslynProjectAnalyzer (MSBuild / Roslyn AST)"]
        ReflectionAnalyzer["ReflectionAssemblyAnalyzer (.NET Metadata)"]
        CGen["CGenerator (C99 / ESP-IDF)"]
        RustGen["RustGenerator (Rust 2021)"]
    end

    CLI --> Core
    CLI --> Engine
    Engine --> Core
```

---

## 2. Layer Responsibilities

### 2.1 Domain Layer (`Protogen.Core`)

The domain layer encapsulates all business logic, invariant verification, and data models of the protocol representation. It has zero dependencies on external NuGet packages or Roslyn compiler libraries.

- **Models:**
  - `PacketSchema`: Immutable representation of a packet definition, including its 16-bit OpCode, field definitions, and wire size calculations.
  - `FieldSchema`: Value object defining individual packet field properties (data types, serialization order, size in bytes, nullability).
  - `GeneratedFile`: Encapsulates an emitted source file, relative destination path, and file contents.
- **Contracts:**
  - `IContractAnalyzer`: Abstraction for parsing packet contracts from source trees or binaries.
  - `ICodeGenerator`: Abstraction for rendering target language source code from an immutable list of `PacketSchema`.
- **Constants:**
  - `ProtocolConstants`: Defines fundamental wire protocol characteristics, such as the 6-byte header size and primitive type byte counts.
  - `ContractMetadata`: String identifiers for contract attributes (`[NalixPacket]`, `[Packet]`, `[SerializeOrder]`, `[SerializeHeader]`).

### 2.2 Infrastructure & Engine Layer (`Protogen.Engine`)

The engine layer implements domain contracts for analysis and code generation.

- **Analysis Implementations:**
  - `RoslynProjectAnalyzer`: Loads `.csproj` projects via MSBuild workspaces, compiles syntax trees, queries semantic models, and extracts field metadata without executing target code.
  - `ReflectionAssemblyAnalyzer`: Inspects compiled `.dll` assemblies via reflection, querying custom attribute providers and field offsets.
  - `TypeResolver`: Maps C# types (primitives, enums, byte buffers, strings) to unmanaged C types and Rust types.
  - `OpCodeEvaluator`: Evaluates compile-time constant expressions for `StaticOpCode`.
- **Generation Implementations:**
  - `CGenerator`: Emits C99 headers (`packets.h`), implementations (`packets.c`), and unit test runners (`packet_test.c`).
  - `RustGenerator`: Emits safe Rust modules (`packets.rs`) and round-trip unit test modules (`packets_tests.rs`).

### 2.3 Presentation Layer (`Protogen.Cli`)

The CLI layer is responsible for argument parsing, execution orchestration, and process return codes:
- Parses command-line arguments.
- Instantiates the chosen `IContractAnalyzer`.
- Coordinates target `ICodeGenerator` instances and writes generated files to disk.

---

## 3. SOLID Design Adherence

### 3.1 Single Responsibility Principle (SRP)
- `IContractAnalyzer` implementations only extract metadata into domain models.
- `ICodeGenerator` implementations only transform domain models into target language source strings.
- `Protogen.Cli` only manages process input, output, and process return codes.

### 3.2 Open/Closed Principle (OCP)
The code generation pipeline is open for extension but closed for modification. Adding a new target language (e.g., Go, Python, Swift) requires implementing `ICodeGenerator` without modifying existing analyzers or CLI execution flow.

### 3.3 Liskov Substitution Principle (LSP)
Both `RoslynProjectAnalyzer` and `ReflectionAssemblyAnalyzer` implement `IContractAnalyzer`. They are fully interchangeable and yield identical `PacketSchema` representations from identical contract definitions.

### 3.4 Interface Segregation Principle (ISP)
Interfaces are narrowly defined:
- `IContractAnalyzer`: Single asynchronous method `AnalyzeAsync(string targetPath, CancellationToken ct)`.
- `ICodeGenerator`: Single method `Generate(IReadOnlyList<PacketSchema> packets)`.

### 3.5 Dependency Inversion Principle (DIP)
High-level modules (the CLI runner) and low-level modules (the generators and analyzers) depend entirely on abstractions defined in `Protogen.Core`, ensuring zero cyclic dependencies and clean testability.

---

## 4. Pipeline Execution Lifecycle

```mermaid
sequenceDiagram
    participant CLI as Protogen.Cli
    participant Analyzer as IContractAnalyzer
    participant Generator as ICodeGenerator
    participant Disk as File System

    CLI->>Analyzer: AnalyzeAsync(targetPath)
    Analyzer->>Analyzer: Discover packet types via attributes
    Analyzer->>Analyzer: Extract StaticOpCode & [SerializeOrder] fields
    Analyzer-->>CLI: IReadOnlyList<PacketSchema>
    
    CLI->>Generator: Generate(packets)
    Generator-->>CLI: IReadOnlyList<GeneratedFile>
    CLI->>Disk: Write files to output directories
```

---

## 5. Architecture & Implementation Decisions

### 6.1 Decoupling from Nalix Packages
Protogen does not reference `Nalix.Codec` or `Nalix.Abstractions` directly. Contract analysis relies on string metadata matching defined in `ContractMetadata`. This ensures the code generator remains functional across Nalix major versions without assembly binding redirects or package lock conflicts.

### 6.2 Microcontroller-Safe Sequential Shift Decoding
Many embedded processors (including Xtensa cores on ESP32, RISC-V cores on ESP32-C3, and ARM Cortex-M0) trigger hardware exceptions on unaligned multi-byte memory access (e.g., `*(uint16_t*)ptr`).

To prevent memory alignment faults:
- Serialization uses `memcpy` and explicit byte-order shifts.
- Deserialization reads bytes sequentially via bitwise shifts:
  ```c
  uint16_t val = (uint16_t)(ptr[0] | ((uint16_t)ptr[1] << 8));
  ```
This pattern is architecture-agnostic and guarantees determinism across all unaligned memory configurations.

### 6.3 Multi-Compiler Structure Packing
Different compiler toolchains employ distinct mechanisms to eliminate structure padding:
- GCC and Clang support `__attribute__((packed))` and `#pragma pack(push, 1)`.
- MSVC supports `#pragma pack(push, 1)`.

Protogen generates cross-compiler preprocessor directives:
```c
#if defined(_MSC_VER) || defined(__GNUC__) || defined(__clang__)
    #pragma pack(push, 1)
#endif

typedef struct {
    PacketHeader Header;
    uint16_t Reason;
    uint8_t Type;
} Control;

#if defined(_MSC_VER) || defined(__GNUC__) || defined(__clang__)
    #pragma pack(pop)
#endif
```

### 6.4 C++ Linkage Compatibility
To support compilation under C++ toolchains (such as Arduino IDE, ESP-IDF C++ components, or native C++ backends), the generated C header encloses all function declarations in an `extern "C"` linkage guard:
```c
#ifdef __cplusplus
extern "C" {
#endif

void control_init(Control* pkt);
size_t control_serialize(const Control* pkt, uint8_t* buf, size_t buf_size);
size_t control_deserialize(Control* pkt, const uint8_t* buf, size_t buf_size);

#ifdef __cplusplus
}
#endif
```
