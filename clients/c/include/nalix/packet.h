#ifndef NALIX_PACKET_H
#define NALIX_PACKET_H

#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>
#include "nalix/status.h"
#include "nalix/protocol.h"

#ifdef __cplusplus
extern "C" {
#endif

#define NALIX_HEADER_SIZE 6

/**
 * @brief Nalix Wire Protocol Packet Flags.
 */
typedef enum nalix_packet_flags {
    NALIX_PACKET_FLAG_NONE       = 0x00,
    NALIX_PACKET_FLAG_COMPRESSED = 0x02,
    NALIX_PACKET_FLAG_ENCRYPTED  = 0x04,
    NALIX_PACKET_FLAG_FRAGMENTED = 0x08
} nalix_packet_flags_t;

#if defined(__GNUC__) || defined(__clang__)
#define NALIX_PACKED __attribute__((packed))
#else
#define NALIX_PACKED
#endif

#pragma pack(push, 1)
/**
 * @brief Nalix v14 wire protocol 6-byte header.
 * Layout:
 *   [0..1]: OpCode (uint16_t, Little-Endian)
 *   [2]:    Flags (uint8_t)
 *   [3]:    Priority (uint8_t)
 *   [4..5]: SequenceId (uint16_t, Little-Endian)
 */
typedef struct NALIX_PACKED nalix_header {
    uint16_t opcode;
    uint8_t flags;
    uint8_t priority;
    uint16_t sequence_id;
} nalix_header_t;
#pragma pack(pop)

/**
 * @brief Nalix frame holding a 6-byte header and variable-length payload.
 */
typedef struct nalix_packet {
    nalix_header_t header;
    const uint8_t* payload;
    size_t payload_len;
} nalix_packet_t;

/**
 * @brief High-level helper to initialize a packet with opcode and payload.
 */
static inline nalix_packet_t nalix_packet_create(
    uint16_t opcode,
    const uint8_t* payload,
    size_t payload_len
) {
    nalix_packet_t pkt;
    pkt.header.opcode = opcode;
    pkt.header.flags = NALIX_PACKET_FLAG_NONE;
    pkt.header.priority = 0;
    pkt.header.sequence_id = 0;
    pkt.payload = payload;
    pkt.payload_len = payload_len;
    return pkt;
}

/**
 * @brief Encodes a packet into a destination buffer.
 */
nalix_status_t nalix_packet_encode(
    const nalix_packet_t* packet,
    uint8_t* buffer,
    size_t buffer_capacity,
    size_t* bytes_written
);

/**
 * @brief Decodes a packet from a binary wire buffer.
 */
nalix_status_t nalix_packet_decode(
    const uint8_t* buffer,
    size_t buffer_len,
    nalix_packet_t* packet,
    size_t* bytes_consumed
);

#ifdef __cplusplus
}
#endif

#endif /* NALIX_PACKET_H */
