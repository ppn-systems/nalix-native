import { ChannelConfig, ConnectivityState } from './channel.js';
import { Packet, PacketCreateOptions, PayloadLike } from './packet.js';
import { ControlType, ProtocolOpCode } from './protocol.js';
import { NalixStatus, StatusCode } from './status.js';
import { SessionState } from './state.js';
import { Subscription, PacketCallback, StateCallback, SubscriptionManager } from './subscription.js';
import { PendingRequestManager, RequestOptions } from './pending.js';
import { FramePipeline } from './pipeline.js';

/**
 * Common abstraction contract for client-side transport sessions.
 * Adheres to Interface Segregation Principle (ISP) and Liskov Substitution Principle (LSP).
 * Matches Nalix.SDK.Transport.ITransportSession.
 */
export interface ITransportSession {
  readonly config: ChannelConfig;
  readonly state: ConnectivityState;
  readonly isConnected: boolean;
  readonly sessionState: SessionState;

  connect(): Promise<void>;
  disconnect(): Promise<void>;
  close(): void;

  send(packetOrOpcode: Packet | number, payload?: PayloadLike, options?: PacketCreateOptions): number;
  request(
    packetOrOpcode: Packet | number,
    payloadOrOptions?: PayloadLike | RequestOptions,
    maybeOptions?: RequestOptions
  ): Promise<Packet>;

  on(opcode: number, callback: PacketCallback): Subscription;
  once(opcode: number, callback: PacketCallback): Subscription;
  onPacket(callback: PacketCallback): Subscription;
  onStateChange(callback: StateCallback): Subscription;
  ping(timeoutMs?: number): Promise<number>;

  setSecret(secret: Uint8Array): void;
  enableEncryption(secret?: Uint8Array): void;
  disableEncryption(): void;
}

/**
 * Base abstract class providing common lifecycle, sequencing, pending request dispatching,
 * and subscription management for all transport session implementations.
 * Adheres to Open-Closed Principle (OCP) and Single Responsibility Principle (SRP).
 * Directly mirrors Nalix.SDK.Transport.TransportSession.
 */
export abstract class TransportSession implements ITransportSession {
  public readonly config: ChannelConfig;
  protected _state: ConnectivityState = ConnectivityState.IDLE;
  protected readonly _sessionState: SessionState;
  protected readonly _subscriptions: SubscriptionManager = new SubscriptionManager();
  protected readonly _pendingRequests: PendingRequestManager = new PendingRequestManager();
  private _sequenceCounter: number = 0;
  private _outboundSeq32: number = 0;

  constructor(config: ChannelConfig, sessionState?: SessionState) {
    this.config = config;
    this._sessionState = sessionState ?? new SessionState();
  }

  public get state(): ConnectivityState {
    return this._state;
  }

  public abstract get isConnected(): boolean;

  public get sessionState(): SessionState {
    return this._sessionState;
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

  /**
   * Generates a 32-bit sequence number (1..4294967295) for AEAD envelope headers.
   */
  public nextSeq32(): number {
    this._outboundSeq32 = (this._outboundSeq32 + 1) >>> 0;
    if (this._outboundSeq32 === 0) {
      this._outboundSeq32 = 1;
    }
    return this._outboundSeq32;
  }

  public setSecret(secret: Uint8Array): void {
    this._sessionState.secret = secret;
    this._sessionState.encryptionEnabled = true;
  }

  public enableEncryption(secret?: Uint8Array): void {
    if (secret) {
      this._sessionState.secret = secret;
    }
    if (!this._sessionState.secret) {
      throw new NalixStatus(StatusCode.FAILED_PRECONDITION, 'Cannot enable encryption without a secret key');
    }
    this._sessionState.encryptionEnabled = true;
  }

  public disableEncryption(): void {
    this._sessionState.encryptionEnabled = false;
  }

  protected setState(newState: ConnectivityState): void {
    if (this._state !== newState) {
      this._state = newState;
      this._subscriptions.dispatchState(newState);
    }
  }

  public onPacket(callback: PacketCallback): Subscription {
    return this._subscriptions.subscribePacket(callback);
  }

  public onStateChange(callback: StateCallback): Subscription {
    return this._subscriptions.subscribeState(callback);
  }

  public on(opcode: number, callback: PacketCallback): Subscription {
    return this._subscriptions.subscribeOpcode(opcode, callback);
  }

  public once(opcode: number, callback: PacketCallback): Subscription {
    const sub = this.on(opcode, (packet) => {
      sub.unsubscribe();
      callback(packet);
    });
    return sub;
  }

  /**
   * Dispatches an inbound packet through the pending request table, OpCode subscribers, and global listeners.
   */
  protected dispatchInboundPacket(packet: Packet): void {
    // 1. Try to resolve any correlated pending request waiter
    if (this._pendingRequests.tryResolve(packet)) {
      return;
    }

    // 2. Dispatch to subscribers
    this._subscriptions.dispatchPacket(packet);
  }

  public abstract connect(): Promise<void>;
  public abstract disconnect(): Promise<void>;
  public abstract close(): void;

  /**
   * Low-level send implementation to be provided by concrete transport sessions.
   */
  protected abstract sendRawFrame(bytes: Uint8Array): void;

  /**
   * Sends a packet over the active transport session.
   * Auto-assigns sequenceId, executes pipeline transforms (compression, encryption).
   */
  public send(packetOrOpcode: Packet | number, payload?: PayloadLike, options?: PacketCreateOptions): number {
    if (!this.isConnected) {
      throw new NalixStatus(StatusCode.UNAVAILABLE, 'Session is not connected');
    }

    let packet: Packet;
    if (packetOrOpcode instanceof Packet) {
      packet = packetOrOpcode;
    } else {
      const seq = options?.sequenceId ?? 0;
      packet = Packet.create(packetOrOpcode, payload, { ...options, sequenceId: seq });
    }

    const processed = FramePipeline.processOutbound(
      packet,
      this.config,
      this._sessionState,
      () => this.nextSequenceId(),
      () => this.nextSeq32()
    );

    const bytes = processed.encode();
    this.sendRawFrame(bytes);
    return processed.header.sequenceId;
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
    if (!this.isConnected) {
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
      const seq = options.sequenceId ?? 0;
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

    const promise = this._pendingRequests.register(
      targetSeq,
      packet.header.opcode,
      timeoutMs,
      options.predicate
    );

    try {
      const processed = FramePipeline.processOutbound(
        packet,
        this.config,
        this._sessionState,
        () => this.nextSequenceId(),
        () => this.nextSeq32()
      );
      const bytes = processed.encode();
      this.sendRawFrame(bytes);
    } catch (err: any) {
      this._pendingRequests.drain(new NalixStatus(StatusCode.INTERNAL, err?.message ?? 'Failed to send request frame'));
      throw err;
    }

    return promise;
  }

  /**
   * Measures network round-trip time (RTT) by sending a SYSTEM_CONTROL PING packet and awaiting PONG.
   */
  public async ping(timeoutMs: number = 5000): Promise<number> {
    const start = performance.now();
    const pingPacket = Packet.create(
      ProtocolOpCode.SYSTEM_CONTROL,
      new Uint8Array([ControlType.PING]),
      { priority: 0xff }
    );

    await this.request(pingPacket, {
      timeoutMs,
      predicate: (incoming) =>
        incoming.header.opcode === ProtocolOpCode.SYSTEM_CONTROL &&
        incoming.payload.length > 0 &&
        incoming.payload[0] === ControlType.PONG,
    });

    return performance.now() - start;
  }
}
