import { x25519 } from '@noble/curves/ed25519.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { hmac } from '@noble/hashes/hmac.js';
import { Packet, PacketFlags, PacketPriority } from './packet.js';
import { ControlType, ProtocolOpCode, ProtocolReason } from './protocol.js';
import { decodePowChallenge, encodePowProof, solvePowChallenge } from './pow.js';
import { NalixStatus, StatusCode } from './status.js';
import { ITransportSession } from './base.js';

const SESSION_LABEL = new TextEncoder().encode('nalix-handshake/session');
const SERVER_PROOF_LABEL = new TextEncoder().encode('nalix-handshake/server-proof');
const CLIENT_PROOF_LABEL = new TextEncoder().encode('nalix-handshake/client-proof');
const SERVER_FINISH_LABEL = new TextEncoder().encode('nalix-handshake/server-finish');
const REKEY_LABEL = new TextEncoder().encode('nalix-session/rekey');

/**
 * HKDF using HMAC-Keccak256 as specified in Nalix.Codec.Security.HandshakeX25519.
 */
export class HandshakeX25519 {
  /**
   * HKDF-Extract: PRK = HMAC-Hash(salt, IKM)
   */
  public static hkdfExtract(salt: Uint8Array | null, ikm: Uint8Array): Uint8Array {
    const actualSalt = salt && salt.length > 0 ? salt : new Uint8Array(32);
    return hmac(keccak_256, actualSalt, ikm);
  }

  /**
   * HKDF-Expand: OKM = HMAC-Hash(PRK, info || 0x01)
   */
  public static hkdfExpand(prk: Uint8Array, info: Uint8Array): Uint8Array {
    const t = new Uint8Array(info.length + 1);
    t.set(info, 0);
    t[t.length - 1] = 1; // Counter 1
    return hmac(keccak_256, prk, t);
  }

  /**
   * Computes master secret by combining ephemeral-ephemeral and static-ephemeral shared secrets.
   */
  public static computeMasterSecret(sharedSecretEE: Uint8Array, sharedSecretSE: Uint8Array): Uint8Array {
    const ikm = new Uint8Array(64);
    ikm.set(sharedSecretEE, 0);
    ikm.set(sharedSecretSE, 32);
    return this.hkdfExtract(null, ikm);
  }

  /**
   * Composes 144-byte transcript buffer and computes Keccak256 hash.
   * 4 segments of [4 bytes LE length | 32 bytes data].
   */
  public static computeTranscriptHash(
    clientPublicKey: Uint8Array,
    clientNonce: Uint8Array,
    serverPublicKey: Uint8Array,
    serverNonce: Uint8Array
  ): Uint8Array {
    const transcript = new Uint8Array(144);
    const view = new DataView(transcript.buffer, transcript.byteOffset, transcript.byteLength);

    let offset = 0;
    const writeSegment = (val: Uint8Array) => {
      view.setInt32(offset, val.length, true);
      offset += 4;
      transcript.set(val, offset);
      offset += val.length;
    };

    writeSegment(clientPublicKey);
    writeSegment(clientNonce);
    writeSegment(serverPublicKey);
    writeSegment(serverNonce);

    return keccak_256(transcript);
  }

  public static computeServerProof(masterSecret: Uint8Array, transcriptHash: Uint8Array): Uint8Array {
    const info = new Uint8Array(SERVER_PROOF_LABEL.length + 32);
    info.set(SERVER_PROOF_LABEL, 0);
    info.set(transcriptHash, SERVER_PROOF_LABEL.length);
    return this.hkdfExpand(masterSecret, info);
  }

  public static computeClientProof(masterSecret: Uint8Array, transcriptHash: Uint8Array): Uint8Array {
    const info = new Uint8Array(CLIENT_PROOF_LABEL.length + 32);
    info.set(CLIENT_PROOF_LABEL, 0);
    info.set(transcriptHash, CLIENT_PROOF_LABEL.length);
    return this.hkdfExpand(masterSecret, info);
  }

  public static computeServerFinishProof(masterSecret: Uint8Array, transcriptHash: Uint8Array): Uint8Array {
    const info = new Uint8Array(SERVER_FINISH_LABEL.length + 32);
    info.set(SERVER_FINISH_LABEL, 0);
    info.set(transcriptHash, SERVER_FINISH_LABEL.length);
    return this.hkdfExpand(masterSecret, info);
  }

  public static deriveSessionKey(
    masterSecret: Uint8Array,
    clientNonce: Uint8Array,
    serverNonce: Uint8Array,
    transcriptHash: Uint8Array
  ): Uint8Array {
    const info = new Uint8Array(SESSION_LABEL.length + 96);
    let offset = 0;
    info.set(SESSION_LABEL, offset);
    offset += SESSION_LABEL.length;
    info.set(clientNonce, offset);
    offset += 32;
    info.set(serverNonce, offset);
    offset += 32;
    info.set(transcriptHash, offset);
    return this.hkdfExpand(masterSecret, info);
  }

  /**
   * Derives a new session key during mid-session key rotation (Rekey).
   * Matches Nalix.Codec.Security.HandshakeX25519.DeriveRekeySecret.
   */
  public static deriveRekeySecret(currentSecret: Uint8Array): Uint8Array {
    return this.hkdfExpand(currentSecret, REKEY_LABEL);
  }
}

export interface HandshakeOptions {
  serverPublicKey?: Uint8Array;
  allowTofu?: boolean;
  timeoutMs?: number;
}

export interface HandshakeResult {
  sessionKey: Uint8Array;
  sessionToken: bigint;
  serverPublicKey: Uint8Array;
  serverStaticKey: Uint8Array;
}

/**
 * Performs client-side X25519 authenticated Diffie-Hellman handshake matching Nalix C# HandshakeExtensions
 * (Nalix 14.4.1):
 *
 * 1. Resets both envelope sequence counters: a full handshake starts a new key and a new server-side session,
 *    and the host restarts its counters when it installs the key (ppn-systems/nalix#545).
 * 2. SESSION_INIT -> SESSION_CHALLENGE. When the host answers with SYSTEM_CONTROL ERROR / POW_REQUIRED, the
 *    client runs the proof-of-work exchange (POW_REQUEST -> POW_CHALLENGE, solve, POW_PROOF) and re-sends
 *    SESSION_INIT.
 * 3. Fetches the server static key over TOFU (PUBLIC_KEY_REQUEST -> SESSION_TOFU) when none is pinned.
 * 4. Verifies the server proof, sends SESSION_PROOF and verifies SESSION_ESTABLISHED.
 *
 * Every handshake frame is sent in plaintext. `timeoutMs` (default `connectTimeoutMs`) bounds the whole
 * exchange, including the proof-of-work solve. Hosts close connections that do not authenticate within
 * their handshake timeout (ppn-systems/nalix#486), so call this right after connect().
 */
export async function performHandshake(
  session: ITransportSession,
  options?: HandshakeOptions
): Promise<HandshakeResult> {
  if (!session.isConnected) {
    throw new NalixStatus(StatusCode.FAILED_PRECONDITION, 'Session must be connected to perform handshake');
  }

  const timeoutMs = options?.timeoutMs ?? session.config.connectTimeoutMs;
  const allowTofu = options?.allowTofu ?? session.config.allowTofu;
  let pinnedServerKey = options?.serverPublicKey ?? session.config.serverPublicKey;

  if (!pinnedServerKey && !allowTofu) {
    throw new NalixStatus(StatusCode.PERMISSION_DENIED, 'ServerPublicKey is required when AllowTofu is disabled');
  }

  const deadline = performance.now() + timeoutMs;
  const remaining = (): number => {
    const left = Math.floor(deadline - performance.now());
    if (left <= 0) {
      throw new NalixStatus(StatusCode.DEADLINE_EXCEEDED, `Handshake did not complete within ${timeoutMs}ms`);
    }
    return left;
  };

  const state = session.sessionState;

  // A new key is about to be negotiated: drop the previous one and restart both sequence directions.
  state.secret = null;
  state.encryptionEnabled = false;
  state.sessionToken = 0n;
  state.resetSequenceCounters();

  try {
    // 1. Generate client ephemeral keypair and 32-byte client nonce
    const clientKey = x25519.keygen();
    const clientNonce = new Uint8Array(32);
    crypto.getRandomValues(clientNonce);

    // SessionInit payload (OpCode 0x0000, 64 bytes: clientPublicKey[32] + clientNonce[32])
    const initPayload = new Uint8Array(64);
    initPayload.set(clientKey.publicKey, 0);
    initPayload.set(clientNonce, 32);
    const newInitPacket = () =>
      Packet.create(ProtocolOpCode.SESSION_INIT, initPayload, {
        flags: PacketFlags.SYSTEM,
        priority: PacketPriority.URGENT,
      });

    // 2. SessionInit -> SessionChallenge, or ERROR/POW_REQUIRED when the host enforces proof-of-work.
    let challengePacket = await session.request(newInitPacket(), {
      timeoutMs: remaining(),
      encrypt: false,
      predicate: (p) => p.header.opcode === ProtocolOpCode.SESSION_CHALLENGE || isPowRequired(p),
    });

    if (isPowRequired(challengePacket)) {
      const powChallengePacket = await session.request(
        Packet.create(ProtocolOpCode.SYSTEM_CONTROL, controlPayload(ControlType.POW_REQUEST), {
          flags: PacketFlags.SYSTEM,
          priority: PacketPriority.HIGH,
        }),
        {
          timeoutMs: remaining(),
          encrypt: false,
          predicate: (p) => p.header.opcode === ProtocolOpCode.POW_CHALLENGE,
        }
      );

      const challenge = decodePowChallenge(powChallengePacket.payload);
      const solution = await solvePowChallenge(challenge, deadline);

      // The proof is pipelined: no reply, SessionInit follows immediately.
      session.send(
        Packet.create(ProtocolOpCode.POW_PROOF, encodePowProof(challenge, solution), {
          flags: PacketFlags.SYSTEM,
          priority: PacketPriority.URGENT,
        }),
        undefined,
        { encrypt: false }
      );

      challengePacket = await session.request(newInitPacket(), {
        timeoutMs: remaining(),
        encrypt: false,
        predicate: (p) => p.header.opcode === ProtocolOpCode.SESSION_CHALLENGE,
      });
    }

    if (challengePacket.payload.length < 96) {
      throw new NalixStatus(StatusCode.INVALID_ARGUMENT, 'Malformed SessionChallenge payload: expected 96 bytes');
    }

    const serverEphemeralKey = challengePacket.payload.slice(0, 32);
    const serverNonce = challengePacket.payload.slice(32, 64);
    const serverProof = challengePacket.payload.slice(64, 96);

    // sharedSecretEE = X25519(clientPrivateKey, serverEphemeralKey)
    const sharedSecretEE = x25519.getSharedSecret(clientKey.secretKey, serverEphemeralKey);
    if (isAllZero(sharedSecretEE)) {
      throw new NalixStatus(StatusCode.UNAUTHENTICATED, 'Handshake key agreement failed: Ephemeral shared secret is all zero.');
    }

    // 3. Fetch Server Static Public Key via TOFU if not pinned (same position as C# HandshakeExtensions)
    if (!pinnedServerKey) {
      const tofuPacket = await session.request(
        Packet.create(ProtocolOpCode.SYSTEM_CONTROL, controlPayload(ControlType.PUBLIC_KEY_REQUEST), {
          flags: PacketFlags.SYSTEM,
          priority: PacketPriority.HIGH,
        }),
        {
          timeoutMs: remaining(),
          encrypt: false,
          predicate: (p) => p.header.opcode === ProtocolOpCode.SESSION_TOFU,
        }
      );

      if (tofuPacket.payload.length < 32) {
        throw new NalixStatus(StatusCode.INVALID_ARGUMENT, 'Malformed SessionTofu payload: expected 32 bytes');
      }
      pinnedServerKey = tofuPacket.payload.slice(0, 32);
    }

    // sharedSecretSE = X25519(clientPrivateKey, pinnedServerKey)
    const sharedSecretSE = x25519.getSharedSecret(clientKey.secretKey, pinnedServerKey);
    if (isAllZero(sharedSecretSE)) {
      throw new NalixStatus(StatusCode.UNAUTHENTICATED, 'Handshake key agreement failed: Static shared secret is all zero.');
    }

    // 4. Master Secret, Transcript Hash, server proof (MitM protection)
    const masterSecret = HandshakeX25519.computeMasterSecret(sharedSecretEE, sharedSecretSE);
    const transcriptHash = HandshakeX25519.computeTranscriptHash(
      clientKey.publicKey,
      clientNonce,
      serverEphemeralKey,
      serverNonce
    );

    const expectedServerProof = HandshakeX25519.computeServerProof(masterSecret, transcriptHash);
    if (!compareBytes(serverProof, expectedServerProof)) {
      throw new NalixStatus(
        StatusCode.UNAUTHENTICATED,
        'SessionChallenge proof is invalid. Possible Man-in-the-Middle attack.'
      );
    }

    const sessionKey = HandshakeX25519.deriveSessionKey(masterSecret, clientNonce, serverNonce, transcriptHash);

    // The host sends SessionEstablished encrypted with the new key; SessionProof itself goes out in plaintext.
    state.secret = sessionKey;
    state.encryptionEnabled = false;

    const clientProof = HandshakeX25519.computeClientProof(masterSecret, transcriptHash);
    const proofPacket = Packet.create(ProtocolOpCode.SESSION_PROOF, clientProof, {
      flags: PacketFlags.SYSTEM,
      priority: PacketPriority.HIGH,
    });

    const establishedPacket = await session.request(proofPacket, {
      timeoutMs: remaining(),
      encrypt: false,
      predicate: (p) => p.header.opcode === ProtocolOpCode.SESSION_ESTABLISHED,
    });

    if (establishedPacket.payload.length < 40) {
      throw new NalixStatus(StatusCode.INVALID_ARGUMENT, 'Malformed SessionEstablished payload: expected 40 bytes');
    }

    const serverFinishProof = establishedPacket.payload.slice(0, 32);
    const view = new DataView(
      establishedPacket.payload.buffer,
      establishedPacket.payload.byteOffset,
      establishedPacket.payload.byteLength
    );
    const sessionToken = view.getBigUint64(32, true);

    const expectedFinishProof = HandshakeX25519.computeServerFinishProof(masterSecret, transcriptHash);
    if (!compareBytes(serverFinishProof, expectedFinishProof)) {
      throw new NalixStatus(StatusCode.UNAUTHENTICATED, 'SessionEstablished proof is invalid');
    }

    state.sessionToken = sessionToken;
    state.encryptionEnabled = true;

    return {
      sessionKey,
      sessionToken,
      serverPublicKey: pinnedServerKey,
      serverStaticKey: pinnedServerKey,
    };
  } catch (err) {
    // A failed handshake leaves no half-installed key behind (matches the C# SDK).
    state.secret = null;
    state.encryptionEnabled = false;
    state.sessionToken = 0n;
    state.resetSequenceCounters();
    throw err;
  }
}

/** SYSTEM_CONTROL payload: Reason (uint16 LE) + Type (uint8). */
function controlPayload(type: ControlType, reason: ProtocolReason = ProtocolReason.NONE): Uint8Array {
  const payload = new Uint8Array(3);
  new DataView(payload.buffer).setUint16(0, reason, true);
  payload[2] = type;
  return payload;
}

function isPowRequired(p: Packet): boolean {
  if (p.header.opcode !== ProtocolOpCode.SYSTEM_CONTROL || p.payload.length < 3) {
    return false;
  }
  const reason = p.payload[0] | (p.payload[1] << 8);
  return p.payload[2] === ControlType.ERROR && reason === ProtocolReason.POW_REQUIRED;
}

function isAllZero(b: Uint8Array): boolean {
  let acc = 0;
  for (let i = 0; i < b.length; i++) acc |= b[i];
  return acc === 0;
}

function compareBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}
