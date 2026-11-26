import { ControlFlags, ControlType, ProtocolAdvice, ProtocolOpCode, ProtocolReason } from './protocol.js';
import { Packet } from './packet.js';
import { NalixStatus, StatusCode } from './status.js';

/** Serialized size of a SYSTEM_DIRECTIVE payload. */
export const DIRECTIVE_PAYLOAD_SIZE = 15;

/**
 * A decoded SYSTEM_DIRECTIVE (0x0008) frame.
 * Matches Nalix.Codec.ProtocolFrames.Directive. Payload layout (little-endian):
 *   [0]      Type    (ControlType, uint8)
 *   [1..2]   Reason  (ProtocolReason, uint16)
 *   [3]      Action  (ProtocolAdvice, uint8)
 *   [4]      Control (ControlFlags, uint8)
 *   [5..8]   Arg0    (uint32)
 *   [9..12]  Arg1    (uint32)
 *   [13..14] Arg2    (uint16)
 */
export interface Directive {
  type: ControlType;
  reason: ProtocolReason;
  action: ProtocolAdvice;
  control: ControlFlags;
  arg0: number;
  arg1: number;
  arg2: number;
  sequenceId: number;
}

export function decodeDirective(packet: Packet): Directive {
  if (packet.header.opcode !== ProtocolOpCode.SYSTEM_DIRECTIVE) {
    throw new NalixStatus(StatusCode.INVALID_ARGUMENT, `Not a SYSTEM_DIRECTIVE frame (opcode 0x${packet.header.opcode.toString(16)})`);
  }
  const p = packet.payload;
  if (p.length < DIRECTIVE_PAYLOAD_SIZE) {
    throw new NalixStatus(
      StatusCode.DATA_LOSS,
      `SYSTEM_DIRECTIVE payload too small: expected ${DIRECTIVE_PAYLOAD_SIZE}, got ${p.length}`
    );
  }
  const view = new DataView(p.buffer, p.byteOffset, p.byteLength);
  return {
    type: p[0] as ControlType,
    reason: view.getUint16(1, true) as ProtocolReason,
    action: p[3] as ProtocolAdvice,
    control: p[4] as ControlFlags,
    arg0: view.getUint32(5, true),
    arg1: view.getUint32(9, true),
    arg2: view.getUint16(13, true),
    sequenceId: packet.header.sequenceId,
  };
}

export function encodeDirective(d: Omit<Directive, 'sequenceId'>): Uint8Array {
  const out = new Uint8Array(DIRECTIVE_PAYLOAD_SIZE);
  const view = new DataView(out.buffer);
  out[0] = d.type;
  view.setUint16(1, d.reason, true);
  out[3] = d.action;
  out[4] = d.control;
  view.setUint32(5, d.arg0 >>> 0, true);
  view.setUint32(9, d.arg1 >>> 0, true);
  view.setUint16(13, d.arg2 & 0xffff, true);
  return out;
}

/**
 * Maps a server FAIL directive to the status a pending request is rejected with.
 * A RATE_LIMITED / RETRY / IS_TRANSIENT directive is what the host sends when it drops a request
 * under backpressure (Nalix 14.4.0, ppn-systems/nalix#520).
 */
export function directiveToStatus(d: Directive): NalixStatus {
  const reasonName = ProtocolReason[d.reason] ?? String(d.reason);
  const adviceName = ProtocolAdvice[d.action] ?? String(d.action);
  let code: StatusCode;
  switch (d.reason) {
    case ProtocolReason.RATE_LIMITED:
    case ProtocolReason.THROTTLED:
    case ProtocolReason.OVERLOADED:
    case ProtocolReason.RESOURCE_LIMIT:
    case ProtocolReason.CONNECTION_LIMIT:
    case ProtocolReason.CREDIT_EXHAUSTED:
    case ProtocolReason.WINDOW_EXCEEDED:
    case ProtocolReason.SLOW_CONSUMER:
      code = StatusCode.RESOURCE_EXHAUSTED;
      break;
    case ProtocolReason.UNAUTHENTICATED:
    case ProtocolReason.TOKEN_EXPIRED:
    case ProtocolReason.TOKEN_REVOKED:
      code = StatusCode.UNAUTHENTICATED;
      break;
    case ProtocolReason.UNAUTHORIZED:
    case ProtocolReason.FORBIDDEN:
      code = StatusCode.PERMISSION_DENIED;
      break;
    case ProtocolReason.TIMEOUT:
      code = StatusCode.DEADLINE_EXCEEDED;
      break;
    case ProtocolReason.SERVER_SHUTDOWN:
    case ProtocolReason.SERVICE_UNAVAILABLE:
    case ProtocolReason.MAINTENANCE:
      code = StatusCode.UNAVAILABLE;
      break;
    default:
      code = (d.control & ControlFlags.IS_TRANSIENT) !== 0 ? StatusCode.UNAVAILABLE : StatusCode.ABORTED;
  }
  return new NalixStatus(code, `Server rejected the request: ${reasonName} (advice ${adviceName})`, {
    reason: d.reason,
    advice: d.action,
    transient: (d.control & ControlFlags.IS_TRANSIENT) !== 0,
  });
}
