#include "nalix/client.h"
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

nalix_status_t nalix_client_init(
    nalix_client_t* client,
    const nalix_channel_config_t* config,
    void* user_data
) {
    if (!client || !config) {
        return nalix_status_create(NALIX_STATUS_INVALID_ARGUMENT, "Null pointer argument provided");
    }

    memset(client, 0, sizeof(nalix_client_t));
    client->config = *config;
    client->state = NALIX_CHANNEL_IDLE;
    client->user_data = user_data;
    client->transport_handle = (void*)(intptr_t)NALIX_INVALID_SOCKET;
    return nalix_status_ok();
}

nalix_status_t nalix_client_connect(nalix_client_t* client) {
    if (!client) {
        return nalix_status_create(NALIX_STATUS_INVALID_ARGUMENT, "Null client pointer");
    }

    if (client->state == NALIX_CHANNEL_READY) {
        return nalix_status_ok();
    }

    client->state = NALIX_CHANNEL_CONNECTING;
    if (client->on_state) {
        client->on_state(client, NALIX_CHANNEL_CONNECTING, client->user_data);
    }

#ifdef _WIN32
    WSADATA wsa;
    if (WSAStartup(MAKEWORD(2, 2), &wsa) != 0) {
        client->state = NALIX_CHANNEL_TRANSIENT_FAILURE;
        return nalix_status_create(NALIX_STATUS_INTERNAL, "WSAStartup failed");
    }
#endif

    nalix_socket_t sock = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (sock == NALIX_INVALID_SOCKET) {
        client->state = NALIX_CHANNEL_TRANSIENT_FAILURE;
        return nalix_status_create(NALIX_STATUS_INTERNAL, "Failed to create TCP socket");
    }

    struct sockaddr_in server_addr;
    memset(&server_addr, 0, sizeof(server_addr));
    server_addr.sin_family = AF_INET;
    server_addr.sin_port = htons(client->config.port);

    if (inet_pton(AF_INET, client->config.host, &server_addr.sin_addr) <= 0) {
        /* If not raw IP, resolve hostname */
        struct hostent* he = gethostbyname(client->config.host);
        if (!he) {
            NALIX_CLOSESOCKET(sock);
            client->state = NALIX_CHANNEL_TRANSIENT_FAILURE;
            return nalix_status_create(NALIX_STATUS_NOT_FOUND, "Failed to resolve host");
        }
        memcpy(&server_addr.sin_addr, he->h_addr_list[0], he->h_length);
    }

    if (connect(sock, (struct sockaddr*)&server_addr, sizeof(server_addr)) < 0) {
        NALIX_CLOSESOCKET(sock);
        client->state = NALIX_CHANNEL_TRANSIENT_FAILURE;
        return nalix_status_create(NALIX_STATUS_UNAVAILABLE, "Connection refused or unreachable");
    }

    client->transport_handle = (void*)(intptr_t)sock;
    client->state = NALIX_CHANNEL_READY;
    if (client->on_state) {
        client->on_state(client, NALIX_CHANNEL_READY, client->user_data);
    }

    return nalix_status_ok();
}

nalix_status_t nalix_client_send(
    nalix_client_t* client,
    const nalix_packet_t* packet
) {
    if (!client || !packet) {
        return nalix_status_create(NALIX_STATUS_INVALID_ARGUMENT, "Null pointer argument");
    }

    if (client->state != NALIX_CHANNEL_READY) {
        return nalix_status_create(NALIX_STATUS_UNAVAILABLE, "Channel is not connected");
    }

    nalix_socket_t sock = (nalix_socket_t)(intptr_t)client->transport_handle;
    if (sock == NALIX_INVALID_SOCKET) {
        return nalix_status_create(NALIX_STATUS_UNAVAILABLE, "Invalid socket descriptor");
    }

    uint8_t buffer[4096];
    size_t written = 0;
    nalix_status_t encode_st = nalix_packet_encode(packet, buffer, sizeof(buffer), &written);
    if (!nalix_status_is_ok(&encode_st)) {
        return encode_st;
    }

    int bytes_sent = send(sock, (const char*)buffer, (int)written, 0);
    if (bytes_sent < 0 || (size_t)bytes_sent != written) {
        return nalix_status_create(NALIX_STATUS_INTERNAL, "Socket send failed");
    }

    return nalix_status_ok();
}

nalix_status_t nalix_client_disconnect(nalix_client_t* client) {
    if (!client) {
        return nalix_status_create(NALIX_STATUS_INVALID_ARGUMENT, "Null client pointer");
    }

    nalix_socket_t sock = (nalix_socket_t)(intptr_t)client->transport_handle;
    if (sock != NALIX_INVALID_SOCKET) {
        NALIX_CLOSESOCKET(sock);
        client->transport_handle = (void*)(intptr_t)NALIX_INVALID_SOCKET;
    }

    client->state = NALIX_CHANNEL_SHUTDOWN;
    if (client->on_state) {
        client->on_state(client, NALIX_CHANNEL_SHUTDOWN, client->user_data);
    }

    return nalix_status_ok();
}

void nalix_client_destroy(nalix_client_t* client) {
    if (!client) return;
    nalix_client_disconnect(client);
    memset(client, 0, sizeof(nalix_client_t));
}
