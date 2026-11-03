/**
 * Reserved OpCodes for Nalix system and protocol-level control frames.
 * OpCodes 0x0000..0x00FF are reserved by the Nalix framework.
 */
export enum ProtocolOpCode {
  SESSION_INIT = 0x0000,
  SYSTEM_CONTROL = 0x0001,
  SESSION_SIGNAL = 0x0002,
  SESSION_PROOF = 0x0003,
  SYSTEM_TIMESYNC = 0x0004,
  SESSION_TOFU = 0x0005,
  SESSION_CHALLENGE = 0x0006,
  SESSION_ESTABLISHED = 0x0007,
  SYSTEM_DIRECTIVE = 0x0008,
  SESSION_REKEY = 0x0009,
}

/**
 * Control message subtypes for SYSTEM_CONTROL packets.
 */
export enum ControlType {
  NONE = 0x00,
  PING = 0x01,
  PONG = 0x02,
  DISCONNECT = 0x04,
  ERROR = 0x05,
  RESUME = 0x09,
  SHUTDOWN = 0x0A,
  REDIRECT = 0x0B,
}
