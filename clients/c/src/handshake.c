#include "nalix/handshake.h"
#include "nalix/protocol.h"
#include "nalix/packet.h"
#include "nalix/security.h"
#include "nalix/session.h"
#include "third_party/keccak/keccak256.h"
#include "third_party/monocypher/monocypher.h"
#include <string.h>
#include <stdlib.h>
#include <time.h>

#ifdef _WIN32
#include <winsock2.h>
#else
#include <sys/socket.h>
#include <unistd.h>
#endif

static const char SERVER_PROOF_LABEL[] = "nalix-handshake/server-proof";
static const char CLIENT_PROOF_LABEL[] = "nalix-handshake/client-proof";
static const char SERVER_FINISH_LABEL[] = "nalix-handshake/server-finish";
static const char SESSION_LABEL[] = "nalix-handshake/session";

static void fill_random_bytes(uint8_t* dst, size_t len) {
    static int seeded = 0;
    if (!seeded) {
        srand((unsigned int)time(NULL) ^ (unsigned int)(uintptr_t)&seeded);
        seeded = 1;
    }
    for (size_t i = 0; i < len; i++) {
        dst[i] = (uint8_t)(rand() & 0xFF);
    }
}

void nalix_handshake_compute_transcript_hash(
    const uint8_t client_public_key[32],
    const uint8_t client_nonce[32],
    const uint8_t server_public_key[32],
    const uint8_t server_nonce[32],
    uint8_t transcript_hash[32]
) {
    /* 144-byte transcript: 4 segments of [4 bytes LE length (32) | 32 bytes data] */
    uint8_t transcript[144];
    size_t offset = 0;

    const uint8_t* segments[4] = {
        client_public_key,
        client_nonce,
        server_public_key,
        server_nonce
    };

    for (int s = 0; s < 4; s++) {
        uint32_t len = 32;
        transcript[offset++] = (uint8_t)(len & 0xFF);
        transcript[offset++] = (uint8_t)((len >> 8) & 0xFF);
        transcript[offset++] = (uint8_t)((len >> 16) & 0xFF);
        transcript[offset++] = (uint8_t)((len >> 24) & 0xFF);
        memcpy(transcript + offset, segments[s], 32);
        offset += 32;
    }

    keccak256_hash(transcript, sizeof(transcript), transcript_hash);
}

void nalix_handshake_compute_master_secret(
    const uint8_t shared_secret_ee[32],
    const uint8_t shared_secret_se[32],
    uint8_t master_secret[32]
) {
    /* IKM: shared_ee (32B) || shared_se (32B) = 64 bytes */
    uint8_t ikm[64];
    memcpy(ikm, shared_secret_ee, 32);
    memcpy(ikm + 32, shared_secret_se, 32);
    hkdf_keccak256_extract(NULL, 0, ikm, sizeof(ikm), master_secret);
    crypto_wipe(ikm, sizeof(ikm));
}

void nalix_handshake_compute_server_proof(
    const uint8_t master_secret[32],
    const uint8_t transcript_hash[32],
    uint8_t proof[32]
) {
    /* info: "nalix-handshake/server-proof" (28B) || transcript_hash (32B) = 60 bytes */
    uint8_t info[28 + 32];
    memcpy(info, SERVER_PROOF_LABEL, 28);
    memcpy(info + 28, transcript_hash, 32);
    hkdf_keccak256_expand(master_secret, info, sizeof(info), proof);
}

void nalix_handshake_compute_client_proof(
    const uint8_t master_secret[32],
    const uint8_t transcript_hash[32],
    uint8_t proof[32]
) {
    /* info: "nalix-handshake/client-proof" (28B) || transcript_hash (32B) = 60 bytes */
    uint8_t info[28 + 32];
    memcpy(info, CLIENT_PROOF_LABEL, 28);
    memcpy(info + 28, transcript_hash, 32);
    hkdf_keccak256_expand(master_secret, info, sizeof(info), proof);
}

void nalix_handshake_compute_server_finish_proof(
    const uint8_t master_secret[32],
    const uint8_t transcript_hash[32],
    uint8_t proof[32]
) {
    /* info: "nalix-handshake/server-finish" (29B) || transcript_hash (32B) = 61 bytes */
    uint8_t info[29 + 32];
    memcpy(info, SERVER_FINISH_LABEL, 29);
    memcpy(info + 29, transcript_hash, 32);
    hkdf_keccak256_expand(master_secret, info, sizeof(info), proof);
}

void nalix_handshake_derive_session_key(
    const uint8_t master_secret[32],
    const uint8_t client_nonce[32],
    const uint8_t server_nonce[32],
    const uint8_t transcript_hash[32],
    uint8_t session_key[32]
) {
    /* info: "nalix-handshake/session" (23B) || client_nonce (32B) || server_nonce (32B) || transcript_hash (32B) = 119B */
    uint8_t info[23 + 32 + 32 + 32];
    size_t off = 0;
    memcpy(info + off, SESSION_LABEL, 23); off += 23;
    memcpy(info + off, client_nonce, 32);  off += 32;
    memcpy(info + off, server_nonce, 32);  off += 32;
    memcpy(info + off, transcript_hash, 32);
    hkdf_keccak256_expand(master_secret, info, sizeof(info), session_key);
}

static nalix_status_t receive_exact(void* transport_handle, uint8_t* buffer, size_t len) {
    size_t total = 0;
    intptr_t sock_fd = (intptr_t)transport_handle;
    while (total < len) {
        int r = recv((int)sock_fd, (char*)(buffer + total), (int)(len - total), 0);
        if (r <= 0) {
            return nalix_status_create(NALIX_STATUS_UNAVAILABLE, "Socket read error or closed");
        }
        total += (size_t)r;
    }
    return nalix_status_ok();
}

nalix_status_t nalix_handshake_perform(
    nalix_session_t* session,
    const uint8_t* pinned_server_key,
    bool allow_tofu,
    uint32_t timeout_ms,
    nalix_handshake_result_t* result
) {
    (void)timeout_ms;
    if (!session || !session->transport_handle) {
        return nalix_status_create(NALIX_STATUS_FAILED_PRECONDITION, "Session must be connected to perform handshake");
    }

    /* 1. Generate client ephemeral keypair and client nonce */
    uint8_t client_private_key[32];
    uint8_t client_public_key[32];
    uint8_t client_nonce[32];

    fill_random_bytes(client_private_key, 32);
    crypto_x25519_public_key(client_public_key, client_private_key);
    fill_random_bytes(client_nonce, 32);

    /* 2. Send SessionInit (OpCode 0x0000, 64 bytes) unencrypted */
    uint8_t init_payload[64];
    memcpy(init_payload, client_public_key, 32);
    memcpy(init_payload + 32, client_nonce, 32);

    nalix_packet_t init_pkt = nalix_packet_create(NALIX_OPCODE_SESSION_INIT, init_payload, sizeof(init_payload));
    nalix_status_t st = nalix_session_send(session, &init_pkt);
    if (!nalix_status_is_ok(&st)) {
        crypto_wipe(client_private_key, 32);
        return st;
    }

    /* 3. Await SessionChallenge (OpCode 0x0006, 6B header + 96B payload) */
    uint8_t challenge_hdr[NALIX_HEADER_SIZE];
    st = receive_exact(session->transport_handle, challenge_hdr, sizeof(challenge_hdr));
    if (!nalix_status_is_ok(&st)) {
        crypto_wipe(client_private_key, 32);
        return st;
    }

    uint16_t challenge_opcode = (uint16_t)challenge_hdr[0] | ((uint16_t)challenge_hdr[1] << 8);
    if (challenge_opcode != NALIX_OPCODE_SESSION_CHALLENGE) {
        crypto_wipe(client_private_key, 32);
        return nalix_status_create(NALIX_STATUS_INVALID_ARGUMENT, "Expected SessionChallenge opcode");
    }

    uint8_t challenge_payload[96];
    st = receive_exact(session->transport_handle, challenge_payload, sizeof(challenge_payload));
    if (!nalix_status_is_ok(&st)) {
        crypto_wipe(client_private_key, 32);
        return st;
    }

    const uint8_t* server_public_key = challenge_payload;
    const uint8_t* server_nonce = challenge_payload + 32;
    const uint8_t* server_proof = challenge_payload + 64;

    /* 4. Server Key verification (TOFU vs Pinned) */
    const uint8_t* trusted_server_key = pinned_server_key;
    if (!trusted_server_key) {
        if (!allow_tofu) {
            crypto_wipe(client_private_key, 32);
            return nalix_status_create(NALIX_STATUS_PERMISSION_DENIED, "ServerPublicKey is required when allow_tofu is disabled");
        }
        trusted_server_key = server_public_key;
    }

    /* 5. Diffie-Hellman Key Agreement */
    uint8_t shared_secret_ee[32];
    uint8_t shared_secret_se[32];
    crypto_x25519(shared_secret_ee, client_private_key, server_public_key);
    crypto_x25519(shared_secret_se, client_private_key, trusted_server_key);
    crypto_wipe(client_private_key, 32);

    /* 6. Compute Master Secret & Transcript Hash */
    uint8_t master_secret[32];
    nalix_handshake_compute_master_secret(shared_secret_ee, shared_secret_se, master_secret);
    crypto_wipe(shared_secret_ee, 32);
    crypto_wipe(shared_secret_se, 32);

    uint8_t transcript_hash[32];
    nalix_handshake_compute_transcript_hash(
        client_public_key,
        client_nonce,
        server_public_key,
        server_nonce,
        transcript_hash
    );

    /* 7. Verify Server Proof (MitM protection) */
    uint8_t expected_server_proof[32];
    nalix_handshake_compute_server_proof(master_secret, transcript_hash, expected_server_proof);
    if (memcmp(server_proof, expected_server_proof, 32) != 0) {
        crypto_wipe(master_secret, 32);
        return nalix_status_create(NALIX_STATUS_UNAUTHENTICATED, "SessionChallenge proof invalid: MitM detected");
    }

    /* 8. Derive Session Key */
    uint8_t session_key[32];
    nalix_handshake_derive_session_key(master_secret, client_nonce, server_nonce, transcript_hash, session_key);

    /* 9. Send SessionProof (OpCode 0x0003, 32 bytes client proof) unencrypted */
    uint8_t client_proof[32];
    nalix_handshake_compute_client_proof(master_secret, transcript_hash, client_proof);

    nalix_packet_t proof_pkt = nalix_packet_create(NALIX_OPCODE_SESSION_PROOF, client_proof, sizeof(client_proof));
    st = nalix_session_send(session, &proof_pkt);
    if (!nalix_status_is_ok(&st)) {
        crypto_wipe(master_secret, 32);
        crypto_wipe(session_key, 32);
        return st;
    }

    /* 10. Await SessionEstablished (OpCode 0x0007) */
    uint8_t est_hdr[NALIX_HEADER_SIZE];
    st = receive_exact(session->transport_handle, est_hdr, sizeof(est_hdr));
    if (!nalix_status_is_ok(&st)) {
        crypto_wipe(master_secret, 32);
        crypto_wipe(session_key, 32);
        return st;
    }

    uint16_t est_opcode = (uint16_t)est_hdr[0] | ((uint16_t)est_hdr[1] << 8);
    uint8_t est_flags = est_hdr[2];
    if (est_opcode != NALIX_OPCODE_SESSION_ESTABLISHED) {
        crypto_wipe(master_secret, 32);
        crypto_wipe(session_key, 32);
        return nalix_status_create(NALIX_STATUS_INVALID_ARGUMENT, "Expected SessionEstablished opcode");
    }

    uint8_t est_raw[256];
    size_t est_raw_len = 0;
    if (est_flags & NALIX_PACKET_FLAG_ENCRYPTED) {
        /* Encrypted envelope: 40 bytes payload + 40 overhead = 80 bytes */
        est_raw_len = 40 + NALIX_ENVELOPE_OVERHEAD;
    } else {
        est_raw_len = 40;
    }

    st = receive_exact(session->transport_handle, est_raw, est_raw_len);
    if (!nalix_status_is_ok(&st)) {
        crypto_wipe(master_secret, 32);
        crypto_wipe(session_key, 32);
        return st;
    }

    uint8_t est_payload[40];
    if (est_flags & NALIX_PACKET_FLAG_ENCRYPTED) {
        size_t decrypted_len = 0;
        st = nalix_decrypt_envelope(session_key, est_raw, est_raw_len, est_payload, sizeof(est_payload), &decrypted_len);
        if (!nalix_status_is_ok(&st) || decrypted_len < 40) {
            crypto_wipe(master_secret, 32);
            crypto_wipe(session_key, 32);
            return nalix_status_create(NALIX_STATUS_UNAUTHENTICATED, "Failed to decrypt SessionEstablished envelope");
        }
    } else {
        memcpy(est_payload, est_raw, 40);
    }

    /* 11. Verify Server Finish Proof */
    uint8_t expected_finish_proof[32];
    nalix_handshake_compute_server_finish_proof(master_secret, transcript_hash, expected_finish_proof);
    crypto_wipe(master_secret, 32);

    if (memcmp(est_payload, expected_finish_proof, 32) != 0) {
        crypto_wipe(session_key, 32);
        return nalix_status_create(NALIX_STATUS_UNAUTHENTICATED, "SessionEstablished proof invalid");
    }

    /* 12. Parse Session Token (uint64 LE at offset 32) */
    uint64_t session_token = 0;
    for (int i = 0; i < 8; i++) {
        session_token |= ((uint64_t)est_payload[32 + i]) << (i * 8);
    }

    if (result) {
        memcpy(result->session_key, session_key, 32);
        result->session_token = session_token;
        memcpy(result->server_public_key, server_public_key, 32);
    }

    crypto_wipe(session_key, 32);
    return nalix_status_ok();
}
