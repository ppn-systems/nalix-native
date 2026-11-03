import { keccak_256 } from '@noble/hashes/sha3.js';
import { hmac } from '@noble/hashes/hmac.js';
import { Packet, PacketFlags, PacketPriority } from './packet.js';
import { ProtocolOpCode, ProtocolReason, SessionResumeStage } from './protocol.js';
import { NalixStatus, StatusCode } from './status.js';
import { ITransportSession } from './base.js';
import { SessionState } from './state.js';

export const SESSION_RESUME_PAYLOAD_SIZE = 43;

export interface ResumeOptions {
  timeoutMs?: number;
}

export interface ConnectWithResumeOptions {
  timeoutMs?: number;
}

export interface ConnectWithResumeResult {
  resumed: boolean;
  reason: ProtocolReason;
}

/**
 * Checks whether the session state has sufficient cryptographic material for resumption.
 * Matches Nalix.SDK.Transport.Extensions.ResumeExtensions.HasResumeState.
 */
export function hasResumeState(state: SessionState): boolean {
  return state.sessionToken !== 0n && state.secret !== null && state.secret.length === 32;
}

/**
 * Computes proof-of-possession HMAC-Keccak256(Secret, SessionToken || TimeWindow).
 * Uses a 30-second sliding time window matching SEC-16 in Nalix.
 */
export function computeResumeProof(secret: Uint8Array, sessionToken: bigint, timeWindow?: bigint): Uint8Array {
  const window = timeWindow ?? BigInt(Math.floor(Date.now() / 1000 / 30));
  const msg = new Uint8Array(16);
  const view = new DataView(msg.buffer);
  view.setBigUint64(0, sessionToken, true);
  view.setBigInt64(8, window, true);
  return hmac(keccak_256, secret, msg);
}

/**
 * Verifies the server's response proof against current, previous, and next 30s windows to accommodate clock skew.
 */
export function verifyResumeResponseProof(secret: Uint8Array, sessionToken: bigint, proof: Uint8Array): boolean {
  const currentWindow = BigInt(Math.floor(Date.now() / 1000 / 30));
  for (const w of [currentWindow, currentWindow - 1n, currentWindow + 1n]) {
    const expected = computeResumeProof(secret, sessionToken, w);
    if (compareBytes(proof, expected)) {
      return true;
    }
  }
  return false;
}

/**
 * Encodes a 43-byte SESSION_SIGNAL payload.
 * Byte Layout:
 *   [0]:    Stage (uint8, 0x01 = REQUEST, 0x02 = RESPONSE)
 *   [1..8]: SessionToken (uint64 Little-Endian)
 *   [9..10]: Reason (uint16 Little-Endian ProtocolReason)
 *   [11..42]: Proof (32 bytes HMAC-Keccak256)
 */
export function encodeResumePayload(
  stage: SessionResumeStage,
  sessionToken: bigint,
  reason: ProtocolReason,
  proof: Uint8Array
): Uint8Array {
  const payload = new Uint8Array(SESSION_RESUME_PAYLOAD_SIZE);
  const view = new DataView(payload.buffer);
  payload[0] = stage;
  view.setBigUint64(1, sessionToken, true);
  view.setUint16(9, reason, true);
  if (proof.length >= 32) {
    payload.set(proof.subarray(0, 32), 11);
  }
  return payload;
}

/**
 * Decodes a 43-byte SESSION_SIGNAL payload.
 */
export function decodeResumePayload(payload: Uint8Array): {
  stage: SessionResumeStage;
  sessionToken: bigint;
  reason: ProtocolReason;
  proof: Uint8Array;
} {
  if (payload.length < SESSION_RESUME_PAYLOAD_SIZE) {
    throw new NalixStatus(
      StatusCode.INVALID_ARGUMENT,
      `SessionResume payload too small: expected ${SESSION_RESUME_PAYLOAD_SIZE}, got ${payload.length}`
    );
  }
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const stage = payload[0] as SessionResumeStage;
  const sessionToken = view.getBigUint64(1, true);
  const reason = view.getUint16(9, true) as ProtocolReason;
  const proof = payload.subarray(11, 43);

  return { stage, sessionToken, reason, proof };
}

/**
 * Attempts to resume an existing session state on a connected session.
 * Matches Nalix.SDK.Transport.Extensions.ResumeExtensions.ResumeSessionAsync.
 */
export async function resumeSession(
  session: ITransportSession,
  options?: ResumeOptions
): Promise<ProtocolReason> {
  if (!session.isConnected) {
    throw new NalixStatus(StatusCode.FAILED_PRECONDITION, 'Session must be connected to perform resume.');
  }

  if (!hasResumeState(session.sessionState)) {
    return ProtocolReason.SESSION_NOT_FOUND;
  }

  const timeoutMs = options?.timeoutMs ?? session.config.resumeTimeoutMs;
  const secret = session.sessionState.secret!;
  const token = session.sessionState.sessionToken;

  const proof = computeResumeProof(secret, token);
  const payload = encodeResumePayload(SessionResumeStage.REQUEST, token, ProtocolReason.NONE, proof);

  const requestPacket = Packet.create(ProtocolOpCode.SESSION_SIGNAL, payload, {
    flags: PacketFlags.SYSTEM,
    priority: PacketPriority.URGENT,
  });

  try {
    const response = await session.request(requestPacket, {
      timeoutMs,
      encrypt: false,
      predicate: (incoming) =>
        incoming.header.opcode === ProtocolOpCode.SESSION_SIGNAL &&
        incoming.payload.length >= SESSION_RESUME_PAYLOAD_SIZE &&
        incoming.payload[0] === SessionResumeStage.RESPONSE,
    });

    const decoded = decodeResumePayload(response.payload);

    if (decoded.reason !== ProtocolReason.NONE) {
      return decoded.reason;
    }

    // Verify Server Proof of Possession
    const isProofValid = verifyResumeResponseProof(secret, decoded.sessionToken, decoded.proof);
    if (!isProofValid) {
      throw new NalixStatus(
        StatusCode.UNAUTHENTICATED,
        'Session resume response proof is invalid. Possible Man-in-the-Middle attack or clock skew.'
      );
    }

    session.sessionState.sessionToken = decoded.sessionToken;
    session.sessionState.encryptionEnabled = true;
    return ProtocolReason.NONE;
  } catch (err: any) {
    if (err instanceof NalixStatus) {
      if (err.code === StatusCode.DEADLINE_EXCEEDED) {
        return ProtocolReason.TIMEOUT;
      }
      if (err.code === StatusCode.CANCELLED) {
        return ProtocolReason.CANCELLED;
      }
    }
    throw err;
  }
}

/**
 * Connects the session, tries resume when configured and possible, and falls back to full handshake when allowed.
 * Matches Nalix.SDK.Transport.Extensions.ResumeExtensions.ConnectWithResumeDetailedAsync.
 */
export async function connectWithResume(
  session: ITransportSession,
  options?: ConnectWithResumeOptions
): Promise<ConnectWithResumeResult> {
  if (!session.isConnected) {
    await session.connect();
  }

  let reason: ProtocolReason;

  if (!session.config.resumeEnabled) {
    reason = ProtocolReason.LOCAL_POLICY;
  } else if (!hasResumeState(session.sessionState)) {
    reason = ProtocolReason.SESSION_NOT_FOUND;
  } else {
    try {
      reason = await resumeSession(session, options);
      if (reason === ProtocolReason.NONE) {
        return { resumed: true, reason: ProtocolReason.NONE };
      }

      if (!session.config.resumeFallbackToHandshake) {
        throw new NalixStatus(StatusCode.UNAVAILABLE, `Session resume failed: ${ProtocolReason[reason] || reason}`);
      }

      // Reconnect if connection was closed by server upon resume rejection
      if (!session.isConnected) {
        await session.connect();
      }
    } catch (err) {
      if (!session.config.resumeFallbackToHandshake) {
        throw err;
      }
      reason = ProtocolReason.NETWORK_ERROR;
      if (!session.isConnected) {
        await session.connect();
      }
    }
  }

  // Fallback to fresh full Handshake
  await session.handshake();
  return { resumed: false, reason };
}

function compareBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}
