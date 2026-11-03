#ifndef NALIX_COMPRESSION_H
#define NALIX_COMPRESSION_H

#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>
#include "nalix/status.h"

#ifdef __cplusplus
extern "C" {
#endif

#define NALIX_LZ4_HEADER_SIZE 8

#if defined(__GNUC__) || defined(__clang__)
#define NALIX_PACKED __attribute__((packed))
#else
#define NALIX_PACKED
#endif

#pragma pack(push, 1)
/**
 * @brief Nalix LZ4 block header (8 bytes Little-Endian).
 */
typedef struct NALIX_PACKED nalix_lz4_header {
    int32_t original_length;
    int32_t compressed_length; /* compressed payload length + 8 */
} nalix_lz4_header_t;
#pragma pack(pop)

/**
 * @brief Attempts to compress payload using LZ4.
 * Compresses only if length reduction is >= 12.5% (comp_len <= orig_len - (orig_len >> 3)).
 *
 * @param src Pointer to input uncompressed data.
 * @param src_len Length of input uncompressed data.
 * @param dst Destination buffer to hold [nalix_lz4_header_t (8B) | raw LZ4 block].
 * @param dst_capacity Capacity of destination buffer.
 * @param out_len Number of bytes written into dst if compressed.
 * @param was_compressed Set to true if compression occurred, false if payload did not meet threshold.
 * @return nalix_status_t NALIX_STATUS_OK on success.
 */
nalix_status_t nalix_compress_payload(
    const uint8_t* src,
    size_t src_len,
    uint8_t* dst,
    size_t dst_capacity,
    size_t* out_len,
    bool* was_compressed
);

/**
 * @brief Decompresses an LZ4 compressed block with 8-byte header into dst.
 *
 * @param src Pointer to compressed data starting with nalix_lz4_header_t.
 * @param src_len Total length of compressed data including 8-byte header.
 * @param dst Destination buffer for decompressed data.
 * @param dst_capacity Capacity of destination buffer.
 * @param out_len Number of decompressed bytes written into dst.
 * @return nalix_status_t NALIX_STATUS_OK on success, or error on corrupted data / insufficient capacity.
 */
nalix_status_t nalix_decompress_payload(
    const uint8_t* src,
    size_t src_len,
    uint8_t* dst,
    size_t dst_capacity,
    size_t* out_len
);

#ifdef __cplusplus
}
#endif

#endif /* NALIX_COMPRESSION_H */
