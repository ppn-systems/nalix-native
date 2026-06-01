# Nalix Protocol Toolkit

A Roslyn-based code generator that produces wire-compatible C and Rust bindings from C# packet definitions. Guarantees identical byte layout across all platforms.

## Installation

Download the latest release or build from source:

```bash
dotnet publish src/Nalix.Protocol.Toolkit.Cli -c Release -o ./bin
```

The output is a self-contained `nalix-protogen` executable.

## Usage

```bash
nalix-protogen --project <path-to-csproj> --c-out <dir> [--rust-out <dir>] [options]
nalix-protogen --assembly <path-to-dll> --c-out <dir> [--rust-out <dir>] [options]
```

### Options

| Flag | Description |
|------|-------------|
| `-p, --project` | Path to the `.csproj` file containing packet definitions |
| `-a, --assembly` | Path to the compiled `.dll` containing packet definitions |
| `--c-out` | Output directory for C files (`packets.h`, `packets.c`, `packet_test.c`) |
| `--rust-out` | Output directory for Rust files (`packets.rs`, `packet_tests.rs`) |
| `-v, --verbose` | Show detailed output |

### Examples

```bash
# Generate both C and Rust bindings
nalix-protogen -p ../Nalix.Codec/Nalix.Codec.csproj --c-out ./gen/c --rust-out ./gen/rs

# Generate C only
nalix-protogen -p ../Nalix.Codec/Nalix.Codec.csproj --c-out ./gen/c

# Generate from compiled DLL
nalix-protogen -a ../Nalix.Codec/bin/Release/net10.0/Nalix.Codec.dll --c-out ./gen/c --rust-out ./gen/rs
```

## Supported C# Types

### Primitives

| C# Type | C Type | Rust Type | Size |
|---------|--------|-----------|------|
| `byte` | `uint8_t` | `u8` | 1 |
| `sbyte` | `int8_t` | `i8` | 1 |
| `bool` | `uint8_t` | `u8` | 1 |
| `short` | `int16_t` | `i16` | 2 |
| `ushort` | `uint16_t` | `u16` | 2 |
| `int` | `int32_t` | `i32` | 4 |
| `uint` | `uint32_t` | `u32` | 4 |
| `long` | `int64_t` | `i64` | 8 |
| `ulong` | `uint64_t` | `u64` | 8 |
| `float` | `float` | `f32` | 4 |
| `double` | `double` | `f64` | 8 |

### Special Types

| C# Type | C Type | Rust Type | Size |
|---------|--------|-----------|------|
| `Bytes32` | `Bytes32` (struct with `uint8_t data[32]`) | `[u8; 32]` | 32 |
| `PacketHeader` | `PacketHeader` (packed struct) | `PacketHeader` | 10 |
| `string` | `NalixString` (length-prefixed UTF-8) | `Vec<u8>` | variable |

**String wire format:** `[int32_t length][utf8 bytes]` — null = length -1, empty = length 0. Matches the Nalix codec `StringFormatter`.

### Enums

Enums are mapped by their underlying integer type. Supported underlying types: `byte`, `sbyte`, `short`, `ushort`, `int`, `uint`, `long`, `ulong`.

```csharp
public enum OpMode : byte { Read = 0, Write = 1 }
// C:   uint8_t
// Rust: u8
```

## Unsupported Types

The following C# types have **no native equivalent** in C or Rust and are not supported:

| C# Type | Reason |
|---------|--------|
| `char` | C `char` is 1 byte, C# `char` is 2 bytes (UTF-16). Incompatible. |
| `decimal` | No equivalent in C or Rust. |
| `DateTime` | No equivalent. Use `long` (ticks) or `ulong` (unix timestamp). |
| `Guid` | No equivalent. Use `Bytes16` or two `ulong` fields. |
| `object` / reference types | Not serializable to wire format. |
| Arrays / collections | Variable-length. Use fixed-size fields. |
| `Nullable<T>` | Not serializable. Use a sentinel value. |

## Packet Definition Rules

### Attributes

| Attribute | Purpose |
|-----------|---------|
| `[Packet]` | Marks a class as a packet. Must inherit `PacketBase<TSelf>`. |
| `[SerializeOrder(n)]` | Sets the serialization order for payload fields. Lower = first. |
| `[SerializeHeader(n)]` | Sets the serialization order for header fields. Header fields are serialized before payload. |
| `[SerializeIgnore]` | Excludes a field from serialization. |

### Example

```csharp
[Packet]
public sealed class Handshake : PacketBase<Handshake>
{
    [SerializeHeader(0)]
    public PacketHeader _header;

    [SerializeOrder(0)]
    public byte Stage;

    [SerializeOrder(1)]
    public ushort Reason;

    [SerializeOrder(2)]
    public ulong SessionToken;

    [SerializeOrder(3)]
    public Bytes32 PublicKey;

    [SerializeOrder(4)]
    public Bytes32 Nonce;

    [SerializeOrder(5)]
    public Bytes32 Proof;

    [SerializeOrder(6)]
    public Bytes32 TranscriptHash;
}
```

Generates:

**C** (`packets.h`):
```c
typedef struct {
    PacketHeader _header;
    uint8_t Stage;
    uint16_t Reason;
    uint64_t SessionToken;
    Bytes32 PublicKey;
    Bytes32 Nonce;
    Bytes32 Proof;
    Bytes32 TranscriptHash;
} Handshake; // 149 bytes
```

**Rust** (`packets.rs`):
```rust
#[repr(C)]
pub struct Handshake {
    pub _header: PacketHeader,
    pub stage: u8,
    pub reason: u16,
    pub session_token: u64,
    pub public_key: [u8; 32],
    pub nonce: [u8; 32],
    pub proof: [u8; 32],
    pub transcript_hash: [u8; 32],
} // 149 bytes
```

## Generated Output

### C Files

| File | Description |
|------|-------------|
| `include/packets.h` | Struct definitions, function declarations, size macros |
| `src/packets.c` | Serialize/deserialize/equals implementations |
| `tests/packet_test.c` | Round-trip test for each packet |

Compile the test:
```bash
gcc -Iinclude -o packet_test tests/packet_test.c src/packets.c && ./packet_test
```

### Rust Files

| File | Description |
|------|-------------|
| `src/packets.rs` | Struct definitions with serialize/deserialize/equals methods |
| `tests/packet_tests.rs` | Round-trip test for each packet |

Run the test:
```bash
cargo test
```

## Wire Format

All multi-byte values are encoded in **little-endian** byte order. `Bytes32` and `PacketHeader` fields are copied as raw bytes (no endian conversion needed).

Serialization layout:
```
[Header fields in SerializeHeader order] [Payload fields in SerializeOrder order]
```

## Architecture

```
Nalix.Protocol.Toolkit.Abstractions   # Interfaces and data models
Nalix.Protocol.Toolkit.Roslyn         # Roslyn analyzer + code generators
Nalix.Protocol.Toolkit.Cli            # CLI entry point
```

The toolkit uses Roslyn (`MSBuildWorkspace`) to analyze C# source, extract packet definitions via attributes, and generate wire-compatible C and Rust code. `PacketHeader` is hardcoded due to its `[StructLayout(Explicit)]` layout.

## License

Apache License 2.0
