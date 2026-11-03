import { ChannelConfig, ChannelConfigOptions, ConnectivityState } from './channel.js';
import { Packet, PacketCreateOptions, PayloadLike } from './packet.js';
import { ControlType, ProtocolOpCode } from './protocol.js';
import { NalixStatus, StatusCode } from './status.js';

export type PacketCallback = (packet: Packet) => void;
export type StateCallback = (state: ConnectivityState) => void;

export interface Subscription {
  unsubscribe(): void;
}

export interface RequestOptions {
  timeoutMs?: number;
  flags?: number;
  priority?: number;
  sequenceId?: number;
  predicate?: (packet: Packet) => boolean;
}

interface PendingWaiter {
  matches: (packet: Packet) => boolean;
  resolve: (packet: Packet) => void;
  reject: (err: NalixStatus) => void;
  timer: any;
}

export type WebSocketSessionOptions = ChannelConfigOptions;

/**
 * WebSocketSession represents an active client-side transport session to a Nalix server over WebSocket.
 * Directly mirrors the architecture and ergonomics of Nalix C#'s WebSocketSession and TransportSession.
 */
export class WebSocketSession {
  public readonly config: ChannelConfig;
  private _state: ConnectivityState = ConnectivityState.IDLE;
  private _ws: WebSocket | null = null;
  private _packetListeners: Set<PacketCallback> = new Set();
  private _stateListeners: Set<StateCallback> = new Set();
  private _opcodeListeners: Map<number, Set<PacketCallback>> = new Map();
  private _pendingWaiters: Set<PendingWaiter> = new Set();
  private _inboundQueue: Packet[] = [];
  private _pendingReceiveResolvers: Array<{ resolve: (p: Packet) => void; reject: (err: NalixStatus) => void }> = [];
  private _sequenceCounter: number = 0;
  private _reconnectTimer: any = null;
  private _reconnectAttempts: number = 0;
  private _intentionalClose: boolean = false;
  private _heartbeatTimer: any = null;

  constructor(options: ChannelConfig | WebSocketSessionOptions | string) {
    if (options instanceof ChannelConfig) {
      this.config = options;
    } else {
      this.config = new ChannelConfig(options);
    }
  }

  public get state(): ConnectivityState {
    return this._state;
  }

  public get isConnected(): boolean {
    return this._state === ConnectivityState.READY && this._ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Generates a 16-bit sequence ID (1..65535, wrapping around).
   */
  public nextSequenceId(): number {
    this._sequenceCounter = (this._sequenceCounter + 1) & 0xffff;
    if (this._sequenceCounter === 0) {
      this._sequenceCounter = 1;
    }
    return this._sequenceCounter;
  }

  private setState(newState: ConnectivityState): void {
    if (this._state !== newState) {
      this._state = newState;
      for (const listener of this._stateListeners) {
        try {
          listener(newState);
        } catch {}
      }
    }
  }

  /**
   * Registers a global listener for all incoming packets.
   */
  public onPacket(callback: PacketCallback): Subscription {
    this._packetListeners.add(callback);
    return {
      unsubscribe: () => this._packetListeners.delete(callback),
    };
  }

  /**
   * Registers a listener for channel connectivity state transitions.
   */
  public onStateChange(callback: StateCallback): Subscription {
    this._stateListeners.add(callback);
    return {
      unsubscribe: () => this._stateListeners.delete(callback),
    };
  }

  /**
   * Subscribes to incoming packets with a specific OpCode. Matches `session.On<TPacket>()` in Nalix C#.
   */
  public on(opcode: number, callback: PacketCallback): Subscription {
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
   * Subscribes to a single packet with a specific OpCode, then automatically unregisters.
   */
  public once(opcode: number, callback: PacketCallback): Subscription {
    const sub = this.on(opcode, (packet) => {
      sub.unsubscribe();
      callback(packet);
    });
    return sub;
  }

  /**
   * Establishes the WebSocket session to the Nalix endpoint.
   */
  public async connect(): Promise<void> {
    if (this.isConnected) {
      return;
    }

    this._intentionalClose = false;
    this.setState(ConnectivityState.CONNECTING);

    const WebSocketImpl = globalThis.WebSocket;
    if (!WebSocketImpl) {
      this.setState(ConnectivityState.TRANSIENT_FAILURE);
      throw new NalixStatus(StatusCode.UNAVAILABLE, 'WebSocket implementation not found in global environment');
    }

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const timeoutTimer = setTimeout(() => {
        if (!settled) {
          settled = true;
          this.setState(ConnectivityState.TRANSIENT_FAILURE);
          if (this._ws) {
            try {
              this._ws.close();
            } catch {}
            this._ws = null;
          }
          const err = new NalixStatus(StatusCode.DEADLINE_EXCEEDED, `Connection to ${this.config.url} timed out`);
          this.triggerAutoReconnect();
          reject(err);
        }
      }, this.config.connectTimeoutMs);

      try {
        const ws = this.config.subprotocol
          ? new WebSocketImpl(this.config.url, this.config.subprotocol)
          : new WebSocketImpl(this.config.url);
        ws.binaryType = 'arraybuffer';
        this._ws = ws;

        ws.onopen = () => {
          if (!settled) {
            settled = true;
            clearTimeout(timeoutTimer);
            this._reconnectAttempts = 0;
            this.setState(ConnectivityState.READY);
            this.startHeartbeat();
            resolve();
          }
        };

        ws.onerror = (_evt) => {
          if (!settled) {
            settled = true;
            clearTimeout(timeoutTimer);
            this.setState(ConnectivityState.TRANSIENT_FAILURE);
            this.triggerAutoReconnect();
            reject(new NalixStatus(StatusCode.UNAVAILABLE, `Failed to connect to ${this.config.url}`));
          }
        };

        ws.onclose = () => {
          this.stopHeartbeat();
          const wasConnected = this._state === ConnectivityState.READY;
          this.cleanupInFlightRequests(new NalixStatus(StatusCode.UNAVAILABLE, 'WebSocket session closed'));

          if (this._intentionalClose) {
            this.setState(ConnectivityState.SHUTDOWN);
          } else {
            this.setState(ConnectivityState.TRANSIENT_FAILURE);
            if (wasConnected) {
              this.triggerAutoReconnect();
            }
          }
        };

        ws.onmessage = (event: MessageEvent) => {
          try {
            let buffer: Uint8Array;
            if (event.data instanceof ArrayBuffer) {
              buffer = new Uint8Array(event.data);
            } else if (ArrayBuffer.isView(event.data)) {
              buffer = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength);
            } else {
              return;
            }

            const packet = Packet.decode(buffer);
            this.dispatchInboundPacket(packet);
          } catch {
            // Malformed packet
          }
        };
      } catch (err: any) {
        if (!settled) {
          settled = true;
          clearTimeout(timeoutTimer);
          this.setState(ConnectivityState.TRANSIENT_FAILURE);
          this.triggerAutoReconnect();
          reject(new NalixStatus(StatusCode.INTERNAL, err?.message ?? 'Failed to instantiate WebSocket'));
        }
      }
    });
  }

  private dispatchInboundPacket(packet: Packet): void {
    // 1. Check pending request awaiters (correlated requests)
    for (const waiter of this._pendingWaiters) {
      if (waiter.matches(packet)) {
        clearTimeout(waiter.timer);
        this._pendingWaiters.delete(waiter);
        waiter.resolve(packet);
        return;
      }
    }

    // 2. Check pending raw receive() resolvers
    if (this._pendingReceiveResolvers.length > 0) {
      const resolver = this._pendingReceiveResolvers.shift();
      resolver?.resolve(packet);
    } else {
      this._inboundQueue.push(packet);
    }

    // 3. Dispatch to OpCode-specific subscribers
    const opcodeSet = this._opcodeListeners.get(packet.header.opcode);
    if (opcodeSet) {
      for (const listener of opcodeSet) {
        try {
          listener(packet);
        } catch {}
      }
    }

    // 4. Dispatch to global packet listeners
    for (const listener of this._packetListeners) {
      try {
        listener(packet);
      } catch {}
    }
  }

  /**
   * Sends a packet over the active session.
   * Accepts either a Packet instance or (opcode, payload, options).
   * Returns the sequence ID of the sent packet.
   */
  public send(packetOrOpcode: Packet | number, payload?: PayloadLike, options?: PacketCreateOptions): number {
    if (!this.isConnected || !this._ws) {
      throw new NalixStatus(StatusCode.UNAVAILABLE, 'Session is not connected');
    }

    let packet: Packet;
    if (packetOrOpcode instanceof Packet) {
      packet = packetOrOpcode;
      if (packet.header.sequenceId === 0) {
        packet.header.sequenceId = this.nextSequenceId();
      }
    } else {
      const seq = options?.sequenceId ?? this.nextSequenceId();
      packet = Packet.create(packetOrOpcode, payload, { ...options, sequenceId: seq });
    }

    const bytes = packet.encode();
    this._ws.send(bytes);
    return packet.header.sequenceId;
  }

  /**
   * Correlated Request-Response pattern matching C# `RequestAsync<TResponse>`.
   * Automatically stamps a SequenceId, sends the packet, and awaits the correlated response.
   */
  public async request(
    packetOrOpcode: Packet | number,
    payloadOrOptions?: PayloadLike | RequestOptions,
    maybeOptions?: RequestOptions
  ): Promise<Packet> {
    if (!this.isConnected || !this._ws) {
      throw new NalixStatus(StatusCode.UNAVAILABLE, 'Session is not connected');
    }

    let packet: Packet;
    let options: RequestOptions;

    if (packetOrOpcode instanceof Packet) {
      packet = packetOrOpcode;
      options = (payloadOrOptions as RequestOptions) ?? {};
    } else {
      options = maybeOptions ?? {};
      const payload = payloadOrOptions as PayloadLike;
      const seq = options.sequenceId ?? this.nextSequenceId();
      packet = Packet.create(packetOrOpcode, payload, {
        flags: options.flags,
        priority: options.priority,
        sequenceId: seq,
      });
    }

    if (packet.header.sequenceId === 0) {
      packet.header.sequenceId = this.nextSequenceId();
    }

    const targetSeq = packet.header.sequenceId;
    const timeoutMs = options.timeoutMs ?? this.config.requestTimeoutMs;

    return new Promise<Packet>((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pendingWaiters.delete(waiter);
        reject(
          new NalixStatus(
            StatusCode.DEADLINE_EXCEEDED,
            `Request opcode 0x${packet.header.opcode.toString(16)} (seq ${targetSeq}) timed out after ${timeoutMs}ms`
          )
        );
      }, timeoutMs);

      const waiter: PendingWaiter = {
        matches: (incoming: Packet) => {
          if (options.predicate) {
            return options.predicate(incoming);
          }
          return incoming.header.sequenceId === targetSeq;
        },
        resolve: (pkt: Packet) => {
          clearTimeout(timer);
          resolve(pkt);
        },
        reject: (err: NalixStatus) => {
          clearTimeout(timer);
          reject(err);
        },
        timer,
      };

      this._pendingWaiters.add(waiter);

      try {
        const bytes = packet.encode();
        this._ws!.send(bytes);
      } catch (err: any) {
        clearTimeout(timer);
        this._pendingWaiters.delete(waiter);
        reject(new NalixStatus(StatusCode.INTERNAL, err?.message ?? 'Failed to send request frame'));
      }
    });
  }

  /**
   * Measures network round-trip time (RTT) by sending a SYSTEM_CONTROL PING packet and awaiting PONG.
   * Matches `session.PingAsync()` from the Nalix C# SDK.
   */
  public async ping(timeoutMs: number = 5000): Promise<number> {
    const start = performance.now();
    const seq = this.nextSequenceId();

    const pingPayload = new Uint8Array([ControlType.PING]);
    const pingPacket = Packet.create(ProtocolOpCode.SYSTEM_CONTROL, pingPayload, { sequenceId: seq });

    await this.request(pingPacket, {
      timeoutMs,
      predicate: (incoming) => {
        return (
          incoming.header.opcode === ProtocolOpCode.SYSTEM_CONTROL &&
          incoming.header.sequenceId === seq &&
          incoming.payload.length > 0 &&
          incoming.payload[0] === ControlType.PONG
        );
      },
    });

    return Math.round((performance.now() - start) * 100) / 100;
  }

  /**
   * Pulls the next packet from the incoming queue or waits until one arrives.
   */
  public async receive(timeoutMs: number = 5000): Promise<Packet> {
    if (this._inboundQueue.length > 0) {
      return this._inboundQueue.shift()!;
    }

    if (!this.isConnected) {
      throw new NalixStatus(StatusCode.UNAVAILABLE, 'Session is not connected');
    }

    return new Promise<Packet>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this._pendingReceiveResolvers.findIndex((r) => r.resolve === resolve);
        if (idx !== -1) {
          this._pendingReceiveResolvers.splice(idx, 1);
        }
        reject(new NalixStatus(StatusCode.DEADLINE_EXCEEDED, 'Receive operation timed out'));
      }, timeoutMs);

      this._pendingReceiveResolvers.push({
        resolve: (pkt) => {
          clearTimeout(timer);
          resolve(pkt);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
    });
  }

  /**
   * Gracefully disconnects the session.
   */
  public disconnect(): void {
    this._intentionalClose = true;
    this.stopHeartbeat();
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this._ws) {
      try {
        this._ws.close();
      } catch {}
      this._ws = null;
    }
    this.cleanupInFlightRequests(new NalixStatus(StatusCode.CANCELLED, 'Session disconnected'));
    this.setState(ConnectivityState.SHUTDOWN);
  }

  /**
   * Alias for disconnect() matching standard Disposable/Closeable conventions.
   */
  public close(): void {
    this.disconnect();
  }

  private cleanupInFlightRequests(err: NalixStatus): void {
    for (const waiter of this._pendingWaiters) {
      clearTimeout(waiter.timer);
      waiter.reject(err);
    }
    this._pendingWaiters.clear();

    while (this._pendingReceiveResolvers.length > 0) {
      this._pendingReceiveResolvers.shift()?.reject(err);
    }
  }

  private triggerAutoReconnect(): void {
    if (!this.config.autoReconnect || this._intentionalClose) {
      return;
    }

    if (this._reconnectAttempts >= this.config.maxReconnectAttempts) {
      this.setState(ConnectivityState.SHUTDOWN);
      return;
    }

    if (this._reconnectTimer) {
      return;
    }

    this._reconnectAttempts++;
    const delay = this.config.reconnectIntervalMs * Math.min(this._reconnectAttempts, 4);

    this._reconnectTimer = setTimeout(async () => {
      this._reconnectTimer = null;
      if (this._intentionalClose) return;

      try {
        await this.connect();
      } catch {
        // Next reconnect attempt handled by onclose/onerror
      }
    }, delay);
  }

  private startHeartbeat(): void {
    if (this.config.heartbeatIntervalMs <= 0) return;
    this.stopHeartbeat();
    this._heartbeatTimer = setInterval(async () => {
      if (this.isConnected) {
        try {
          await this.ping(3000);
        } catch {
          // Heartbeat missed
        }
      }
    }, this.config.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }
}
