# Nalix Native C Client SDK

The Nalix C Client SDK provides a lightweight, zero-dependency C99 transport session architecture for embedded systems (ESP-IDF, FreeRTOS, STM32) and native POSIX/Windows applications.

## Architecture

- **Status Model (`nalix/status.h`):** 17 canonical status codes (0..16) matching Nalix .NET and Rust.
- **Wire Framing (`nalix/packet.h`):** Nalix v14 6-byte Little-Endian binary header with endian-safe serialization.
- **Channel State Machine (`nalix/channel.h`):** Connectivity state management (`IDLE`, `CONNECTING`, `READY`, `TRANSIENT_FAILURE`, `SHUTDOWN`).
- **Session Architecture (`nalix/session.h`):** Session initialization, asynchronous callbacks, dispatch, and lifecycle matching `TcpSession` / `TransportSession` from Nalix C#.

## Quick Start

```c
#include "nalix/nalix.h"

// Initialize session
nalix_channel_config_t config = nalix_channel_config_default("127.0.0.1", 57200);
nalix_session_t session;
nalix_session_init(&session, &config, NULL);

// Connect
if (nalix_status_is_ok(&nalix_session_connect(&session))) {
    // Send packet
    const uint8_t payload[] = "Hello Nalix";
    nalix_packet_t pkt = nalix_packet_create(0x0100, payload, sizeof(payload));
    nalix_session_send(&session, &pkt);

    // Disconnect
    nalix_session_disconnect(&session);
}

nalix_session_destroy(&session);
```

## Compilation

```bash
mkdir -p build && cd build
cmake ..
cmake --build .
ctest --output-on-failure
```
