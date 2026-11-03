# Nalix Protogen Specification & Type Mapping

This document details the serialization contract, C# packet definition rules, type mappings, and language binding specifications for the **Nalix Protogen** code generator.

---

## 1. Type Mapping Contract

To guarantee byte-level wire compatibility across platforms, C# types are mapped to specific unmanaged C and Rust types.

### A. Primitive Types

| C# Type | C Type | Rust Type | Size (Bytes) | Endianness |
| :--- | :--- | :--- | :--- | :--- |
| `byte` | `uint8_t` | `u8` | 1 | - |
| `sbyte` | `int8_t` | `i8` | 1 | - |
| `bool` | `uint8_t` | `u8` | 1 | - |
| `short` | `int16_t` | `i16` | 2 | Little-Endian |
| `ushort` | `uint16_t` | `u16` | 2 | Little-Endian |
| `int` | `int32_t` | `i32` | 4 | Little-Endian |
| `uint` | `uint32_t` | `u32` | 4 | Little-Endian |
| `long` | `int64_t` | `i64` | 8 | Little-Endian |
| `ulong` | `uint64_t` | `u64` | 8 | Little-Endian |
| `float` | `float` | `f32` | 4 | IEEE 754 |
| `double` | `double` | `f64` | 8 | IEEE 754 |

### B. Special & Complex Types

| C# Type | C Type | Rust Type | Size (Bytes) | Wire Layout |
| :--- | :--- | :--- | :--- | :--- |
| `Bytes32` | `Bytes32` | `[u8; 32]` | 32 | Raw byte array (`uint8_t[32]`) |
| `PacketHeader` | `PacketHeader` | `PacketHeader` | 6 | Packed explicit struct layout (OpCode: 2, Flags: 1, Priority: 1, SequenceId: 2) |
| `string` | `NalixString` | `Vec<u8>` | Variable | `[int32_t length][utf8_bytes]` |

#### String Wire Format
Strings are encoded using the Nalix codec standard:
* Length is written as a signed 32-bit integer (`int32_t`) in little-endian order.
* A C# `null` string is serialized with length `-1` (no payload bytes).
* An empty string `""` is serialized with length `0` (no payload bytes).
* Non-empty strings are followed by their raw UTF-8 payload bytes.

---

## 2. Unsupported C# Types

The code generator excludes types without consistent unmanaged stack structures to prevent memory alignment and serialization mismatches:

| Unsupported C# Type | Reason | Alternative Recommendation |
| :--- | :--- | :--- |
| `char` | C# `char` is UTF-16 (2 bytes), C/Rust `char` is UTF-8 (1 byte). | Use `byte` or `string` instead. |
| `decimal` | Lacks native hardware CPU/FPU operations. | Use `double` or scale integers (fixed-point). |
| `DateTime` | Platform/locale dependent serialization. | Use `long` (Ticks) or `ulong` (Unix epoch seconds). |
| `Guid` | Complex layout and different formatting standards. | Use `Bytes16` or two `ulong` fields. |
| `Nullable<T>` | Requires wrapper heap object allocations. | Use a sentinel value (e.g., `-1`, `0`, or `uint.MaxValue`). |
| Arrays / lists | Dynamic heap references cannot be flat-serialized easily. | Use fixed-size fields or offsets. |

---

## 3. Packet Definition Rules

C# classes serving as packet models must follow these structuring directives:
* **Class Attributes:** Must decorate the class with `[Packet]`. The class must inherit `PacketBase<TSelf>`.
* **Field Ordering:** Decided by indexing attributes:
  * `[SerializeHeader(index)]`: Order of fields serialized in the packet header (written first).
  * `[SerializeOrder(index)]`: Order of fields serialized in the packet payload body (written after header).
* **Exclusion:** Decorate private or helper fields with `[SerializeIgnore]` to skip code generation.

### Definition Example (C#)
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
}
```

---

## 4. Generated Bindings Outputs

### C Output (`packets.h`)
```c
#if defined(_MSC_VER)
    #pragma pack(push, 1)
#endif

typedef struct {
    PacketHeader _header;
    uint8_t Stage;
    uint16_t Reason;
    uint64_t SessionToken;
    Bytes32 PublicKey;
} Handshake;

#if defined(_MSC_VER)
    #pragma pack(pop)
#endif
```

### Rust Output (`packets.rs`)
```rust
#[repr(C)]
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct Handshake {
    pub _header: PacketHeader,
    pub stage: u8,
    pub reason: u16,
    pub session_token: u64,
    pub public_key: [u8; 32],
}
```
