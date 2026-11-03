# Protogen Integration Guide (ESP32, Microcontrollers & Rust)

This guide walks you through integrating Protogen-generated **C** and **Rust** protocol code into embedded targets (ESP32, ESP8266, STM32, Arduino) and native servers.

---

## 1. Embedded C & ESP-IDF Integration

The generated C code complies with ANSI C99, requires only standard C headers (`<stdint.h>`, `<stddef.h>`, `<string.h>`, `<stdlib.h>`), and has zero external library dependencies.

### A. ESP-IDF Component Structure

Place the generated files into an ESP-IDF component or your `main` directory:

```plaintext
my_esp32_project/
├── CMakeLists.txt
└── main/
    ├── CMakeLists.txt
    ├── main.c
    ├── include/
    │   └── packets.h         <-- Generated C header
    └── src/
        └── packets.c         <-- Generated C implementation
```

#### `main/CMakeLists.txt`
```cmake
idf_component_register(
    SRCS "main.c" "src/packets.c"
    INCLUDE_DIRS "include"
)
```

---

### B. Sending a Packet (Serialization)

Use the `<packet>_init()` function to initialize the struct and assign its default `OpCode`. Then fill the payload fields and serialize:

```c
#include "packets.h"
#include "esp_log.h"
#include <string.h>

static const char *TAG = "NET_CLIENT";

void send_control_packet(int socket_fd)
{
    Control pkt;
    // 1. Initialize struct and assign pkt.header.op_code = PACKET_CONTROL_OPCODE
    control_init(&pkt);

    // 2. Set header flags and sequence tracking
    pkt.header.flags = 0x01; // RELIABLE
    pkt.header.priority = 0x02; // URGENT
    pkt.header.sequence_id = 101;

    // 3. Set payload fields
    pkt.reason = 200; // OK
    pkt.type = 1;     // PING

    // 4. Allocate transmission buffer using compile-time FIXED_SIZE
    uint8_t tx_buf[CONTROL_SIZE];
    size_t written = control_serialize(&pkt, tx_buf, sizeof(tx_buf));

    if (written > 0) {
        // Send tx_buf over TCP/UDP/WebSocket socket
        send(socket_fd, tx_buf, written, 0);
        ESP_LOGI(TAG, "Sent Control packet (%d bytes)", (int)written);
    } else {
        ESP_LOGE(TAG, "Failed to serialize Control packet");
    }
}
```

---

### C. Receiving and Dispatching Incoming Packets

Read the first 6 bytes into `PacketHeader` to inspect the `OpCode`, then deserialize the specific packet payload:

```c
#include "packets.h"
#include "esp_log.h"

void handle_incoming_network_stream(const uint8_t *rx_buf, size_t rx_len)
{
    // 1. Verify minimum frame length for the 6-byte header
    if (rx_len < PACKET_HEADER_SIZE) {
        ESP_LOGW(TAG, "Incomplete packet header");
        return;
    }

    // 2. Read packet header to inspect the OpCode
    PacketHeader header;
    if (packet_header_deserialize(&header, rx_buf, rx_len) == 0) {
        ESP_LOGE(TAG, "Malformed packet header");
        return;
    }

    // 3. Dispatch packet based on 16-bit OpCode
    switch (header.op_code) {
        case PACKET_CONTROL_OPCODE: {
            Control pkt;
            if (control_deserialize(&pkt, rx_buf, rx_len) > 0) {
                ESP_LOGI(TAG, "Received Control: reason=%u, type=%u", pkt.reason, pkt.type);
            }
            break;
        }

        case PACKET_TIMESYNC_OPCODE: {
            TimeSync pkt;
            if (time_sync_deserialize(&pkt, rx_buf, rx_len) > 0) {
                ESP_LOGI(TAG, "TimeSync client_ticks=%lld", (long long)pkt.client_send_ticks);
            }
            break;
        }

        default:
            ESP_LOGW(TAG, "Unknown OpCode: 0x%04X", header.op_code);
            break;
    }
}
```

---

### D. Variable-Length Fields & Memory Management

For packets containing variable-length `string` or `ReadOnlyMemory<byte>` fields:
* Deserialization dynamically allocates memory with `malloc()` to store the payload bytes.
* Always call `<packet>_free(&pkt)` when finished with the packet to prevent heap fragmentation or memory leaks on microcontrollers.

```c
void process_variable_packet(const uint8_t *buf, size_t len)
{
    DynamicMessage pkt;
    if (dynamic_message_deserialize(&pkt, buf, len) > 0) {
        if (pkt.payload.data != NULL) {
            ESP_LOGI(TAG, "Payload: %.*s", (int)pkt.payload.length, (char*)pkt.payload.data);
        }

        // CRITICAL: Free dynamically allocated payload memory
        dynamic_message_free(&pkt);
    }
}
```

---

### E. Microcontroller Alignment Safety

Microcontrollers with **Xtensa** (ESP32, ESP8266) or **ARM Cortex-M0/M3** cores trigger hardware exceptions when accessing multi-byte integers from unaligned memory addresses.

Protogen's generated C serializer uses **sequential bitshift decoding**:
```c
uint16_t val = (uint16_t)(ptr[0] | ((uint16_t)ptr[1] << 8));
```
This guarantees 100% alignment safety regardless of where `rx_buf` is placed in SRAM.

---

## 2. Cryptographic Handshake on Microcontrollers

If your ESP32 client connects to a Nalix server requiring session establishment (Proof-of-Work, Diffie-Hellman Key Exchange, HMAC verification):

* **Built-in `mbedtls` (ESP-IDF):** Use ESP-IDF's hardware-accelerated `mbedtls` for SHA-256 and AES-GCM.
* **Monocypher:** For lightweight embedded devices, [Monocypher](https://monocypher.org/) offers a compact (~2KB ROM), zero-heap library implementing:
  * Blake2b hashing (for Proof-of-Work verification).
  * X25519 key exchange (for ECDH session keys).
  * ChaCha20-Poly1305 (for AEAD encryption).

---

## 3. Rust Integration Guide

### A. Setup in `Cargo.toml`

Add the generated module to your Rust project:

```plaintext
my_rust_service/
├── Cargo.toml
└── src/
    ├── main.rs
    ├── packets.rs         <-- Generated Rust module
    └── packets_tests.rs   <-- Generated round-trip tests
```

In `src/main.rs` or `src/lib.rs`:

```rust
pub mod packets;
use packets::{Control, PacketHeader};
```

---

### B. Serialization & Deserialization

```rust
use packets::{Control, PacketHeader};

fn send_packet() -> Result<Vec<u8>, ()> {
    let mut pkt = Control::default();
    pkt.header.op_code = Control::OPCODE;
    pkt.header.flags = 0x01;
    pkt.reason = 200;
    pkt.r#type = 1;

    let mut buf = vec![0u8; Control::FIXED_SIZE];
    pkt.serialize(&mut buf)?;

    Ok(buf)
}

fn handle_incoming(buf: &[u8]) -> Result<(), ()> {
    let header = PacketHeader::deserialize(buf)?;

    match header.op_code {
        Control::OPCODE => {
            let pkt = Control::deserialize(buf)?;
            println!("Received Control: reason={}, type={}", pkt.reason, pkt.r#type);
        }
        _ => {
            println!("Unknown OpCode: {:#06X}", header.op_code);
        }
    }

    Ok(())
}
```
