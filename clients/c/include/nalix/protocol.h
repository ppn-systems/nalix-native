#ifndef NALIX_PROTOCOL_H
#define NALIX_PROTOCOL_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief Nalix Standard Protocol OpCodes.
 */
typedef enum nalix_protocol_opcode {
    NALIX_OPCODE_SESSION_INIT         = 0x0000,
    NALIX_OPCODE_CONTROL              = 0x0001,
    NALIX_OPCODE_SESSION_RESUME       = 0x0002,
    NALIX_OPCODE_SESSION_PROOF        = 0x0003,
    NALIX_OPCODE_TIME_SYNC            = 0x0004,
    NALIX_OPCODE_SESSION_TOFU         = 0x0005,
    NALIX_OPCODE_SESSION_CHALLENGE    = 0x0006,
    NALIX_OPCODE_SESSION_ESTABLISHED  = 0x0007,
    NALIX_OPCODE_DIRECTIVE            = 0x0008,
    NALIX_OPCODE_POW_CHALLENGE        = 0x000A,
    NALIX_OPCODE_POW_PROOF            = 0x000B
} nalix_protocol_opcode_t;

#ifdef __cplusplus
}
#endif

#endif /* NALIX_PROTOCOL_H */
