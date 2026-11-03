#ifndef NALIX_SECURITY_H
#define NALIX_SECURITY_H

#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>
#include "nalix/status.h"

#ifdef __cplusplus
extern "C" {
#endif

#define NALIX_ENVELOPE_MAGIC 0x584C414EU /* "NALX" */
#define NALIX_ENVELOPE_VERSION 1
#define NALIX_ENVELOPE_TYPE_CHACHA20_POLY1305 8
#define NALIX_NONCE_SIZE 12
#define NALIX_TAG_SIZE 16
#define NALIX_ENVELOPE_HEADER_SIZE 12
#define NALIX_ENVELOPE_OVERHEAD (NALIX_ENVELOPE_HEADER_SIZE + NALIX_NONCE_SIZE + NALIX_TAG_SIZE) /* 40 bytes */

#if defined(__GNUC__) || defined(__clang__)
#define NALIX_PACKED __attribute__((packed))
#else
#define NALIX_PACKED
#endif

#pragma pack(push, 1)
/**
 * @brief Nalix AEAD envelope header (12 bytes Little-Endian).
 */
typedef struct NALIX_PACKED nalix_envelope_header {
    uint32_t magic;      /* 0x584C414E ("NALX") */
    uint8_t version;     /* 1 */
    uint8_t type;        /* 8: ChaCha20-Poly1305 */
    uint8_t flags;       /* 0 */
    uint8_t nonce_len;   /* 12 */
    uint32_t sequence;   /* 32-bit sequence counter (Little-Endian) */
} nalix_envelope_header_t;
#pragma pack(pop)

/**
 * @brief Encrypts plaintext into a Nalix ChaCha20-Poly1305 AEAD envelope.
 * Layout of destination:
 *   [Header: 12B][Nonce: 12B][Ciphertext: plaintext_len][Tag: 16B]
 * AAD:
 *   [Header: 12B][Nonce: 12B] (24 bytes)
 *
 * @param key 32-byte symmetric session secret key.
 * @param envelope_seq 32-bit envelope sequence counter.
 * @param plaintext Plaintext payload to encrypt.
 * @param plaintext_len Length of plaintext payload.
 * @param dst Destination buffer.
 * @param dst_capacity Capacity of destination buffer (must be >= plaintext_len + 40).
 * @param out_len Number of bytes written into dst.
 * @return nalix_status_t NALIX_STATUS_OK on success.
 */
nalix_status_t nalix_encrypt_envelope(
    const uint8_t key[32],
    uint32_t envelope_seq,
    const uint8_t* plaintext,
    size_t plaintext_len,
    uint8_t* dst,
    size_t dst_capacity,
    size_t* out_len
);

/**
 * @brief Decrypts a Nalix ChaCha20-Poly1305 AEAD envelope.
 *
 * @param key 32-byte symmetric session secret key.
 * @param envelope Raw envelope buffer starting with nalix_envelope_header_t.
 * @param envelope_len Total length of envelope buffer.
 * @param dst Destination buffer for decrypted plaintext.
 * @param dst_capacity Capacity of destination buffer.
 * @param out_len Number of decrypted plaintext bytes written into dst.
 * @return nalix_status_t NALIX_STATUS_OK on success, or NALIX_STATUS_UNAUTHENTICATED on MAC mismatch.
 */
nalix_status_t nalix_decrypt_envelope(
    const uint8_t key[32],
    const uint8_t* envelope,
    size_t envelope_len,
    uint8_t* dst,
    size_t dst_capacity,
    size_t* out_len
);

#ifdef __cplusplus
}
#endif

#endif /* NALIX_SECURITY_H */
