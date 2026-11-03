# Protogen Specification & Type Mapping

This document details the binary wire specification, type mappings, and packet definition rules for the **Protogen** code generator targeting **Nalix v14+**.

---

## 1. Nalix v14 Binary Wire Format

All communication frames transmitted over the wire adhere to the Nalix v14 specification:

```plaintext
+---------------------------------------------------------------------------------+
|                                 Packet Header (6 Bytes)                         |
+------------------------+-------------------+--------------------+---------------+
| OpCode (2 Bytes, LE)   | Flags (1 Byte)    | Priority (1 Byte)  | SeqId (2B, LE)|
+------------------------+-------------------+--------------------+---------------+
|                                    Payload Data                                 |
+---------------------------------------------------------------------------------+
```

### Header Structure

| Field | Type | Size | Endianness | Description |
| :--- | :--- | :--- | :--- | :--- |
| `OpCode` | `uint16_t` / `u16` | 2 bytes | Little-Endian | Static packet type identifier. |
| `Flags` | `uint8_t` / `u8` | 1 byte | - | Packet control flags (e.g. Reliable, System). |
| `Priority` | `uint8_t` / `u8` | 1 byte | - | Delivery priority level. |
| `SequenceId` | `uint16_t` / `u16` | 2 bytes | Little-Endian | Packet tracking sequence counter. |

> [!IMPORTANT]
> Nalix v14 uses a 6-byte header with a 16-bit `OpCode`. The legacy 4-byte FNV-1a Magic Number from v12 has been completely deprecated and removed from the wire format.

---

## 2. Type Mapping Contract

To guarantee byte-for-byte wire interoperability across .NET, C, and Rust runtimes, types map as follows:

### A. Primitive Types

| C# Type | C Type (C99) | Rust Type | Size (Bytes) | Wire Encoding |
| :--- | :--- | :--- | :--- | :--- |
| `byte` | `uint8_t` | `u8` | 1 | Unsigned 8-bit |
| `sbyte` | `int8_t` | `i8` | 1 | Signed 8-bit two's complement |
| `bool` | `uint8_t` | `u8` | 1 | 0 = false, 1 = true |
| `short` | `int16_t` | `i16` | 2 | Little-Endian signed 16-bit |
| `ushort` | `uint16_t` | `u16` | 2 | Little-Endian unsigned 16-bit |
| `int` | `int32_t` | `i32` | 4 | Little-Endian signed 32-bit |
| `uint` | `uint32_t` | `u32` | 4 | Little-Endian unsigned 32-bit |
| `long` | `int64_t` | `i64` | 8 | Little-Endian signed 64-bit |
| `ulong` | `uint64_t` | `u64` | 8 | Little-Endian unsigned 64-bit |
| `float` | `float` | `f32` | 4 | IEEE 754 single-precision float |
| `double` | `double` | `f64` | 8 | IEEE 754 double-precision float |
| `Enum` | Underlying type | Underlying type | 1, 2, 4, or 8 | Encoded as the underlying integral type |

### B. Special & Complex Types

| C# Type | C Type | Rust Type | Size | Wire Layout |
| :--- | :--- | :--- | :--- | :--- |
| `Bytes32` | `Bytes32` | `[u8; 32]` | 32 bytes | Continuous byte array (`uint8_t data[32]`) |
| `PacketHeader` | `PacketHeader` | `PacketHeader` | 6 bytes | Packed struct: `OpCode: 2`, `Flags: 1`, `Priority: 1`, `SequenceId: 2` |
| `string` | `NalixString` | `Vec<u8>` | 4 + N bytes | `[int32_t length][utf-8 bytes]` |
| `ReadOnlyMemory<byte>` | `NalixString` | `Vec<u8>` | 4 + N bytes | `[int32_t length][raw bytes]` |

#### Length-Prefixed Fields (Strings & Byte Arrays)
* Wire representation begins with a signed 32-bit integer length prefix (`int32_t` in little-endian order).
* `length = -1`: Indicates `null`. No payload bytes follow.
* `length = 0`: Indicates empty string `""` or zero-length buffer. No payload bytes follow.
* `length > 0`: Exactly `length` bytes follow.
* In C, deserialization allocates heap memory via `malloc()`. The caller is responsible for freeing it with the generated `<packet>_free(&pkt)` function.

---

## 3. C# Packet Definition Guidelines

C# classes defining protocol messages must follow these rules:

1. **Packet Identification:** Decorate the class with `[NalixPacket]` or `[Packet]`.
2. **OpCode Definition:** Define the constant `StaticOpCode` or implement `IPacketStaticOpcode`:
   ```csharp
   public const ushort StaticOpCode = 0x0001;
   ```
3. **Base Class Inheritance:** Inherit `PacketBase<TSelf>`. Protogen detects this inheritance and automatically prepends `PacketHeader` at offset 0.
4. **Field Ordering:** Decorate fields or properties with:
   * `[SerializeHeader(n)]`: Serialized before payload fields.
   * `[SerializeOrder(n)]`: Serialized sequentially by ascending index `n`.
5. **Ignoring Fields:** Decorate non-serialized internal helpers with `[SerializeIgnore]`.

### Example C# Definition

```csharp
[Packet]
public sealed class Control : PacketBase<Control>, IPacketStaticOpcode
{
    public const ushort StaticOpCode = 0x0001;

    [SerializeOrder(0)]
    public ushort Reason { get; set; }

    [SerializeOrder(1)]
    public byte Type { get; set; }
}
```

### Generated C Output (`packets.h`)

```c
#define PACKET_CONTROL_OPCODE 0x0001U
#define CONTROL_SIZE 9

typedef struct {
    PacketHeader header;
    uint16_t reason;
    uint8_t type;
} Control;

void control_init(Control* pkt);
size_t control_serialize(const Control* pkt, uint8_t* buffer, size_t buffer_size);
size_t control_deserialize(Control* pkt, const uint8_t* buffer, size_t buffer_size);
```

### Generated Rust Output (`packets.rs`)

```rust
/// Control - wire size: 9 bytes, opcode: 0x0001
#[repr(C)]
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct Control {
    pub header: PacketHeader,
    pub reason: u16,
    pub r#type: u8,
}

impl Control {
    pub const FIXED_SIZE: usize = 9;
    pub const OPCODE: u16 = 0x0001;

    pub fn serialize(&self, buf: &mut [u8]) -> Result<usize, ()> { ... }
    pub fn deserialize(buf: &[u8]) -> Result<Self, ()> { ... }
}
```
