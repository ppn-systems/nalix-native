import { ChannelConfig, ChannelConfigOptions, ConnectivityState } from './channel.js';
import { Packet } from './packet.js';
import { NalixStatus, StatusCode } from './status.js';
import { SessionState } from './state.js';
import { FramePipeline } from './pipeline.js';
import { TransportSession } from './base.js';
import { ReconnectSupervisor } from './reconnect.js';

export type WebSocketSessionOptions = ChannelConfigOptions;

/**
 * WebSocketSession represents an active client-side transport session to a Nalix server over WebSocket.
 * Adheres to Single Responsibility Principle (SRP): manages solely WebSocket transport lifecycle,
 * delegating subscription routing to SubscriptionManager, correlated requests to PendingRequestManager,
 * reconnection scheduling to ReconnectSupervisor, and pipeline transforms to FramePipeline.
 *
 * Directly mirrors Nalix C#'s Nalix.SDK.Transport.WebSocketSession.
 */
export class WebSocketSession extends TransportSession {
  private _ws: WebSocket | null = null;
  private readonly _reconnectSupervisor: ReconnectSupervisor;
  private _intentionalClose: boolean = false;
  private _heartbeatTimer: any = null;

  constructor(options: ChannelConfig | WebSocketSessionOptions | string, sessionState?: SessionState) {
    const config = options instanceof ChannelConfig ? options : new ChannelConfig(options);
    super(config, sessionState);

    this._reconnectSupervisor = new ReconnectSupervisor(
      () => this.connect(),
      this.config.maxReconnectAttempts,
      this.config.reconnectIntervalMs
    );
  }

  public get isConnected(): boolean {
    return this._state === ConnectivityState.READY && this._ws?.readyState === WebSocket.OPEN;
  }

  /**
   * High-level static factory to create, connect, and optionally handshake/resume in a single call.
   * Example:
   *   const client = await WebSocketSession.connect('wss://atmosos.eyc.asia/ws/');
   */
  public static async connect(
    options: ChannelConfig | WebSocketSessionOptions | string,
    connectOptions?: { autoHandshake?: boolean }
  ): Promise<WebSocketSession> {
    const session = new WebSocketSession(options);
    await session.connect();
    if (connectOptions?.autoHandshake !== false) {
      await session.connectWithResume();
    }
    return session;
  }

  /**
   * Establishes the WebSocket transport connection.
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
          this.cleanupSocket();
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
            this._reconnectSupervisor.reset();
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
          this._pendingRequests.drain(new NalixStatus(StatusCode.UNAVAILABLE, 'WebSocket session closed'));

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
          let buffer: Uint8Array;
          if (event.data instanceof ArrayBuffer) {
            buffer = new Uint8Array(event.data);
          } else if (ArrayBuffer.isView(event.data)) {
            buffer = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength);
          } else {
            return; // Not a binary frame
          }

          let rawPacket: Packet | undefined;
          let packet: Packet;
          try {
            if (buffer.length > this.config.maxMessageSize) {
              throw new NalixStatus(
                StatusCode.RESOURCE_EXHAUSTED,
                `Inbound frame of ${buffer.length} bytes exceeds maxMessageSize ${this.config.maxMessageSize}`
              );
            }
            rawPacket = Packet.decode(buffer);
            packet = FramePipeline.processInbound(rawPacket, this._sessionState);
          } catch (err: unknown) {
            this.reportInboundFailure(err, rawPacket);
            return;
          }
          this.dispatchInboundPacket(packet);
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

  /**
   * Surfaces an inbound frame that could not be decoded.
   * If the frame header was parsed, its sequence ID is used to reject the matching pending request,
   * so the caller gets the real failure instead of DEADLINE_EXCEEDED. The error is also emitted via onError().
   */
  private reportInboundFailure(err: unknown, packet: Packet | undefined): void {
    const status =
      err instanceof NalixStatus
        ? err
        : new NalixStatus(StatusCode.DATA_LOSS, `Inbound frame rejected: ${(err as Error)?.message ?? String(err)}`);
    if (packet) {
      this._pendingRequests.cancel(packet.header.sequenceId, status);
    }
    this._subscriptions.dispatchError(status);
  }

  protected sendRawFrame(bytes: Uint8Array): void {
    if (!this.isConnected || !this._ws) {
      throw new NalixStatus(StatusCode.UNAVAILABLE, 'WebSocket session is not connected');
    }
    this._ws.send(bytes);
  }

  private triggerAutoReconnect(): void {
    if (this.config.autoReconnect && !this._intentionalClose) {
      this._reconnectSupervisor.schedule();
    }
  }

  private startHeartbeat(): void {
    if (this.config.heartbeatIntervalMs <= 0) {
      return;
    }
    this.stopHeartbeat();
    this._heartbeatTimer = setInterval(async () => {
      if (this.isConnected) {
        try {
          await this.ping(3000);
        } catch {
          // Heartbeat missed: trigger reconnect
          this.cleanupSocket();
          this.setState(ConnectivityState.TRANSIENT_FAILURE);
          this.triggerAutoReconnect();
        }
      }
    }, this.config.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this._heartbeatTimer !== null) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }

  private cleanupSocket(): void {
    this.stopHeartbeat();
    if (this._ws) {
      try {
        this._ws.close();
      } catch {}
      this._ws = null;
    }
  }

  /**
   * Gracefully disconnects the WebSocket session.
   */
  public async disconnect(): Promise<void> {
    this._intentionalClose = true;
    this._reconnectSupervisor.cancel();
    this.stopHeartbeat();

    if (this._ws) {
      const ws = this._ws;
      this._ws = null;

      try {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close(1000, 'Client intentional disconnect');
        }
      } catch {}
    }

    this._pendingRequests.drain(new NalixStatus(StatusCode.CANCELLED, 'Session disconnected intentionally'));
    this.setState(ConnectivityState.SHUTDOWN);
  }

  public close(): void {
    this.disconnect().catch(() => {});
  }
}
