import { Packet } from './packet.js';
import { NalixStatus, StatusCode } from './status.js';

export interface RequestOptions {
  timeoutMs?: number;
  flags?: number;
  priority?: number;
  sequenceId?: number;
  predicate?: (packet: Packet) => boolean;
}

export interface PendingWaiter {
  readonly sequenceId: number;
  readonly opcode: number;
  readonly matches: (packet: Packet) => boolean;
  readonly resolve: (packet: Packet) => void;
  readonly reject: (err: NalixStatus) => void;
  readonly timer: any;
}

/**
 * Manages in-flight correlated request-response transactions.
 * Adheres to SRP: responsible solely for registering awaiters, matching incoming responses,
 * enforcing request deadlines/timeouts, and draining pending requests upon connection teardown.
 */
export class PendingRequestManager {
  private readonly _waiters: Set<PendingWaiter> = new Set();

  /**
   * Gets the number of currently active pending requests.
   */
  public get count(): number {
    return this._waiters.size;
  }

  /**
   * Registers a new pending request waiter with an automatic timeout deadline.
   */
  public register(
    sequenceId: number,
    opcode: number,
    timeoutMs: number,
    predicate?: (packet: Packet) => boolean
  ): Promise<Packet> {
    return new Promise<Packet>((resolve, reject) => {
      const timer = setTimeout(() => {
        this._waiters.delete(waiter);
        reject(
          new NalixStatus(
            StatusCode.DEADLINE_EXCEEDED,
            `Request opcode 0x${opcode.toString(16)} (seq ${sequenceId}) timed out after ${timeoutMs}ms`
          )
        );
      }, timeoutMs);

      const waiter: PendingWaiter = {
        sequenceId,
        opcode,
        matches: (incoming: Packet) => {
          if (predicate) {
            return predicate(incoming);
          }
          return incoming.header.sequenceId === sequenceId;
        },
        resolve: (pkt: Packet) => {
          clearTimeout(timer);
          this._waiters.delete(waiter);
          resolve(pkt);
        },
        reject: (err: NalixStatus) => {
          clearTimeout(timer);
          this._waiters.delete(waiter);
          reject(err);
        },
        timer,
      };

      this._waiters.add(waiter);
    });
  }

  /**
   * Attempts to match and resolve an incoming packet against active pending requests.
   * Returns true if a matching waiter was found and resolved; false otherwise.
   */
  public tryResolve(packet: Packet): boolean {
    for (const waiter of this._waiters) {
      if (waiter.matches(packet)) {
        waiter.resolve(packet);
        return true;
      }
    }
    return false;
  }

  /**
   * Aborts all pending requests with the specified error status (e.g. on disconnect).
   */
  public drain(status: NalixStatus): void {
    const waiters = Array.from(this._waiters);
    this._waiters.clear();
    for (const waiter of waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(status);
    }
  }
}
