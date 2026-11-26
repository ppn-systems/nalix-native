import { NalixStatus, StatusCode } from './status.js';

/** Replay window of the stream transports (Nalix SequenceOptions.TcpWindow default). */
export const STREAM_REPLAY_WINDOW = 32;

const UINT32_MAX = 0xffffffff;

/**
 * 32-bit envelope sequence counter with a 32-slot sliding replay bitmap.
 * Port of Nalix.Environment.Sequencing.SequenceCounter (Nalix 14.4.1).
 *
 * The same type is used for both directions: the send side calls next(), the receive side
 * calls isValid() then updateTo() for every decrypted frame.
 */
export class SequenceCounter {
  private _current: number;
  private _bitmap: number = 0;

  constructor(initialValue: number = 0) {
    this._current = initialValue >>> 0;
  }

  /** Last issued (send) or highest accepted (receive) sequence number. 0 means none yet. */
  public get current(): number {
    return this._current;
  }

  /**
   * Issues the next sequence number (starting at 1). Never wraps: at 2^32 - 1 it throws, because
   * reissuing a number under the same key would reuse an AEAD nonce position. Rekey resets the counter.
   */
  public next(): number {
    if (this._current === UINT32_MAX) {
      throw new NalixStatus(
        StatusCode.RESOURCE_EXHAUSTED,
        'Sequence counter overflow. Key rotation (rekey) is required to prevent nonce reuse.'
      );
    }
    this._current = (this._current + 1) >>> 0;
    return this._current;
  }

  public reset(newValue: number = 0): void {
    this._current = newValue >>> 0;
    this._bitmap = 0;
  }

  /** True when the counter is within `margin` of overflow. */
  public isApproachingOverflow(margin: number = 1_000_000): boolean {
    return this._current >= UINT32_MAX - margin;
  }

  /**
   * Returns whether a received sequence number is acceptable: newer than the highest seen, or inside
   * the window and not seen yet. `undefined` (a plaintext frame) is always acceptable.
   */
  public isValid(receivedSeq: number | undefined, window: number = 0): boolean {
    if (receivedSeq === undefined) {
      return true;
    }
    const seq = receivedSeq >>> 0;
    if (this._current === 0) {
      return true;
    }
    if (seq === 0) {
      return false;
    }
    if (seq > this._current) {
      return true;
    }
    const delta = this._current - seq;
    if (window > 0 && delta < window) {
      if (delta >= 32) {
        return false;
      }
      return ((this._bitmap >>> delta) & 1) === 0;
    }
    return false;
  }

  /** Records a received sequence number in the window. */
  public updateTo(receivedSeq: number): void {
    const seq = receivedSeq >>> 0;
    if (seq > this._current) {
      const delta = seq - this._current;
      this._bitmap = delta >= 32 ? 1 : ((this._bitmap << delta) | 1) >>> 0;
      this._current = seq;
      return;
    }
    const delta = this._current - seq;
    if (delta >= 32) {
      return;
    }
    this._bitmap = (this._bitmap | (1 << delta)) >>> 0;
  }
}
