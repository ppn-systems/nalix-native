#include "nalix/status.h"

nalix_status_t nalix_status_ok(void) {
    nalix_status_t status;
    status.code = NALIX_STATUS_OK;
    status.message = "OK";
    return status;
}

nalix_status_t nalix_status_create(nalix_status_code_t code, const char* message) {
    nalix_status_t status;
    status.code = code;
    status.message = (message != (void*)0) ? message : nalix_status_code_to_string(code);
    return status;
}

bool nalix_status_is_ok(const nalix_status_t* status) {
    if (!status) return false;
    return status->code == NALIX_STATUS_OK;
}

const char* nalix_status_code_to_string(nalix_status_code_t code) {
    switch (code) {
        case NALIX_STATUS_OK: return "OK";
        case NALIX_STATUS_CANCELLED: return "CANCELLED";
        case NALIX_STATUS_UNKNOWN: return "UNKNOWN";
        case NALIX_STATUS_INVALID_ARGUMENT: return "INVALID_ARGUMENT";
        case NALIX_STATUS_DEADLINE_EXCEEDED: return "DEADLINE_EXCEEDED";
        case NALIX_STATUS_NOT_FOUND: return "NOT_FOUND";
        case NALIX_STATUS_ALREADY_EXISTS: return "ALREADY_EXISTS";
        case NALIX_STATUS_PERMISSION_DENIED: return "PERMISSION_DENIED";
        case NALIX_STATUS_RESOURCE_EXHAUSTED: return "RESOURCE_EXHAUSTED";
        case NALIX_STATUS_FAILED_PRECONDITION: return "FAILED_PRECONDITION";
        case NALIX_STATUS_ABORTED: return "ABORTED";
        case NALIX_STATUS_OUT_OF_RANGE: return "OUT_OF_RANGE";
        case NALIX_STATUS_UNIMPLEMENTED: return "UNIMPLEMENTED";
        case NALIX_STATUS_INTERNAL: return "INTERNAL";
        case NALIX_STATUS_UNAVAILABLE: return "UNAVAILABLE";
        case NALIX_STATUS_DATA_LOSS: return "DATA_LOSS";
        case NALIX_STATUS_UNAUTHENTICATED: return "UNAUTHENTICATED";
        default: return "UNKNOWN_STATUS_CODE";
    }
}
