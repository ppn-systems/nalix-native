#ifndef NALIX_PIPELINE_H
#define NALIX_PIPELINE_H

#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>
#include "nalix/packet.h"
#include "nalix/status.h"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief Session cryptographic and sequence state used across pipeline processing.
 */
typedef struct nalix_session_state {
    uint8_t secret[32];
    uint64_t session_token;
    bool encryption_enabled;
    uint32_t envelope_seq32;
    uint16_t next_seq16;
} nalix_session_state_t;

/**
 * @brief Processes an outbound packet through the Nalix pipeline:
 *   1. Auto-assigns sequence_id if 0.
 *   2. Compresses payload via LZ4 if gain >= 12.5%.
 *   3. Encrypts payload via ChaCha20-Poly1305 if encryption_enabled.
 *   4. Encodes full 6-byte header + final payload into wire_buffer.
 *
 * @param state Session state (mutated for sequence increment and envelope seq).
 * @param packet Input packet.
 * @param wire_buffer Destination wire buffer.
 * @param wire_capacity Capacity of wire buffer.
 * @param wire_len Actual bytes written to wire buffer.
 * @return nalix_status_t NALIX_STATUS_OK on success.
 */
nalix_status_t nalix_pipeline_process_outbound(
    nalix_session_state_t* state,
    const nalix_packet_t* packet,
    uint8_t* wire_buffer,
    size_t wire_capacity,
    size_t* wire_len
);

/**
 * @brief Processes an inbound packet through the Nalix pipeline:
 *   1. Decrypts payload if ENCRYPTED flag is set.
 *   2. Decompresses payload if COMPRESSED flag is set.
 *
 * @param state Session state.
 * @param in_packet Input raw packet from wire.
 * @param out_payload_buffer Buffer to store decrypted/decompressed payload.
 * @param out_payload_capacity Capacity of payload buffer.
 * @param out_packet Output packet holding clear payload.
 * @return nalix_status_t NALIX_STATUS_OK on success.
 */
nalix_status_t nalix_pipeline_process_inbound(
    const nalix_session_state_t* state,
    const nalix_packet_t* in_packet,
    uint8_t* out_payload_buffer,
    size_t out_payload_capacity,
    nalix_packet_t* out_packet
);

#ifdef __cplusplus
}
#endif

#endif /* NALIX_PIPELINE_H */
