#include "nalix/pipeline.h"
#include "nalix/compression.h"
#include "nalix/security.h"
#include <string.h>

#define NALIX_PIPELINE_SCRATCH_SIZE 65536

nalix_status_t nalix_pipeline_process_outbound(
    nalix_session_state_t* state,
    const nalix_packet_t* packet,
    uint8_t* wire_buffer,
    size_t wire_capacity,
    size_t* wire_len
) {
    if (!state || !packet || !wire_buffer || !wire_len) {
        return nalix_status_create(NALIX_STATUS_INVALID_ARGUMENT, "Null pointer argument");
    }

    nalix_header_t hdr = packet->header;

    /* 1. Auto sequence numbering if sequence_id is 0 */
    if (hdr.sequence_id == 0) {
        if (state->next_seq16 == 0) {
            state->next_seq16 = 1;
        }
        hdr.sequence_id = state->next_seq16++;
    }

    const uint8_t* cur_payload = packet->payload;
    size_t cur_len = packet->payload_len;

    uint8_t comp_buf[NALIX_PIPELINE_SCRATCH_SIZE];
    uint8_t enc_buf[NALIX_PIPELINE_SCRATCH_SIZE];

    /* 2. LZ4 Compression stage */
    if (cur_payload && cur_len >= 32) {
        bool was_compressed = false;
        size_t comp_len = 0;
        nalix_status_t comp_st = nalix_compress_payload(
            cur_payload, cur_len,
            comp_buf, sizeof(comp_buf),
            &comp_len, &was_compressed
        );

        if (nalix_status_is_ok(&comp_st) && was_compressed) {
            cur_payload = comp_buf;
            cur_len = comp_len;
            hdr.flags |= NALIX_PACKET_FLAG_COMPRESSED;
        }
    }

    /* 3. ChaCha20-Poly1305 Encryption stage */
    if (state->encryption_enabled) {
        uint32_t env_seq = state->envelope_seq32++;
        size_t enc_len = 0;
        nalix_status_t enc_st = nalix_encrypt_envelope(
            state->secret, env_seq,
            cur_payload, cur_len,
            enc_buf, sizeof(enc_buf),
            &enc_len
        );

        if (!nalix_status_is_ok(&enc_st)) {
            return enc_st;
        }

        cur_payload = enc_buf;
        cur_len = enc_len;
        hdr.flags |= NALIX_PACKET_FLAG_ENCRYPTED;
    }

    /* 4. Encode wire frame [6B header | payload] */
    if (wire_capacity < NALIX_HEADER_SIZE + cur_len) {
        return nalix_status_create(NALIX_STATUS_RESOURCE_EXHAUSTED, "Wire buffer too small for frame");
    }

    wire_buffer[0] = (uint8_t)(hdr.opcode & 0xFF);
    wire_buffer[1] = (uint8_t)((hdr.opcode >> 8) & 0xFF);
    wire_buffer[2] = hdr.flags;
    wire_buffer[3] = hdr.priority;
    wire_buffer[4] = (uint8_t)(hdr.sequence_id & 0xFF);
    wire_buffer[5] = (uint8_t)((hdr.sequence_id >> 8) & 0xFF);

    if (cur_len > 0 && cur_payload) {
        memcpy(wire_buffer + NALIX_HEADER_SIZE, cur_payload, cur_len);
    }

    *wire_len = NALIX_HEADER_SIZE + cur_len;
    return nalix_status_ok();
}

nalix_status_t nalix_pipeline_process_inbound(
    const nalix_session_state_t* state,
    const nalix_packet_t* in_packet,
    uint8_t* out_payload_buffer,
    size_t out_payload_capacity,
    nalix_packet_t* out_packet
) {
    if (!in_packet || !out_payload_buffer || !out_packet) {
        return nalix_status_create(NALIX_STATUS_INVALID_ARGUMENT, "Null pointer argument");
    }

    out_packet->header = in_packet->header;
    const uint8_t* cur_payload = in_packet->payload;
    size_t cur_len = in_packet->payload_len;

    uint8_t decrypt_scratch[NALIX_PIPELINE_SCRATCH_SIZE];

    /* 1. Decrypt if ENCRYPTED flag is present */
    if (in_packet->header.flags & NALIX_PACKET_FLAG_ENCRYPTED) {
        if (!state || !state->encryption_enabled) {
            return nalix_status_create(NALIX_STATUS_UNAUTHENTICATED, "Packet is encrypted but session has no secret");
        }

        size_t decrypted_len = 0;
        nalix_status_t dec_st = nalix_decrypt_envelope(
            state->secret,
            cur_payload, cur_len,
            decrypt_scratch, sizeof(decrypt_scratch),
            &decrypted_len
        );
        if (!nalix_status_is_ok(&dec_st)) {
            return dec_st;
        }

        cur_payload = decrypt_scratch;
        cur_len = decrypted_len;
        out_packet->header.flags &= ~NALIX_PACKET_FLAG_ENCRYPTED;
    }

    /* 2. Decompress if COMPRESSED flag is present */
    if (in_packet->header.flags & NALIX_PACKET_FLAG_COMPRESSED) {
        size_t decompressed_len = 0;
        nalix_status_t decomp_st = nalix_decompress_payload(
            cur_payload, cur_len,
            out_payload_buffer, out_payload_capacity,
            &decompressed_len
        );
        if (!nalix_status_is_ok(&decomp_st)) {
            return decomp_st;
        }

        out_packet->payload = out_payload_buffer;
        out_packet->payload_len = decompressed_len;
        out_packet->header.flags &= ~NALIX_PACKET_FLAG_COMPRESSED;
    } else {
        if (out_payload_capacity < cur_len) {
            return nalix_status_create(NALIX_STATUS_RESOURCE_EXHAUSTED, "Payload buffer too small");
        }
        if (cur_len > 0 && cur_payload) {
            memcpy(out_payload_buffer, cur_payload, cur_len);
        }
        out_packet->payload = out_payload_buffer;
        out_packet->payload_len = cur_len;
    }

    return nalix_status_ok();
}
