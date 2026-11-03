import { Packet } from './packet.js';
import { ConnectivityState } from './channel.js';

export type PacketCallback = (packet: Packet) => void;
export type StateCallback = (state: ConnectivityState) => void;

/**
 * Handle returned by subscription methods allowing callers to detach their listeners.
 */
export interface Subscription {
  unsubscribe(): void;
}

/**
 * Manages event routing and multicast subscriber sets.
 * Adheres to SRP: responsible solely for subscriber registration, storage, and event dispatch.
 */
export class SubscriptionManager {
  private readonly _packetListeners: Set<PacketCallback> = new Set();
  private readonly _stateListeners: Set<StateCallback> = new Set();
  private readonly _opcodeListeners: Map<number, Set<PacketCallback>> = new Map();

  /**
   * Subscribes to all incoming packets.
   */
  public subscribePacket(callback: PacketCallback): Subscription {
    this._packetListeners.add(callback);
    return {
      unsubscribe: () => this._packetListeners.delete(callback),
    };
  }

  /**
   * Subscribes to connectivity state transitions.
   */
  public subscribeState(callback: StateCallback): Subscription {
    this._stateListeners.add(callback);
    return {
      unsubscribe: () => this._stateListeners.delete(callback),
    };
  }

  /**
   * Subscribes to packets matching a specific OpCode.
   */
  public subscribeOpcode(opcode: number, callback: PacketCallback): Subscription {
    let set = this._opcodeListeners.get(opcode);
    if (!set) {
      set = new Set();
      this._opcodeListeners.set(opcode, set);
    }
    set.add(callback);
    return {
      unsubscribe: () => {
        const listeners = this._opcodeListeners.get(opcode);
        if (listeners) {
          listeners.delete(callback);
          if (listeners.size === 0) {
            this._opcodeListeners.delete(opcode);
          }
        }
      },
    };
  }

  /**
   * Dispatches an incoming packet to OpCode subscribers and global listeners.
   */
  public dispatchPacket(packet: Packet): void {
    const opcodeSet = this._opcodeListeners.get(packet.header.opcode);
    if (opcodeSet) {
      for (const listener of opcodeSet) {
        try {
          listener(packet);
        } catch {}
      }
    }

    for (const listener of this._packetListeners) {
      try {
        listener(packet);
      } catch {}
    }
  }

  /**
   * Dispatches a connectivity state transition to all state listeners.
   */
  public dispatchState(state: ConnectivityState): void {
    for (const listener of this._stateListeners) {
      try {
        listener(state);
      } catch {}
    }
  }

  /**
   * Clears all active subscriptions.
   */
  public clear(): void {
    this._packetListeners.clear();
    this._stateListeners.clear();
    this._opcodeListeners.clear();
  }
}
