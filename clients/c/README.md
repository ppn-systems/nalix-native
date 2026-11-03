# Nalix Native C Client SDK

The Nalix C Client SDK provides a high-performance, modular C99 transport session architecture matching Nalix C# and TypeScript implementations for embedded systems (ESP-IDF, FreeRTOS, STM32) and native POSIX/Windows applications.

## Architecture (DDD, SOLID, SRP)

- **Domain Entities & Value Objects:**
  - `nalix/status.h`: 17 canonical status codes (0..16) matching Nalix .NET, Rust, and TS.
  - `nalix/protocol.h`: Standard protocol OpCodes (`SessionInit`, `SessionChallenge`, `SessionProof`, `SessionEstablished`, `Control`, `Directive`, etc.).
  - `nalix/packet.h`: Nalix v14 6-byte Little-Endian binary header and flags (`COMPRESSED = 0x02`, `ENCRYPTED = 0x04`, `FRAGMENTED = 0x08`).
  - `nalix/channel.h`: Channel connectivity lifecycle state machine (`IDLE`, `CONNECTING`, `READY`, `TRANSIENT_FAILURE`, `SHUTDOWN`).
- **Domain Services:**
  - `nalix/compression.h` / `src/compression.c`: LZ4 block compression with 8-byte Little-Endian header (`originalLength`, `compressedLength`) and 12.5% gain threshold check (`compLen <= origLen - (origLen >> 3)`). Powered by Yann Collet's LZ4.
  - `nalix/security.h` / `src/security.c`: ChaCha20-Poly1305 AEAD envelope cipher with 12-byte header (`0x584C414E` `"NALX"`), 12-byte nonce, 16-byte MAC, and 24-byte AAD (`Header || Nonce`). Powered by audited Monocypher.
  - `nalix/handshake.h` / `src/handshake.c`: Authenticated X25519 Diffie-Hellman key exchange, 144-byte transcript hashing via Keccak-256, and HKDF-Keccak256 proof generation/verification matching Nalix C#.
  - `nalix/pipeline.h` / `src/pipeline.c`: Outbound and inbound pipeline processing orchestrating automatic sequenceId stamping, LZ4 compression, and ChaCha20-Poly1305 AEAD envelope encryption.
  - `nalix/session.h` / `src/session.c`: Transport session lifecycle management matching `TcpSession` / `TransportSession` from Nalix C#.

## Quick Start

```c
#include "nalix/nalix.h"

// 1. Initialize session configuration
nalix_channel_config_t config = nalix_channel_config_default("127.0.0.1", 57200);
config.allow_tofu = true;

nalix_session_t session;
nalix_session_init(&session, &config, NULL);

// 2. Connect
if (nalix_status_is_ok(&nalix_session_connect(&session))) {
    // 3. Authenticate via X25519 DH Handshake
    nalix_handshake_result_t auth;
    if (nalix_status_is_ok(&nalix_session_handshake(&session, &auth))) {
        // Outbound packets are now automatically compressed and encrypted!
        const uint8_t payload[] = "Hello Secure Nalix";
        nalix_packet_t pkt = nalix_packet_create(0x0100, payload, sizeof(payload));
        nalix_session_send(&session, &pkt);
    }

    // 4. Disconnect
    nalix_session_disconnect(&session);
}

nalix_session_destroy(&session);
```

## Compilation & Tests

```bash
# Direct GCC Compilation
gcc -Wall -Wextra -Werror -Iclients/c/include -Iclients/c/src \
  clients/c/src/status.c \
  clients/c/src/packet.c \
  clients/c/src/compression.c \
  clients/c/src/security.c \
  clients/c/src/handshake.c \
  clients/c/src/pipeline.c \
  clients/c/src/session.c \
  clients/c/src/third_party/lz4/lz4.c \
  clients/c/src/third_party/monocypher/monocypher.c \
  clients/c/src/third_party/keccak/keccak256.c \
  clients/c/tests/session_test.c \
  -o session_test
./session_test
```
