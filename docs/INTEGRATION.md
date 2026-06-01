# Nalix Protogen Integration Guide

This guide describes how to integrate the generated C and Rust protocol bindings into your applications.

---

## 1. C Integration Guide

### A. File Setup & Compilation
1. Copy the generated files to your source tree:
   * **Headers:** Copy `packets.h` into your `include/` directory.
   * **Source:** Copy `packets.c` into your `src/` directory.
2. Ensure your build system includes the header path (e.g., `-Iinclude`) and compiles `packets.c` alongside your code.
   ```bash
   gcc -Iinclude -o my_app src/main.c src/packets.c
   ```

### B. Serialization (Writing Packets)
To serialize a structure, allocate a buffer of at least `XXX_SIZE` (which is `#define`d in the header), fill the fields, and call the serialize function:

```c
#include "packets.h"
#include <stdio.h>

void send_access_request(void)
{
    ObservabilityAccess pkt;
    memset(&pkt, 0, sizeof(pkt));

    // 1. Initialize packet header (Magic number is set automatically by sender if desired)
    pkt.Header.MagicNumber = PACKET_OBSERVABILITYACCESS;
    pkt.Header.OpCode = 0x0B;
    pkt.Header.Flags = 0x03; // RELIABLE | SYSTEM
    pkt.Header.Priority = 0x02; // URGENT
    pkt.Header.SequenceId = 120;

    // 2. Initialize payload fields
    pkt.Stage = 0x01; // REQUEST
    pkt.Reason = 0;   // NONE
    pkt.AccessLevel = 0; // NONE
    
    // Assign 32-byte hash
    Bytes32 key = {{ 0xAA, 0xBB, 0xCC }};
    pkt.AccessKey = key;

    // 3. Serialize into buffer
    uint8_t buffer[OBSERVABILITYACCESS_SIZE];
    size_t bytes_written = observabilityaccess_serialize(&pkt, buffer, sizeof(buffer));

    if (bytes_written == 0) {
        printf("Serialization failed! Buffer too small.\n");
        return;
    }

    // Send 'buffer' containing 'bytes_written' over the network...
}
```

### C. Deserialization (Reading Packets)
When receiving bytes from the wire, call the deserialize function:

```c
#include "packets.h"
#include <stdio.h>

void handle_received_packet(const uint8_t* net_buffer, size_t net_buffer_size)
{
    // Ensure we have at least the minimum static size
    if (net_buffer_size < OBSERVABILITYACCESS_SIZE) {
        printf("Packet too short!\n");
        return;
    }

    ObservabilityAccess pkt;
    memset(&pkt, 0, sizeof(pkt));

    size_t bytes_read = observabilityaccess_deserialize(&pkt, net_buffer, net_buffer_size);
    if (bytes_read == 0) {
        printf("Deserialization failed (malformed payload or buffer overflow).\n");
        return;
    }

    // Access packet fields
    if (pkt.Header.MagicNumber == PACKET_OBSERVABILITYACCESS) {
        printf("Received access packet. Stage: %d, Access Level: %d\n", pkt.Stage, pkt.AccessLevel);
    }
}
```

### D. ⚠️ Memory Management & Freeing
If a packet contains variable-sized fields (like `NalixString` mapped from C# `string` or `ReadOnlyMemory<byte>`), **deserialization performs dynamic memory allocation (`malloc`)** for the payload bytes. 

To prevent memory leaks, you **must call the corresponding `xxx_free` helper** when you are done with the packet:

```c
void process_observation_response(const uint8_t* buf, size_t size)
{
    RuntimeObservation pkt;
    memset(&pkt, 0, sizeof(pkt));

    if (runtimeobservation_deserialize(&pkt, buf, size) > 0) {
        // Safe to read observation data
        if (pkt.ObservationData.length > 0) {
            printf("Data: %s\n", (char*)pkt.ObservationData.data);
        }

        // CRITICAL: Free dynamic string/byte memory allocated by deserialize
        runtimeobservation_free(&pkt);
    }
}
```

---

## 2. Rust Integration Guide

### A. Including Generated Packets
Copy the generated file `packets.rs` to your project (usually inside `src/`) and reference it in `lib.rs` or `main.rs`:

```rust
pub mod packets;

use packets::{ObservabilityAccess, PacketHeader};
```

### B. Serialization
Use the `.serialize()` method on any packet struct. The buffer must be large enough to hold the fixed size (and dynamic payloads if variable size):

```rust
use packets::{ObservabilityAccess, PacketHeader};

fn run_serialization() -> Result<(), ()> {
    let mut pkt = ObservabilityAccess::default();
    
    // Fill header
    pkt.header.magic_number = ObservabilityAccess::MAGIC;
    pkt.header.op_code = 0x0B;
    pkt.header.sequence_id = 42;

    // Fill fields
    pkt.stage = 2; // RESPONSE
    pkt.access_level = 4; // ADMIN
    pkt.access_key = [0x55u8; 32];

    // Allocate buffer
    let mut buf = [0u8; ObservabilityAccess::FIXED_SIZE];
    let bytes_written = pkt.serialize(&mut buf)?;
    
    assert_eq!(bytes_written, ObservabilityAccess::FIXED_SIZE);
    // 'buf' is now ready to send
    Ok(())
}
```

### C. Deserialization
Call the static `::deserialize()` method passing a byte slice:

```rust
use packets::ObservabilityAccess;

fn handle_incoming_bytes(buf: &[u8]) {
    match ObservabilityAccess::deserialize(buf) {
        Ok(pkt) => {
            println!("Parsed packet! Stage={}, Key={:?}", pkt.stage, pkt.access_key);
        }
        Err(_) => {
            println!("Failed to deserialize packet (malformed or short buffer).");
        }
    }
}
```

### D. Variable-Size Packets (e.g., `Vec<u8>`)
When a packet contains dynamic types (mapped as `Vec<u8>`), the serialized size changes dynamically. Ensure you allocate a larger buffer or a dynamic vector before serializing:

```rust
use packets::RuntimeObservation;

fn serialize_variable_packet(observation_payload: Vec<u8>) -> Result<Vec<u8>, ()> {
    let mut pkt = RuntimeObservation::default();
    pkt.stage = 2;
    pkt.observation_data = observation_payload; // Vec<u8>

    // Allocate buffer with overhead space
    let mut buf = vec![0u8; RuntimeObservation::FIXED_SIZE + pkt.observation_data.len()];
    let bytes_written = pkt.serialize(&mut buf)?;
    
    // Truncate to size actually written
    buf.truncate(bytes_written);
    Ok(buf)
}
```
