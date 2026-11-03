#include "nalix/nalix.h"
#include <stdio.h>
#include <string.h>
#include <assert.h>

static void test_status_codes(void) {
    nalix_status_t ok = nalix_status_ok();
    assert(nalix_status_is_ok(&ok));
    assert(strcmp(nalix_status_code_to_string(NALIX_STATUS_OK), "OK") == 0);

    nalix_status_t err = nalix_status_create(NALIX_STATUS_INVALID_ARGUMENT, "Invalid input");
    assert(!nalix_status_is_ok(&err));
    assert(err.code == NALIX_STATUS_INVALID_ARGUMENT);
    assert(strcmp(err.message, "Invalid input") == 0);
    printf("test_status_codes passed.\n");
}

static void test_packet_framing(void) {
    nalix_packet_t pkt;
    pkt.header.opcode = 0x1A2B;
    pkt.header.flags = 0x01;
    pkt.header.priority = 0x02;
    pkt.header.sequence_id = 0x0042;

    const uint8_t payload[] = { 0xDE, 0xAD, 0xBE, 0xEF };
    pkt.payload = payload;
    pkt.payload_len = sizeof(payload);

    uint8_t buffer[64];
    size_t written = 0;
    nalix_status_t status = nalix_packet_encode(&pkt, buffer, sizeof(buffer), &written);
    assert(nalix_status_is_ok(&status));
    assert(written == NALIX_HEADER_SIZE + sizeof(payload));

    /* Verify Little-Endian header bytes */
    assert(buffer[0] == 0x2B);
    assert(buffer[1] == 0x1A);
    assert(buffer[2] == 0x01);
    assert(buffer[3] == 0x02);
    assert(buffer[4] == 0x42);
    assert(buffer[5] == 0x00);

    /* Decode */
    nalix_packet_t decoded;
    size_t consumed = 0;
    status = nalix_packet_decode(buffer, written, &decoded, &consumed);
    assert(nalix_status_is_ok(&status));
    assert(consumed == written);
    assert(decoded.header.opcode == 0x1A2B);
    assert(decoded.header.flags == 0x01);
    assert(decoded.header.priority == 0x02);
    assert(decoded.header.sequence_id == 0x0042);
    assert(decoded.payload_len == sizeof(payload));
    assert(memcmp(decoded.payload, payload, sizeof(payload)) == 0);

    printf("test_packet_framing passed.\n");
}

static void test_client_lifecycle(void) {
    nalix_channel_config_t config = nalix_channel_config_default("127.0.0.1", 9000);
    nalix_client_t client;
    nalix_status_t status = nalix_client_init(&client, &config, NULL);
    assert(nalix_status_is_ok(&status));
    assert(client.state == NALIX_CHANNEL_IDLE);

    /* Connecting to offline port transitions to TRANSIENT_FAILURE */
    status = nalix_client_connect(&client);
    assert(!nalix_status_is_ok(&status));
    assert(status.code == NALIX_STATUS_UNAVAILABLE);
    assert(client.state == NALIX_CHANNEL_TRANSIENT_FAILURE);

    status = nalix_client_disconnect(&client);
    assert(nalix_status_is_ok(&status));
    assert(client.state == NALIX_CHANNEL_SHUTDOWN);

    nalix_client_destroy(&client);
    printf("test_client_lifecycle passed.\n");
}

int main(void) {
    printf("--- Running Nalix C Client Tests ---\n");
    test_status_codes();
    test_packet_framing();
    test_client_lifecycle();
    printf("All C Client Tests Passed Successfully.\n");
    return 0;
}
