#ifndef NALIX_CHANNEL_H
#define NALIX_CHANNEL_H

#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief Connectivity state matching gRPC channel state machine.
 */
typedef enum nalix_connectivity_state {
    NALIX_CHANNEL_IDLE               = 0,
    NALIX_CHANNEL_CONNECTING         = 1,
    NALIX_CHANNEL_READY              = 2,
    NALIX_CHANNEL_TRANSIENT_FAILURE  = 3,
    NALIX_CHANNEL_SHUTDOWN           = 4
} nalix_connectivity_state_t;

/**
 * @brief Configuration parameters for a Nalix channel.
 */
typedef struct nalix_channel_config {
    const char* host;
    uint16_t port;
    uint32_t connect_timeout_ms;
    uint32_t request_timeout_ms;
    uint32_t keepalive_interval_ms;
    size_t max_receive_message_length;
    size_t max_send_message_length;
} nalix_channel_config_t;

/**
 * @brief Returns the default configuration for a Nalix channel.
 */
nalix_channel_config_t nalix_channel_config_default(const char* host, uint16_t port);

/**
 * @brief Returns string description for a connectivity state.
 */
const char* nalix_connectivity_state_to_string(nalix_connectivity_state_t state);

#ifdef __cplusplus
}
#endif

#endif /* NALIX_CHANNEL_H */
