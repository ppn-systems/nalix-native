#ifndef NALIX_KECCAK256_H
#define NALIX_KECCAK256_H

#include <stdint.h>
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

#define KECCAK256_HASH_SIZE 32
#define KECCAK256_BLOCK_SIZE 136

typedef struct {
    uint64_t state[25];
    uint8_t buffer[KECCAK256_BLOCK_SIZE];
    size_t buffer_len;
} keccak256_ctx_t;

void keccak256_init(keccak256_ctx_t* ctx);
void keccak256_update(keccak256_ctx_t* ctx, const uint8_t* data, size_t len);
void keccak256_final(keccak256_ctx_t* ctx, uint8_t out[32]);
void keccak256_hash(const uint8_t* data, size_t len, uint8_t out[32]);

void hmac_keccak256(
    const uint8_t* key, size_t key_len,
    const uint8_t* data, size_t data_len,
    uint8_t out[32]
);

void hkdf_keccak256_extract(
    const uint8_t* salt, size_t salt_len,
    const uint8_t* ikm, size_t ikm_len,
    uint8_t prk[32]
);

void hkdf_keccak256_expand(
    const uint8_t prk[32],
    const uint8_t* info, size_t info_len,
    uint8_t okm[32]
);

#ifdef __cplusplus
}
#endif

#endif /* NALIX_KECCAK256_H */
