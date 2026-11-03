#include "nalix/packet.h"
#include <string.h>

nalix_status_t nalix_packet_encode(
    const nalix_packet_t* packet,
    uint8_t* buffer,
    size_t buffer_capacity,
    size_t* bytes_written
) {
    if (!packet || !buffer || !bytes_written) {
        return nalix_status_create(NALIX_STATUS_INVALID_ARGUMENT, "Null pointer argument provided");
    }

    size_t total_size = NALIX_HEADER_SIZE + packet->payload_len;
    if (buffer_capacity < total_size) {
        return nalix_status_create(NALIX_STATUS_RESOURCE_EXHAUSTED, "Buffer capacity insufficient for packet");
    }

    /* Encode 6-byte header in Little-Endian */
    buffer[0] = (uint8_t)(packet->header.opcode & 0xFF);
    buffer[1] = (uint8_t)((packet->header.opcode >> 8) & 0xFF);
    buffer[2] = packet->header.flags;
    buffer[3] = packet->header.priority;
    buffer[4] = (uint8_t)(packet->header.sequence_id & 0xFF);
    buffer[5] = (uint8_t)((packet->header.sequence_id >> 8) & 0xFF);

    /* Copy payload */
    if (packet->payload_len > 0 && packet->payload) {
        memcpy(buffer + NALIX_HEADER_SIZE, packet->payload, packet->payload_len);
    }

    *bytes_written = total_size;
    return nalix_status_ok();
}

nalix_status_t nalix_packet_decode(
    const uint8_t* buffer,
    size_t buffer_len,
    nalix_packet_t* packet,
    size_t* bytes_consumed
) {
    if (!buffer || !packet || !bytes_consumed) {
        return nalix_status_create(NALIX_STATUS_INVALID_ARGUMENT, "Null pointer argument provided");
    }

    if (buffer_len < NALIX_HEADER_SIZE) {
        return nalix_status_create(NALIX_STATUS_OUT_OF_RANGE, "Buffer too small for Nalix header");
    }

    /* Decode 6-byte header from Little-Endian */
    packet->header.opcode = (uint16_t)(buffer[0] | ((uint16_t)buffer[1] << 8));
    packet->header.flags = buffer[2];
    packet->header.priority = buffer[3];
    packet->header.sequence_id = (uint16_t)(buffer[4] | ((uint16_t)buffer[5] << 8));

    size_t payload_len = buffer_len - NALIX_HEADER_SIZE;
    packet->payload = (payload_len > 0) ? (buffer + NALIX_HEADER_SIZE) : (void*)0;
    packet->payload_len = payload_len;

    *bytes_consumed = buffer_len;
    return nalix_status_ok();
}
