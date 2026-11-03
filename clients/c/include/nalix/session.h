#ifndef NALIX_SESSION_H
#define NALIX_SESSION_H

#include "nalix/client.h"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief Represents an active transport session in C, matching TransportSession / TcpSession from Nalix C#.
 */
typedef struct nalix_client nalix_session_t;
typedef nalix_session_t nalix_tcp_session_t;

/**
 * @brief Initializes a transport session with given configuration.
 */
static inline nalix_status_t nalix_session_init(
    nalix_session_t* session,
    const nalix_channel_config_t* config,
    void* user_data
) {
    return nalix_client_init(session, config, user_data);
}

/**
 * @brief Establishes connection to the configured endpoint.
 */
static inline nalix_status_t nalix_session_connect(nalix_session_t* session) {
    return nalix_client_connect(session);
}

/**
 * @brief Sends a packet over the active session.
 */
static inline nalix_status_t nalix_session_send(
    nalix_session_t* session,
    const nalix_packet_t* packet
) {
    return nalix_client_send(session, packet);
}

/**
 * @brief Disconnects and shuts down the active session.
 */
static inline nalix_status_t nalix_session_disconnect(nalix_session_t* session) {
    return nalix_client_disconnect(session);
}

/**
 * @brief Destroys and cleans up session resources.
 */
static inline void nalix_session_destroy(nalix_session_t* session) {
    nalix_client_destroy(session);
}

#ifdef __cplusplus
}
#endif

#endif /* NALIX_SESSION_H */
