/**
 * Reserved OpCodes for Nalix system and protocol-level control frames.
 * OpCodes 0x0000..0x00FF are reserved by the Nalix framework.
 * Matches Nalix.Abstractions.Networking.Protocols.ProtocolOpCode.
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
  POW_CHALLENGE = 0x000A,
  POW_PROOF = 0x000B,
}

/**
 * Control message subtypes for SYSTEM_CONTROL and SYSTEM_TIMESYNC packets.
 * Matches Nalix.Abstractions.Networking.Protocols.ControlType.
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
  NOTICE = 0x0D,
  TIMEOUT = 0x10,
  FAIL = 0x11,
  TIMESYNCREQUEST = 0x12,
  TIMESYNCRESPONSE = 0x13,
  CIPHER_UPDATE = 0x14,
  CIPHER_UPDATE_ACK = 0x15,
  PUBLIC_KEY_REQUEST = 0x16,
  POW_REQUEST = 0x17,
  SESSION_REKEY = 0x18,
  SESSION_REKEY_ACK = 0x19,
  RESERVED1 = 0xFE,
  RESERVED2 = 0xFF,
}
