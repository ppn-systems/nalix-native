# NXProto Integration Guide

## 1. Embedded C & ESP-IDF Integration

The generated C output complies with ANSI C99 and standard library requirements (`<stdint.h>`, `<stddef.h>`, `<stdbool.h>`, `<string.h>`, `<stdlib.h>`). It requires no third-party libraries or external dependencies.

### 1.1 Project Layout (ESP-IDF)

Place the generated source files within a component directory or in the `main` directory of your ESP-IDF firmware project:

```plaintext
esp32_firmware/
├── CMakeLists.txt
└── main/
    ├── CMakeLists.txt
    ├── main.c
    ├── include/
    │   └── packets.h         # Generated C header
    └── src/
        └── packets.c         # Generated C implementation
```

#### `main/CMakeLists.txt`
```cmake
idf_component_register(
    SRCS "main.c" "src/packets.c"
    INCLUDE_DIRS "include"
)
```

---

### 1.2 Packet Transmission (Serialization)

Use the generated `<packet>_init()` function to initialize the packet structure and set its default `OpCode`.

```c
#include "packets.h"
#include "esp_log.h"
#include <string.h>

static const char *TAG = "NET_CLIENT";

void send_control_packet(int socket_fd)
{
    Control pkt;
    // Initializes memory to zero and assigns pkt.Header.OpCode = PACKET_CONTROL_OPCODE
    control_init(&pkt);

    // Populate header fields
    pkt.Header.Flags = 0x01;       // Reliable flag
    pkt.Header.Priority = 0x02;    // QoS priority
    pkt.Header.SequenceId = 1001;

    // Populate payload fields
    pkt.Reason = 200;
    pkt.Type = 1;

    // Buffer allocation using compile-time constant size
    uint8_t tx_buf[CONTROL_SIZE];
    size_t bytes_written = control_serialize(&pkt, tx_buf, sizeof(tx_buf));

    if (bytes_written > 0) {
        send(socket_fd, tx_buf, bytes_written, 0);
        ESP_LOGI(TAG, "Transmitted Control packet (%d bytes)", (int)bytes_written);
    } else {
        ESP_LOGE(TAG, "Serialization failed: buffer too small");
    }
}
```

---

### 1.3 Packet Reception and Dispatching

The standard dispatching pattern deserializes the 6-byte `PacketHeader` first, then routes the frame based on its 16-bit `OpCode`:

```c
#include "packets.h"
#include "esp_log.h"

void process_incoming_frame(const uint8_t *rx_buf, size_t rx_len)
{
    if (rx_len < PACKET_HEADER_SIZE) {
        ESP_LOGW(TAG, "Frame truncated: smaller than header size (%d bytes)", PACKET_HEADER_SIZE);
        return;
    }

    PacketHeader header;
    if (packet_header_deserialize(&header, rx_buf, rx_len) == 0) {
        ESP_LOGE(TAG, "Failed to parse packet header");
        return;
    }

    switch (header.OpCode) {
        case PACKET_CONTROL_OPCODE: {
            Control pkt;
            if (control_deserialize(&pkt, rx_buf, rx_len) > 0) {
                ESP_LOGI(TAG, "Received Control: reason=%u, type=%u", pkt.Reason, pkt.Type);
            }
            break;
        }

        case PACKET_TIMESYNC_OPCODE: {
            TimeSync pkt;
            if (time_sync_deserialize(&pkt, rx_buf, rx_len) > 0) {
                ESP_LOGI(TAG, "Received TimeSync: ticks=%lld", (long long)pkt.ClientSendTicks);
            }
            break;
        }

        default:
            ESP_LOGW(TAG, "Unhandled OpCode: 0x%04X", header.OpCode);
            break;
    }
}
```

---

### 1.4 Dynamic Memory Management for Strings

For packets that contain variable-length string or binary data (`NalixString`), deserialization allocates heap memory via `malloc()`.

To prevent memory leaks and heap fragmentation on microcontrollers, call `<packet>_free()` once processing is complete:

```c
void process_telemetry_frame(const uint8_t *buf, size_t len)
{
    TelemetryMessage pkt;
    if (telemetry_message_deserialize(&pkt, buf, len) > 0) {
        if (pkt.Message.data != NULL && pkt.Message.length > 0) {
            ESP_LOGI(TAG, "Telemetry: %.*s", (int)pkt.Message.length, (char*)pkt.Message.data);
        }

        // Deallocate heap-allocated string payload
        telemetry_message_free(&pkt);
    }
}
```

---

### 1.5 Alignment Constraints on Embedded Architectures

Microcontrollers utilizing Xtensa (ESP32, ESP8266) or ARM Cortex-M0/M3 processors generate unaligned access hardware faults if multi-byte integers are dereferenced from odd memory addresses.

Protogen serializers use sequential bitshift decoding:
```c
uint16_t val = (uint16_t)(ptr[0] | ((uint16_t)ptr[1] << 8));
```
This routine does not require memory alignment, allowing incoming frames to be parsed directly from raw network ring buffers or DMA memory regions.

---

## 2. Embedded Cryptographic Handshake

When establishing authenticated sessions with a Nalix v14 server:

- **Monocypher:** For resource-constrained devices (ESP8266, STM32, Cortex-M0), Monocypher provides Blake2b, ChaCha20-Poly1305, and X25519 key exchange in approximately 2 KB ROM with zero dynamic memory allocation.
- **mbedTLS (ESP-IDF):** On ESP32, utilize the hardware-accelerated SHA-256 and AES-GCM engines exposed through ESP-IDF's native `mbedtls` component.

---

## 3. Rust Integration

### 3.1 Cargo Configuration

Include the generated modules in your Rust library or binary:

```plaintext
rust_service/
├── Cargo.toml
└── src/
    ├── lib.rs
    ├── packets.rs         # Generated Rust module
    └── packets_tests.rs   # Generated round-trip tests
```

#### `src/lib.rs`
```rust
pub mod packets;
```

---

### 3.2 Serialization & Deserialization

```rust
use packets::{Control, PacketHeader};

pub fn build_control_frame() -> Result<[u8; Control::FIXED_SIZE], ()> {
    let mut pkt = Control::default();
    pkt.header.op_code = Control::OPCODE;
    pkt.header.flags = 0x01;
    pkt.reason = 200;
    pkt.r#type = 1;

    let mut buffer = [0u8; Control::FIXED_SIZE];
    pkt.serialize(&mut buffer)?;
    Ok(buffer)
}

pub fn handle_packet(bytes: &[u8]) -> Result<(), ()> {
    let header = PacketHeader::deserialize(bytes)?;

    match header.op_code {
        Control::OPCODE => {
            let pkt = Control::deserialize(bytes)?;
            println!("Control packet received: reason={}", pkt.reason);
        }
        _ => {
            println!("Unrecognized OpCode: {:#06X}", header.op_code);
        }
    }

    Ok(())
}
```
