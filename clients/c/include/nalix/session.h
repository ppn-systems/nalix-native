#ifndef NALIX_SESSION_H
#define NALIX_SESSION_H

#include "nalix/status.h"
#include "nalix/packet.h"
#include "nalix/channel.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef struct nalix_session nalix_session_t;
typedef nalix_session_t nalix_tcp_session_t;

/**
 * @brief Callback invoked when a packet is received asynchronously on a session.
 */
typedef void (*nalix_session_packet_received_cb)(
    nalix_session_t* session,
    const nalix_packet_t* packet,
    void* user_data
);

/**
 * @brief Callback invoked when the session connectivity state changes.
 */
typedef void (*nalix_session_state_changed_cb)(
    nalix_session_t* session,
    nalix_connectivity_state_t new_state,
    void* user_data
);

/**
 * @brief Nalix transport session representation. Matches TransportSession / TcpSession from Nalix C#.
 */
struct nalix_session {
    nalix_channel_config_t config;
    nalix_connectivity_state_t state;
    nalix_session_packet_received_cb on_packet;
    nalix_session_state_changed_cb on_state;
    void* user_data;
    void* transport_handle;
};

/**
 * @brief Initializes a Nalix session with given configuration.
 */
nalix_status_t nalix_session_init(
    nalix_session_t* session,
    const nalix_channel_config_t* config,
    void* user_data
);

/**
 * @brief Establishes connection to the configured endpoint.
 */
nalix_status_t nalix_session_connect(nalix_session_t* session);

/**
 * @brief Sends a packet over the active session.
 */
nalix_status_t nalix_session_send(
    nalix_session_t* session,
    const nalix_packet_t* packet
);

/**
 * @brief Disconnects and shuts down the active session.
 */
nalix_status_t nalix_session_disconnect(nalix_session_t* session);

/**
 * @brief Destroys and cleans up session resources.
 */
void nalix_session_destroy(nalix_session_t* session);

#ifdef __cplusplus
}
#endif

#endif /* NALIX_SESSION_H */
