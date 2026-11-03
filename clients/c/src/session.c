#include "nalix/session.h"
#include "third_party/monocypher/monocypher.h"
#include <string.h>
#include <stdio.h>

#ifdef _WIN32
#include <winsock2.h>
#include <ws2tcpip.h>
#ifdef _MSC_VER
#pragma comment(lib, "ws2_32.lib")
#endif
typedef SOCKET nalix_socket_t;
#define NALIX_INVALID_SOCKET INVALID_SOCKET
#define NALIX_CLOSESOCKET closesocket
#else
#include <sys/types.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <netdb.h>
#include <unistd.h>
typedef int nalix_socket_t;
#define NALIX_INVALID_SOCKET (-1)
#define NALIX_CLOSESOCKET close
#endif

nalix_channel_config_t nalix_channel_config_default(const char* host, uint16_t port) {
    nalix_channel_config_t config;
    config.host = host;
    config.port = port;
    config.connect_timeout_ms = 5000;
    config.request_timeout_ms = 10000;
    config.keepalive_interval_ms = 30000;
    config.max_receive_message_length = 65536;
    config.max_send_message_length = 65536;
    config.allow_tofu = true;
    config.server_public_key = NULL;
    return config;
}

const char* nalix_connectivity_state_to_string(nalix_connectivity_state_t state) {
    switch (state) {
        case NALIX_CHANNEL_IDLE: return "IDLE";
        case NALIX_CHANNEL_CONNECTING: return "CONNECTING";
        case NALIX_CHANNEL_READY: return "READY";
        case NALIX_CHANNEL_TRANSIENT_FAILURE: return "TRANSIENT_FAILURE";
        case NALIX_CHANNEL_SHUTDOWN: return "SHUTDOWN";
        default: return "UNKNOWN_STATE";
    }
}

nalix_status_t nalix_session_init(
    nalix_session_t* session,
    const nalix_channel_config_t* config,
    void* user_data
) {
    if (!session || !config) {
        return nalix_status_create(NALIX_STATUS_INVALID_ARGUMENT, "Null pointer argument provided");
    }

    memset(session, 0, sizeof(nalix_session_t));
    session->config = *config;
    session->state = NALIX_CHANNEL_IDLE;
    session->user_data = user_data;
    session->transport_handle = (void*)(intptr_t)NALIX_INVALID_SOCKET;
    session->session_state.next_seq16 = 1;
    session->session_state.envelope_seq32 = 0;
    session->session_state.encryption_enabled = false;
    return nalix_status_ok();
}

nalix_status_t nalix_session_connect(nalix_session_t* session) {
    if (!session) {
        return nalix_status_create(NALIX_STATUS_INVALID_ARGUMENT, "Null session pointer");
    }

    if (session->state == NALIX_CHANNEL_READY) {
        return nalix_status_ok();
    }

    session->state = NALIX_CHANNEL_CONNECTING;
    if (session->on_state) {
        session->on_state(session, NALIX_CHANNEL_CONNECTING, session->user_data);
    }

#ifdef _WIN32
    WSADATA wsa;
    if (WSAStartup(MAKEWORD(2, 2), &wsa) != 0) {
        session->state = NALIX_CHANNEL_TRANSIENT_FAILURE;
        return nalix_status_create(NALIX_STATUS_INTERNAL, "WSAStartup failed");
    }
#endif

    nalix_socket_t sock = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (sock == NALIX_INVALID_SOCKET) {
        session->state = NALIX_CHANNEL_TRANSIENT_FAILURE;
        return nalix_status_create(NALIX_STATUS_INTERNAL, "Failed to create TCP socket");
    }

    struct sockaddr_in server_addr;
    memset(&server_addr, 0, sizeof(server_addr));
    server_addr.sin_family = AF_INET;
    server_addr.sin_port = htons(session->config.port);

    if (inet_pton(AF_INET, session->config.host, &server_addr.sin_addr) <= 0) {
        struct hostent* he = gethostbyname(session->config.host);
        if (!he) {
            NALIX_CLOSESOCKET(sock);
            session->state = NALIX_CHANNEL_TRANSIENT_FAILURE;
            return nalix_status_create(NALIX_STATUS_NOT_FOUND, "Failed to resolve host");
        }
        memcpy(&server_addr.sin_addr, he->h_addr_list[0], he->h_length);
    }

    if (connect(sock, (struct sockaddr*)&server_addr, sizeof(server_addr)) < 0) {
        NALIX_CLOSESOCKET(sock);
        session->state = NALIX_CHANNEL_TRANSIENT_FAILURE;
        return nalix_status_create(NALIX_STATUS_UNAVAILABLE, "Connection refused or unreachable");
    }

    session->transport_handle = (void*)(intptr_t)sock;
    session->state = NALIX_CHANNEL_READY;
    if (session->on_state) {
        session->on_state(session, NALIX_CHANNEL_READY, session->user_data);
    }

    return nalix_status_ok();
}

uint16_t nalix_session_next_sequence_id(nalix_session_t* session) {
    if (!session) return 0;
    if (session->session_state.next_seq16 == 0) {
        session->session_state.next_seq16 = 1;
    }
    return session->session_state.next_seq16++;
}

void nalix_session_set_secret(nalix_session_t* session, const uint8_t secret[32]) {
    if (!session || !secret) return;
    memcpy(session->session_state.secret, secret, 32);
}

void nalix_session_enable_encryption(nalix_session_t* session) {
    if (!session) return;
    session->session_state.encryption_enabled = true;
}

void nalix_session_disable_encryption(nalix_session_t* session) {
    if (!session) return;
    session->session_state.encryption_enabled = false;
}

nalix_status_t nalix_session_send(
    nalix_session_t* session,
    const nalix_packet_t* packet
) {
    if (!session || !packet) {
        return nalix_status_create(NALIX_STATUS_INVALID_ARGUMENT, "Null pointer argument");
    }

    if (session->state != NALIX_CHANNEL_READY) {
        return nalix_status_create(NALIX_STATUS_UNAVAILABLE, "Session is not connected");
    }

    nalix_socket_t sock = (nalix_socket_t)(intptr_t)session->transport_handle;
    if (sock == NALIX_INVALID_SOCKET) {
        return nalix_status_create(NALIX_STATUS_UNAVAILABLE, "Invalid socket descriptor");
    }

    uint8_t buffer[65536];
    size_t written = 0;
    nalix_status_t pipe_st = nalix_pipeline_process_outbound(
        &session->session_state,
        packet,
        buffer,
        sizeof(buffer),
        &written
    );
    if (!nalix_status_is_ok(&pipe_st)) {
        return pipe_st;
    }

    int bytes_sent = send(sock, (const char*)buffer, (int)written, 0);
    if (bytes_sent < 0 || (size_t)bytes_sent != written) {
        return nalix_status_create(NALIX_STATUS_INTERNAL, "Socket send failed");
    }

    return nalix_status_ok();
}

nalix_status_t nalix_session_handshake(
    nalix_session_t* session,
    nalix_handshake_result_t* result
) {
    if (!session) {
        return nalix_status_create(NALIX_STATUS_INVALID_ARGUMENT, "Null session pointer");
    }

    nalix_handshake_result_t local_res;
    nalix_status_t st = nalix_handshake_perform(
        session,
        session->config.server_public_key,
        session->config.allow_tofu,
        session->config.connect_timeout_ms,
        &local_res
    );

    if (!nalix_status_is_ok(&st)) {
        return st;
    }

    memcpy(session->session_state.secret, local_res.session_key, 32);
    session->session_state.session_token = local_res.session_token;
    session->session_state.encryption_enabled = true;

    if (result) {
        *result = local_res;
    }

    crypto_wipe(local_res.session_key, 32);
    return nalix_status_ok();
}

nalix_status_t nalix_session_disconnect(nalix_session_t* session) {
    if (!session) {
        return nalix_status_create(NALIX_STATUS_INVALID_ARGUMENT, "Null session pointer");
    }

    nalix_socket_t sock = (nalix_socket_t)(intptr_t)session->transport_handle;
    if (sock != NALIX_INVALID_SOCKET) {
        NALIX_CLOSESOCKET(sock);
        session->transport_handle = (void*)(intptr_t)NALIX_INVALID_SOCKET;
    }

    session->state = NALIX_CHANNEL_SHUTDOWN;
    if (session->on_state) {
        session->on_state(session, NALIX_CHANNEL_SHUTDOWN, session->user_data);
    }

    return nalix_status_ok();
}

void nalix_session_destroy(nalix_session_t* session) {
    if (!session) return;
    nalix_session_disconnect(session);
    crypto_wipe(session->session_state.secret, 32);
    memset(session, 0, sizeof(nalix_session_t));
}
