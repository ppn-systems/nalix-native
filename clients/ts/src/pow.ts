import { keccak_256 } from '@noble/hashes/sha3.js';
import { NalixStatus, StatusCode } from './status.js';

/** Serialized size of a POW_CHALLENGE payload: Nonce(32) + Difficulty(1) + TimestampTicks(8) + Mac(32). */
export const POW_CHALLENGE_PAYLOAD_SIZE = 73;
/** Serialized size of a POW_PROOF payload: the challenge fields + Solution(8). */
export const POW_PROOF_PAYLOAD_SIZE = 81;

/** Proof-of-work challenge sent by the host (POW_CHALLENGE, 0x000A). Matches Nalix.Codec ProofOfWorkChallenge. */
export interface ProofOfWorkChallenge {
  nonce: Uint8Array;
  difficulty: number;
  /** int64 ticks, kept as bigint so it is echoed back bit-for-bit. */
  timestampTicks: bigint;
  mac: Uint8Array;
}

export function decodePowChallenge(payload: Uint8Array): ProofOfWorkChallenge {
  if (payload.length < POW_CHALLENGE_PAYLOAD_SIZE) {
    throw new NalixStatus(
      StatusCode.DATA_LOSS,
      `Malformed ProofOfWorkChallenge payload: expected ${POW_CHALLENGE_PAYLOAD_SIZE} bytes, got ${payload.length}`
    );
  }
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const challenge: ProofOfWorkChallenge = {
    nonce: payload.slice(0, 32),
    difficulty: payload[32],
    timestampTicks: view.getBigInt64(33, true),
    mac: payload.slice(41, 73),
  };
  // Same checks as ProofOfWorkChallenge.Validate on the host.
  if (isZero(challenge.nonce) || isZero(challenge.mac) || challenge.timestampTicks <= 0n) {
    throw new NalixStatus(StatusCode.DATA_LOSS, 'Malformed ProofOfWorkChallenge packet: Invalid PowChallenge data.');
  }
  return challenge;
}

export function encodePowProof(challenge: ProofOfWorkChallenge, solution: number): Uint8Array {
  const out = new Uint8Array(POW_PROOF_PAYLOAD_SIZE);
  const view = new DataView(out.buffer);
  out.set(challenge.nonce, 0);
  out[32] = challenge.difficulty;
  view.setBigInt64(33, challenge.timestampTicks, true);
  out.set(challenge.mac, 41);
  view.setBigInt64(73, BigInt(solution), true);
  return out;
}

/** True when `hash` starts with at least `bits` zero bits. Matches ProofOfWorkSolver.HasLeadingZeroBits. */
export function hasLeadingZeroBits(hash: Uint8Array, bits: number): boolean {
  const whole = bits >>> 3;
  const rest = bits & 7;
  for (let i = 0; i < whole; i++) {
    if (hash[i] !== 0) return false;
  }
  if (rest > 0) {
    const mask = (0xff << (8 - rest)) & 0xff;
    if ((hash[whole] & mask) !== 0) return false;
  }
  return true;
}

/**
 * Solves a Nalix proof-of-work puzzle: the smallest non-negative `solution` such that
 * Keccak256(Nonce[32] || Difficulty[1] || TimestampTicks[8 LE] || Solution[8 LE]) has `difficulty`
 * leading zero bits. Port of Nalix.Codec.Security.ProofOfWorkSolver.
 *
 * The search yields to the event loop every `yieldEvery` attempts so timers (heartbeat, request
 * timeouts) keep running, and stops with DEADLINE_EXCEEDED once `deadline` (performance.now() ms)
 * passes, so the handshake timeout also bounds the solve (as in ppn-systems/nalix#469).
 */
export async function solvePowChallenge(
  challenge: Pick<ProofOfWorkChallenge, 'nonce' | 'difficulty' | 'timestampTicks'>,
  deadline: number = Number.POSITIVE_INFINITY,
  yieldEvery: number = 16384
): Promise<number> {
  if (challenge.difficulty === 0) {
    return 0;
  }
  if (challenge.difficulty > 256) {
    throw new NalixStatus(StatusCode.INVALID_ARGUMENT, `Proof-of-work difficulty ${challenge.difficulty} is out of range`);
  }

  const puzzle = new Uint8Array(49);
  const view = new DataView(puzzle.buffer);
  puzzle.set(challenge.nonce.subarray(0, 32), 0);
  puzzle[32] = challenge.difficulty;
  view.setBigInt64(33, challenge.timestampTicks, true);

  for (let solution = 0; solution <= Number.MAX_SAFE_INTEGER; solution++) {
    if (solution % yieldEvery === 0 && solution !== 0) {
      if (performance.now() > deadline) {
        throw new NalixStatus(StatusCode.DEADLINE_EXCEEDED, 'Proof-of-work solve exceeded the handshake timeout');
      }
      await new Promise<void>((r) => setTimeout(r, 0));
    }
    view.setUint32(41, solution >>> 0, true);
    view.setUint32(45, Math.floor(solution / 0x1_0000_0000), true);
    if (hasLeadingZeroBits(keccak_256(puzzle), challenge.difficulty)) {
      return solution;
    }
  }
  throw new NalixStatus(StatusCode.RESOURCE_EXHAUSTED, 'Proof-of-work search space exhausted');
}

function isZero(b: Uint8Array): boolean {
  for (let i = 0; i < b.length; i++) {
    if (b[i] !== 0) return false;
  }
  return true;
}
