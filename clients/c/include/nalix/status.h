#ifndef NALIX_STATUS_H
#define NALIX_STATUS_H

#include <stdint.h>
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief Canonical status codes for Nalix client operations.
 */
typedef enum nalix_status_code {
    NALIX_STATUS_OK                  = 0,
    NALIX_STATUS_CANCELLED           = 1,
    NALIX_STATUS_UNKNOWN             = 2,
    NALIX_STATUS_INVALID_ARGUMENT    = 3,
    NALIX_STATUS_DEADLINE_EXCEEDED   = 4,
    NALIX_STATUS_NOT_FOUND           = 5,
    NALIX_STATUS_ALREADY_EXISTS      = 6,
    NALIX_STATUS_PERMISSION_DENIED   = 7,
    NALIX_STATUS_RESOURCE_EXHAUSTED  = 8,
    NALIX_STATUS_FAILED_PRECONDITION = 9,
    NALIX_STATUS_ABORTED             = 10,
    NALIX_STATUS_OUT_OF_RANGE        = 11,
    NALIX_STATUS_UNIMPLEMENTED       = 12,
    NALIX_STATUS_INTERNAL            = 13,
    NALIX_STATUS_UNAVAILABLE         = 14,
    NALIX_STATUS_DATA_LOSS           = 15,
    NALIX_STATUS_UNAUTHENTICATED     = 16
} nalix_status_code_t;

/**
 * @brief Status structure representing operation outcome.
 */
typedef struct nalix_status {
    nalix_status_code_t code;
    const char* message;
} nalix_status_t;

/**
 * @brief Creates a successful status (OK).
 */
nalix_status_t nalix_status_ok(void);

/**
 * @brief Creates a status with a specific code and error message.
 */
nalix_status_t nalix_status_create(nalix_status_code_t code, const char* message);

/**
 * @brief Returns true if the status represents success (OK).
 */
bool nalix_status_is_ok(const nalix_status_t* status);

/**
 * @brief Returns string description for a status code.
 */
const char* nalix_status_code_to_string(nalix_status_code_t code);

#ifdef __cplusplus
}
#endif

#endif /* NALIX_STATUS_H */
