#ifndef NALIX_HANDSHAKE_H
#define NALIX_HANDSHAKE_H

#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>
#include "nalix/status.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef struct nalix_session nalix_session_t;

/**
 * @brief Handshake result containing derived session keys and authenticated parameters.
 */
typedef struct nalix_handshake_result {
    uint8_t session_key[32];
    uint64_t session_token;
    uint8_t server_public_key[32];
} nalix_handshake_result_t;

/**
 * @brief Composes 144-byte transcript buffer and computes Keccak-256 hash.
 */
void nalix_handshake_compute_transcript_hash(
    const uint8_t client_public_key[32],
    const uint8_t client_nonce[32],
    const uint8_t server_public_key[32],
    const uint8_t server_nonce[32],
    uint8_t transcript_hash[32]
);

/**
 * @brief Combines ephemeral-ephemeral and static-ephemeral shared secrets into master secret.
 */
void nalix_handshake_compute_master_secret(
    const uint8_t shared_secret_ee[32],
    const uint8_t shared_secret_se[32],
    uint8_t master_secret[32]
);

/**
 * @brief Computes expected server proof for challenge verification.
 */
void nalix_handshake_compute_server_proof(
    const uint8_t master_secret[32],
    const uint8_t transcript_hash[32],
    uint8_t proof[32]
);

/**
 * @brief Computes client proof for SessionProof message.
 */
void nalix_handshake_compute_client_proof(
    const uint8_t master_secret[32],
    const uint8_t transcript_hash[32],
    uint8_t proof[32]
);

/**
 * @brief Computes server finish proof for SessionEstablished verification.
 */
void nalix_handshake_compute_server_finish_proof(
    const uint8_t master_secret[32],
    const uint8_t transcript_hash[32],
    uint8_t proof[32]
);

/**
 * @brief Derives final symmetric 32-byte session key.
 */
void nalix_handshake_derive_session_key(
    const uint8_t master_secret[32],
    const uint8_t client_nonce[32],
    const uint8_t server_nonce[32],
    const uint8_t transcript_hash[32],
    uint8_t session_key[32]
);

/**
 * @brief Performs complete synchronous X25519 authenticated DH handshake over active session socket.
 */
nalix_status_t nalix_handshake_perform(
    nalix_session_t* session,
    const uint8_t* pinned_server_key,
    bool allow_tofu,
    uint32_t timeout_ms,
    nalix_handshake_result_t* result
);

#ifdef __cplusplus
}
#endif

#endif /* NALIX_HANDSHAKE_H */
