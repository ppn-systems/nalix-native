#include "nalix/client.h"
#include <string.h>

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

    /* Transport socket backend will be implemented in dedicated client phase */
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

    /* Transport dispatch will be implemented in dedicated client phase */
    return nalix_status_ok();
}

nalix_status_t nalix_client_disconnect(nalix_client_t* client) {
    if (!client) {
        return nalix_status_create(NALIX_STATUS_INVALID_ARGUMENT, "Null client pointer");
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
