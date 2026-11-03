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
    printf("  [PASS] test_status_codes\n");
}

static void test_packet_framing(void) {
    const uint8_t payload[] = { 0xDE, 0xAD, 0xBE, 0xEF };
    nalix_packet_t pkt = nalix_packet_create(0x1A2B, payload, sizeof(payload));
    pkt.header.flags = 0x01;
    pkt.header.priority = 0x02;
    pkt.header.sequence_id = 0x0042;

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

    printf("  [PASS] test_packet_framing\n");
}

static void test_lz4_compression(void) {
    /* 1. Small payload under 32 bytes should NOT compress */
    const uint8_t small[16] = "short text";
    uint8_t comp_buf[512];
    size_t comp_len = 0;
    bool was_compressed = false;
    nalix_status_t st = nalix_compress_payload(small, sizeof(small), comp_buf, sizeof(comp_buf), &comp_len, &was_compressed);
    assert(nalix_status_is_ok(&st));
    assert(!was_compressed);

    /* 2. Repetitive payload with > 12.5% compression gain */
    uint8_t original[1024];
    for (size_t i = 0; i < sizeof(original); i++) {
        original[i] = (uint8_t)(i % 17);
    }

    st = nalix_compress_payload(original, sizeof(original), comp_buf, sizeof(comp_buf), &comp_len, &was_compressed);
    assert(nalix_status_is_ok(&st));
    assert(was_compressed);
    assert(comp_len < sizeof(original));
    assert(comp_len >= NALIX_LZ4_HEADER_SIZE);

    /* Verify 8-byte LE header */
    int32_t header_orig_len = (int32_t)(comp_buf[0] | (comp_buf[1] << 8) | (comp_buf[2] << 16) | (comp_buf[3] << 24));
    int32_t header_comp_len = (int32_t)(comp_buf[4] | (comp_buf[5] << 8) | (comp_buf[6] << 16) | (comp_buf[7] << 24));
    assert(header_orig_len == (int32_t)sizeof(original));
    assert(header_comp_len == (int32_t)comp_len);

    /* Decompress */
    uint8_t decomp_buf[1024];
    size_t decomp_len = 0;
    st = nalix_decompress_payload(comp_buf, comp_len, decomp_buf, sizeof(decomp_buf), &decomp_len);
    assert(nalix_status_is_ok(&st));
    assert(decomp_len == sizeof(original));
    assert(memcmp(decomp_buf, original, sizeof(original)) == 0);

    printf("  [PASS] test_lz4_compression\n");
}

static void test_envelope_cipher(void) {
    const uint8_t key[32] = {
        0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
        0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x0E, 0x0F, 0x10,
        0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18,
        0x19, 0x1A, 0x1B, 0x1C, 0x1D, 0x1E, 0x1F, 0x20
    };

    const uint8_t plaintext[] = "Nalix authenticated encrypted message payload with ChaCha20-Poly1305";
    size_t pt_len = strlen((const char*)plaintext);

    uint8_t envelope[256];
    size_t env_len = 0;
    nalix_status_t st = nalix_encrypt_envelope(key, 42, plaintext, pt_len, envelope, sizeof(envelope), &env_len);
    assert(nalix_status_is_ok(&st));
    assert(env_len == pt_len + NALIX_ENVELOPE_OVERHEAD);

    /* Verify Envelope Header */
    uint32_t magic = (uint32_t)envelope[0] | ((uint32_t)envelope[1] << 8) | ((uint32_t)envelope[2] << 16) | ((uint32_t)envelope[3] << 24);
    assert(magic == NALIX_ENVELOPE_MAGIC);
    assert(envelope[4] == NALIX_ENVELOPE_VERSION);
    assert(envelope[5] == NALIX_ENVELOPE_TYPE_CHACHA20_POLY1305);
    assert(envelope[7] == NALIX_NONCE_SIZE);

    /* Decrypt successfully */
    uint8_t decrypted[256];
    size_t dec_len = 0;
    st = nalix_decrypt_envelope(key, envelope, env_len, decrypted, sizeof(decrypted), &dec_len);
    assert(nalix_status_is_ok(&st));
    assert(dec_len == pt_len);
    assert(memcmp(decrypted, plaintext, pt_len) == 0);

    /* Tampering with ciphertext triggers unauthenticated error */
    envelope[NALIX_ENVELOPE_HEADER_SIZE + NALIX_NONCE_SIZE + 5] ^= 0xFF;
    st = nalix_decrypt_envelope(key, envelope, env_len, decrypted, sizeof(decrypted), &dec_len);
    assert(!nalix_status_is_ok(&st));
    assert(st.code == NALIX_STATUS_UNAUTHENTICATED);

    printf("  [PASS] test_envelope_cipher\n");
}

static void test_handshake_crypto(void) {
    uint8_t client_pub[32], client_nonce[32], server_pub[32], server_nonce[32];
    memset(client_pub, 0x11, 32);
    memset(client_nonce, 0x22, 32);
    memset(server_pub, 0x33, 32);
    memset(server_nonce, 0x44, 32);

    /* Transcript Hash */
    uint8_t transcript_hash[32];
    nalix_handshake_compute_transcript_hash(client_pub, client_nonce, server_pub, server_nonce, transcript_hash);

    /* Shared secrets & Master Secret */
    uint8_t shared_ee[32], shared_se[32], master_secret[32];
    memset(shared_ee, 0xAA, 32);
    memset(shared_se, 0xBB, 32);
    nalix_handshake_compute_master_secret(shared_ee, shared_se, master_secret);

    /* Proofs */
    uint8_t server_proof[32], client_proof[32], finish_proof[32], session_key[32];
    nalix_handshake_compute_server_proof(master_secret, transcript_hash, server_proof);
    nalix_handshake_compute_client_proof(master_secret, transcript_hash, client_proof);
    nalix_handshake_compute_server_finish_proof(master_secret, transcript_hash, finish_proof);
    nalix_handshake_derive_session_key(master_secret, client_nonce, server_nonce, transcript_hash, session_key);

    /* Proofs must all be non-zero and distinct */
    assert(memcmp(server_proof, client_proof, 32) != 0);
    assert(memcmp(server_proof, finish_proof, 32) != 0);
    assert(memcmp(session_key, master_secret, 32) != 0);

    printf("  [PASS] test_handshake_crypto\n");
}

static void test_pipeline_outbound_inbound(void) {
    nalix_session_state_t state;
    memset(&state, 0, sizeof(state));
    state.next_seq16 = 100;
    state.envelope_seq32 = 1;
    memset(state.secret, 0x5A, 32);
    state.encryption_enabled = true;

    /* Build large repetitive packet payload */
    uint8_t original_payload[512];
    for (size_t i = 0; i < sizeof(original_payload); i++) {
        original_payload[i] = (uint8_t)(i % 13);
    }

    /* Outbound packet with sequence_id 0 to test auto-sequence stamping */
    nalix_packet_t out_pkt = nalix_packet_create(0x0500, original_payload, sizeof(original_payload));
    assert(out_pkt.header.sequence_id == 0);

    uint8_t wire[2048];
    size_t wire_len = 0;
    nalix_status_t st = nalix_pipeline_process_outbound(&state, &out_pkt, wire, sizeof(wire), &wire_len);
    assert(nalix_status_is_ok(&st));
    assert(wire_len > NALIX_HEADER_SIZE);

    /* Verify auto sequence was stamped to 100 and state incremented to 101 */
    uint16_t stamped_seq = (uint16_t)wire[4] | ((uint16_t)wire[5] << 8);
    assert(stamped_seq == 100);
    assert(state.next_seq16 == 101);

    /* Flags must include both COMPRESSED and ENCRYPTED */
    uint8_t flags = wire[2];
    assert((flags & NALIX_PACKET_FLAG_COMPRESSED) != 0);
    assert((flags & NALIX_PACKET_FLAG_ENCRYPTED) != 0);

    /* Inbound wire decoding */
    nalix_packet_t wire_pkt;
    size_t consumed = 0;
    st = nalix_packet_decode(wire, wire_len, &wire_pkt, &consumed);
    assert(nalix_status_is_ok(&st));
    assert(consumed == wire_len);

    /* Pipeline Inbound: Decrypt -> Decompress */
    uint8_t restored_payload[1024];
    nalix_packet_t clear_pkt;
    st = nalix_pipeline_process_inbound(&state, &wire_pkt, restored_payload, sizeof(restored_payload), &clear_pkt);
    assert(nalix_status_is_ok(&st));
    assert(clear_pkt.header.opcode == 0x0500);
    assert(clear_pkt.header.sequence_id == 100);
    assert(clear_pkt.payload_len == sizeof(original_payload));
    assert(memcmp(clear_pkt.payload, original_payload, sizeof(original_payload)) == 0);

    printf("  [PASS] test_pipeline_outbound_inbound\n");
}

static void test_session_lifecycle(void) {
    nalix_channel_config_t config = nalix_channel_config_default("127.0.0.1", 9000);
    nalix_session_t session;
    nalix_status_t status = nalix_session_init(&session, &config, NULL);
    assert(nalix_status_is_ok(&status));
    assert(session.state == NALIX_CHANNEL_IDLE);

    /* Sequence generator helper */
    assert(nalix_session_next_sequence_id(&session) == 1);
    assert(nalix_session_next_sequence_id(&session) == 2);

    /* Connecting to offline port transitions to TRANSIENT_FAILURE */
    status = nalix_session_connect(&session);
    assert(!nalix_status_is_ok(&status));
    assert(status.code == NALIX_STATUS_UNAVAILABLE);
    assert(session.state == NALIX_CHANNEL_TRANSIENT_FAILURE);

    status = nalix_session_disconnect(&session);
    assert(nalix_status_is_ok(&status));
    assert(session.state == NALIX_CHANNEL_SHUTDOWN);

    nalix_session_destroy(&session);
    printf("  [PASS] test_session_lifecycle\n");
}

int main(void) {
    printf("--- Running Nalix C Session & Pipeline Tests ---\n");
    test_status_codes();
    test_packet_framing();
    test_lz4_compression();
    test_envelope_cipher();
    test_handshake_crypto();
    test_pipeline_outbound_inbound();
    test_session_lifecycle();
    printf("All Nalix C Tests Passed Successfully!\n");
    return 0;
}
