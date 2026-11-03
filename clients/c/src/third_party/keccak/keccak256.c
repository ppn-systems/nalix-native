#include "keccak256.h"
#include <string.h>

static const uint64_t RC[24] = {
    0x0000000000000001ULL, 0x0000000000008082ULL, 0x800000000000808aULL,
    0x8000000080008000ULL, 0x000000000000808bULL, 0x0000000080000001ULL,
    0x8000000080008081ULL, 0x8000000000008009ULL, 0x000000000000008aULL,
    0x0000000000000088ULL, 0x0000000080008009ULL, 0x000000008000000aULL,
    0x000000008000808bULL, 0x800000000000008bULL, 0x8000000000008089ULL,
    0x8000000000008003ULL, 0x8000000000008002ULL, 0x8000000000000080ULL,
    0x000000000000800aULL, 0x800000008000000aULL, 0x8000000080008081ULL,
    0x8000000000008080ULL, 0x0000000080000001ULL, 0x8000000080008008ULL
};

static const int ROT_CONSTANTS[5][5] = {
    { 0, 36,  3, 41, 18 },
    { 1, 44, 10, 45,  2 },
    { 62,  6, 43, 15, 61 },
    { 28, 55, 25, 21, 56 },
    { 27, 20, 39,  8, 14 }
};

static inline uint64_t rotl64(uint64_t x, int n) {
    return (x << n) | (x >> (64 - n));
}

static void keccak_f1600(uint64_t state[25]) {
    for (int round = 0; round < 24; round++) {
        /* Theta */
        uint64_t C[5];
        for (int x = 0; x < 5; x++) {
            C[x] = state[x] ^ state[x + 5] ^ state[x + 10] ^ state[x + 15] ^ state[x + 20];
        }
        uint64_t D[5];
        for (int x = 0; x < 5; x++) {
            D[x] = C[(x + 4) % 5] ^ rotl64(C[(x + 1) % 5], 1);
        }
        for (int x = 0; x < 5; x++) {
            for (int y = 0; y < 5; y++) {
                state[x + 5 * y] ^= D[x];
            }
        }

        /* Rho and Pi */
        uint64_t B[5][5];
        for (int x = 0; x < 5; x++) {
            for (int y = 0; y < 5; y++) {
                B[y][(2 * x + 3 * y) % 5] = rotl64(state[x + 5 * y], ROT_CONSTANTS[x][y]);
            }
        }

        /* Chi */
        for (int x = 0; x < 5; x++) {
            for (int y = 0; y < 5; y++) {
                state[x + 5 * y] = B[x][y] ^ ((~B[(x + 1) % 5][y]) & B[(x + 2) % 5][y]);
            }
        }

        /* Iota */
        state[0] ^= RC[round];
    }
}

void keccak256_init(keccak256_ctx_t* ctx) {
    memset(ctx, 0, sizeof(*ctx));
}

static void keccak256_process_block(keccak256_ctx_t* ctx, const uint8_t* block) {
    for (size_t i = 0; i < KECCAK256_BLOCK_SIZE / 8; i++) {
        uint64_t lane = 0;
        for (int b = 0; b < 8; b++) {
            lane |= ((uint64_t)block[i * 8 + b]) << (b * 8);
        }
        ctx->state[i] ^= lane;
    }
    keccak_f1600(ctx->state);
}

void keccak256_update(keccak256_ctx_t* ctx, const uint8_t* data, size_t len) {
    while (len > 0) {
        if (ctx->buffer_len == 0 && len >= KECCAK256_BLOCK_SIZE) {
            keccak256_process_block(ctx, data);
            data += KECCAK256_BLOCK_SIZE;
            len -= KECCAK256_BLOCK_SIZE;
        } else {
            size_t take = KECCAK256_BLOCK_SIZE - ctx->buffer_len;
            if (take > len) take = len;
            memcpy(ctx->buffer + ctx->buffer_len, data, take);
            ctx->buffer_len += take;
            data += take;
            len -= take;
            if (ctx->buffer_len == KECCAK256_BLOCK_SIZE) {
                keccak256_process_block(ctx, ctx->buffer);
                ctx->buffer_len = 0;
            }
        }
    }
}

void keccak256_final(keccak256_ctx_t* ctx, uint8_t out[32]) {
    /* Keccak-256 padding: 0x01 ... 0x80 */
    ctx->buffer[ctx->buffer_len++] = 0x01;
    memset(ctx->buffer + ctx->buffer_len, 0, KECCAK256_BLOCK_SIZE - ctx->buffer_len);
    ctx->buffer[KECCAK256_BLOCK_SIZE - 1] |= 0x80;
    keccak256_process_block(ctx, ctx->buffer);

    for (size_t i = 0; i < 4; i++) {
        uint64_t lane = ctx->state[i];
        for (int b = 0; b < 8; b++) {
            out[i * 8 + b] = (uint8_t)(lane >> (b * 8));
        }
    }
    memset(ctx, 0, sizeof(*ctx));
}

void keccak256_hash(const uint8_t* data, size_t len, uint8_t out[32]) {
    keccak256_ctx_t ctx;
    keccak256_init(&ctx);
    if (data && len > 0) {
        keccak256_update(&ctx, data, len);
    }
    keccak256_final(&ctx, out);
}

void hmac_keccak256(
    const uint8_t* key, size_t key_len,
    const uint8_t* data, size_t data_len,
    uint8_t out[32]
) {
    uint8_t k[KECCAK256_BLOCK_SIZE];
    memset(k, 0, sizeof(k));

    if (key_len > KECCAK256_BLOCK_SIZE) {
        keccak256_hash(key, key_len, k);
    } else {
        memcpy(k, key, key_len);
    }

    uint8_t i_pad[KECCAK256_BLOCK_SIZE];
    uint8_t o_pad[KECCAK256_BLOCK_SIZE];
    for (size_t i = 0; i < KECCAK256_BLOCK_SIZE; i++) {
        i_pad[i] = k[i] ^ 0x36;
        o_pad[i] = k[i] ^ 0x5c;
    }

    keccak256_ctx_t ctx;
    keccak256_init(&ctx);
    keccak256_update(&ctx, i_pad, KECCAK256_BLOCK_SIZE);
    if (data && data_len > 0) {
        keccak256_update(&ctx, data, data_len);
    }
    uint8_t inner_hash[32];
    keccak256_final(&ctx, inner_hash);

    keccak256_init(&ctx);
    keccak256_update(&ctx, o_pad, KECCAK256_BLOCK_SIZE);
    keccak256_update(&ctx, inner_hash, 32);
    keccak256_final(&ctx, out);
}

void hkdf_keccak256_extract(
    const uint8_t* salt, size_t salt_len,
    const uint8_t* ikm, size_t ikm_len,
    uint8_t prk[32]
) {
    uint8_t default_salt[32] = {0};
    const uint8_t* actual_salt = salt;
    size_t actual_salt_len = salt_len;

    if (!salt || salt_len == 0) {
        actual_salt = default_salt;
        actual_salt_len = 32;
    }

    hmac_keccak256(actual_salt, actual_salt_len, ikm, ikm_len, prk);
}

void hkdf_keccak256_expand(
    const uint8_t prk[32],
    const uint8_t* info, size_t info_len,
    uint8_t okm[32]
) {
    /* OKM = HMAC-Hash(PRK, info || 0x01) */
    uint8_t t[info_len + 1];
    if (info && info_len > 0) {
        memcpy(t, info, info_len);
    }
    t[info_len] = 0x01; /* counter 1 */
    hmac_keccak256(prk, 32, t, info_len + 1, okm);
}
