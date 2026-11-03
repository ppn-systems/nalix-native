#ifndef NALIX_CLIENT_H
#define NALIX_CLIENT_H

#include "nalix/status.h"
#include "nalix/packet.h"
#include "nalix/channel.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef struct nalix_client nalix_client_t;

/**
 * @brief Callback invoked when a packet is received asynchronously.
 */
typedef void (*nalix_packet_received_cb)(
    nalix_client_t* client,
    const nalix_packet_t* packet,
    void* user_data
);

/**
 * @brief Callback invoked when the channel connectivity state changes.
 */
typedef void (*nalix_state_changed_cb)(
    nalix_client_t* client,
    nalix_connectivity_state_t new_state,
    void* user_data
);

/**
 * @brief Nalix client instance representation.
 */
struct nalix_client {
    nalix_channel_config_t config;
    nalix_connectivity_state_t state;
    nalix_packet_received_cb on_packet;
    nalix_state_changed_cb on_state;
    void* user_data;
    void* transport_handle;
};

/**
 * @brief Initializes a Nalix client with given configuration.
 */
nalix_status_t nalix_client_init(
    nalix_client_t* client,
    const nalix_channel_config_t* config,
    void* user_data
);

/**
 * @brief Establishes connection to the configured endpoint.
 */
nalix_status_t nalix_client_connect(nalix_client_t* client);

/**
 * @brief Sends a packet over the active channel.
 */
nalix_status_t nalix_client_send(
    nalix_client_t* client,
    const nalix_packet_t* packet
);

/**
 * @brief Disconnects and shuts down the active client channel.
 */
nalix_status_t nalix_client_disconnect(nalix_client_t* client);

/**
 * @brief Destroys and cleans up client resources.
 */
void nalix_client_destroy(nalix_client_t* client);

#ifdef __cplusplus
}
#endif

#endif /* NALIX_CLIENT_H */
