#include "nalix/compression.h"
#include "third_party/lz4/lz4.h"
#include <string.h>

nalix_status_t nalix_compress_payload(
    const uint8_t* src,
    size_t src_len,
    uint8_t* dst,
    size_t dst_capacity,
    size_t* out_len,
    bool* was_compressed
) {
    if (!out_len || !was_compressed) {
        return nalix_status_create(NALIX_STATUS_INVALID_ARGUMENT, "Null output pointer");
    }

    *was_compressed = false;
    *out_len = 0;

    if (!src || src_len < 32) {
        /* Too small to benefit from LZ4 compression */
        return nalix_status_ok();
    }

    if (dst_capacity <= NALIX_LZ4_HEADER_SIZE) {
        return nalix_status_create(NALIX_STATUS_RESOURCE_EXHAUSTED, "Destination buffer too small for compression");
    }

    /* Compress into buffer starting at offset 8 */
    int max_dest_size = (int)(dst_capacity - NALIX_LZ4_HEADER_SIZE);
    int comp_len = LZ4_compress_default(
        (const char*)src,
        (char*)(dst + NALIX_LZ4_HEADER_SIZE),
        (int)src_len,
        max_dest_size
    );

    if (comp_len <= 0) {
        /* Compression failed or incompressible */
        return nalix_status_ok();
    }

    /* 12.5% threshold: comp_len <= orig_len - (orig_len >> 3) */
    size_t threshold = src_len - (src_len >> 3);
    if ((size_t)comp_len > threshold) {
        /* Did not meet minimum compression gain */
        return nalix_status_ok();
    }

    /* Write 8-byte LE header */
    int32_t orig_len_i32 = (int32_t)src_len;
    int32_t total_comp_len_i32 = (int32_t)(comp_len + NALIX_LZ4_HEADER_SIZE);

    dst[0] = (uint8_t)(orig_len_i32 & 0xFF);
    dst[1] = (uint8_t)((orig_len_i32 >> 8) & 0xFF);
    dst[2] = (uint8_t)((orig_len_i32 >> 16) & 0xFF);
    dst[3] = (uint8_t)((orig_len_i32 >> 24) & 0xFF);

    dst[4] = (uint8_t)(total_comp_len_i32 & 0xFF);
    dst[5] = (uint8_t)((total_comp_len_i32 >> 8) & 0xFF);
    dst[6] = (uint8_t)((total_comp_len_i32 >> 16) & 0xFF);
    dst[7] = (uint8_t)((total_comp_len_i32 >> 24) & 0xFF);

    *out_len = (size_t)total_comp_len_i32;
    *was_compressed = true;
    return nalix_status_ok();
}

nalix_status_t nalix_decompress_payload(
    const uint8_t* src,
    size_t src_len,
    uint8_t* dst,
    size_t dst_capacity,
    size_t* out_len
) {
    if (!src || !dst || !out_len) {
        return nalix_status_create(NALIX_STATUS_INVALID_ARGUMENT, "Null pointer argument");
    }

    if (src_len < NALIX_LZ4_HEADER_SIZE) {
        return nalix_status_create(NALIX_STATUS_INVALID_ARGUMENT, "Payload too short for LZ4 header");
    }

    int32_t orig_len = (int32_t)(
        (uint32_t)src[0] |
        ((uint32_t)src[1] << 8) |
        ((uint32_t)src[2] << 16) |
        ((uint32_t)src[3] << 24)
    );

    int32_t comp_len = (int32_t)(
        (uint32_t)src[4] |
        ((uint32_t)src[5] << 8) |
        ((uint32_t)src[6] << 16) |
        ((uint32_t)src[7] << 24)
    );

    if (orig_len <= 0 || comp_len <= NALIX_LZ4_HEADER_SIZE || (size_t)comp_len > src_len) {
        return nalix_status_create(NALIX_STATUS_INVALID_ARGUMENT, "Invalid LZ4 header lengths");
    }

    if ((size_t)orig_len > dst_capacity) {
        return nalix_status_create(NALIX_STATUS_RESOURCE_EXHAUSTED, "Destination buffer too small for decompressed data");
    }

    int raw_comp_len = comp_len - NALIX_LZ4_HEADER_SIZE;
    int decomp_len = LZ4_decompress_safe(
        (const char*)(src + NALIX_LZ4_HEADER_SIZE),
        (char*)dst,
        raw_comp_len,
        orig_len
    );

    if (decomp_len < 0 || decomp_len != orig_len) {
        return nalix_status_create(NALIX_STATUS_DATA_LOSS, "LZ4 decompression corrupt or size mismatch");
    }

    *out_len = (size_t)decomp_len;
    return nalix_status_ok();
}
