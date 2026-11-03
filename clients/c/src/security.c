#include "nalix/security.h"
#include "third_party/monocypher/monocypher.h"
#include <string.h>
#include <stdlib.h>
#include <time.h>

static void nalix_fill_random(uint8_t* dst, size_t len) {
    static int seeded = 0;
    if (!seeded) {
        srand((unsigned int)time(NULL) ^ (unsigned int)(uintptr_t)&seeded);
        seeded = 1;
    }
    for (size_t i = 0; i < len; i++) {
        dst[i] = (uint8_t)(rand() & 0xFF);
    }
}

nalix_status_t nalix_encrypt_envelope(
    const uint8_t key[32],
    uint32_t envelope_seq,
    const uint8_t* plaintext,
    size_t plaintext_len,
    uint8_t* dst,
    size_t dst_capacity,
    size_t* out_len
) {
    if (!key || !dst || !out_len) {
        return nalix_status_create(NALIX_STATUS_INVALID_ARGUMENT, "Null pointer argument");
    }

    size_t required_size = plaintext_len + NALIX_ENVELOPE_OVERHEAD;
    if (dst_capacity < required_size) {
        return nalix_status_create(NALIX_STATUS_RESOURCE_EXHAUSTED, "Destination buffer too small for envelope");
    }

    /* 1. Header (12 bytes) */
    uint8_t* header_ptr = dst;
    header_ptr[0] = (uint8_t)(NALIX_ENVELOPE_MAGIC & 0xFF);
    header_ptr[1] = (uint8_t)((NALIX_ENVELOPE_MAGIC >> 8) & 0xFF);
    header_ptr[2] = (uint8_t)((NALIX_ENVELOPE_MAGIC >> 16) & 0xFF);
    header_ptr[3] = (uint8_t)((NALIX_ENVELOPE_MAGIC >> 24) & 0xFF);
    header_ptr[4] = NALIX_ENVELOPE_VERSION;
    header_ptr[5] = NALIX_ENVELOPE_TYPE_CHACHA20_POLY1305;
    header_ptr[6] = 0; /* flags */
    header_ptr[7] = NALIX_NONCE_SIZE;
    header_ptr[8] = (uint8_t)(envelope_seq & 0xFF);
    header_ptr[9] = (uint8_t)((envelope_seq >> 8) & 0xFF);
    header_ptr[10] = (uint8_t)((envelope_seq >> 16) & 0xFF);
    header_ptr[11] = (uint8_t)((envelope_seq >> 24) & 0xFF);

    /* 2. Nonce (12 bytes): seq in first 4 bytes, random remaining 8 bytes */
    uint8_t* nonce_ptr = dst + NALIX_ENVELOPE_HEADER_SIZE;
    nonce_ptr[0] = header_ptr[8];
    nonce_ptr[1] = header_ptr[9];
    nonce_ptr[2] = header_ptr[10];
    nonce_ptr[3] = header_ptr[11];
    nalix_fill_random(nonce_ptr + 4, 8);

    /* 3. AAD: Header (12B) || Nonce (12B) = 24 bytes */
    uint8_t ad[24];
    memcpy(ad, header_ptr, 12);
    memcpy(ad + 12, nonce_ptr, 12);

    /* 4. Ciphertext (plaintext_len bytes) and Tag (16 bytes) */
    uint8_t* cipher_ptr = dst + NALIX_ENVELOPE_HEADER_SIZE + NALIX_NONCE_SIZE;
    uint8_t* tag_ptr = cipher_ptr + plaintext_len;

    crypto_aead_ctx ctx;
    crypto_aead_init_ietf(&ctx, key, nonce_ptr);
    crypto_aead_write(&ctx, cipher_ptr, tag_ptr, ad, sizeof(ad), plaintext, plaintext_len);
    crypto_wipe(&ctx, sizeof(ctx));

    *out_len = required_size;
    return nalix_status_ok();
}

nalix_status_t nalix_decrypt_envelope(
    const uint8_t key[32],
    const uint8_t* envelope,
    size_t envelope_len,
    uint8_t* dst,
    size_t dst_capacity,
    size_t* out_len
) {
    if (!key || !envelope || !dst || !out_len) {
        return nalix_status_create(NALIX_STATUS_INVALID_ARGUMENT, "Null pointer argument");
    }

    if (envelope_len < NALIX_ENVELOPE_OVERHEAD) {
        return nalix_status_create(NALIX_STATUS_INVALID_ARGUMENT, "Envelope payload too short");
    }

    /* Verify Magic (0x584C414E) */
    uint32_t magic = (uint32_t)envelope[0] |
                    ((uint32_t)envelope[1] << 8) |
                    ((uint32_t)envelope[2] << 16) |
                    ((uint32_t)envelope[3] << 24);
    if (magic != NALIX_ENVELOPE_MAGIC) {
        return nalix_status_create(NALIX_STATUS_INVALID_ARGUMENT, "Invalid envelope magic");
    }

    /* Verify Type (8 = ChaCha20-Poly1305) and NonceLen (12) */
    if (envelope[5] != NALIX_ENVELOPE_TYPE_CHACHA20_POLY1305 || envelope[7] != NALIX_NONCE_SIZE) {
        return nalix_status_create(NALIX_STATUS_INVALID_ARGUMENT, "Unsupported envelope type or nonce length");
    }

    const uint8_t* nonce_ptr = envelope + NALIX_ENVELOPE_HEADER_SIZE;
    size_t plaintext_len = envelope_len - NALIX_ENVELOPE_OVERHEAD;

    if (dst_capacity < plaintext_len) {
        return nalix_status_create(NALIX_STATUS_RESOURCE_EXHAUSTED, "Destination buffer too small for plaintext");
    }

    const uint8_t* cipher_ptr = envelope + NALIX_ENVELOPE_HEADER_SIZE + NALIX_NONCE_SIZE;
    const uint8_t* tag_ptr = cipher_ptr + plaintext_len;

    /* AAD: Header (12B) || Nonce (12B) */
    uint8_t ad[24];
    memcpy(ad, envelope, 12);
    memcpy(ad + 12, nonce_ptr, 12);

    crypto_aead_ctx ctx;
    crypto_aead_init_ietf(&ctx, key, nonce_ptr);
    int res = crypto_aead_read(&ctx, dst, tag_ptr, ad, sizeof(ad), cipher_ptr, plaintext_len);
    crypto_wipe(&ctx, sizeof(ctx));

    if (res != 0) {
        return nalix_status_create(NALIX_STATUS_UNAUTHENTICATED, "AEAD tag verification failed: ciphertext tampered");
    }

    *out_len = plaintext_len;
    return nalix_status_ok();
}
