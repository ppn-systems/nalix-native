# Nalix Native C Client SDK

The Nalix C Client SDK provides a lightweight C99 client architecture following canonical gRPC patterns for embedded systems (ESP-IDF, FreeRTOS, STM32) and native applications.

## Architecture

- **Status Model (`nalix/status.h`):** Canonical gRPC status codes (0..16) and status representation.
- **Wire Framing (`nalix/packet.h`):** Nalix v14 6-byte header with endian-safe serialization.
- **Channel State Machine (`nalix/channel.h`):** Connectivity state management (`IDLE`, `CONNECTING`, `READY`, `TRANSIENT_FAILURE`, `SHUTDOWN`).
- **Client Lifecycle (`nalix/client.h`):** Initialization, asynchronous callbacks, and dispatch.

## Compilation

```bash
# Compile library with CMake
mkdir -p build && cd build
cmake ..
cmake --build .
ctest --output-on-failure
```
