import { ChannelConfig, ChannelConfigOptions, ConnectivityState } from './channel.js';
import { NalixStatus, StatusCode } from './status.js';
import { SessionState } from './state.js';
import { TransportSession } from './base.js';
import { ReconnectSupervisor } from './reconnect.js';
import { ProtocolReason } from './protocol.js';
import { hasResumeState } from './resume.js';

export type WebSocketSessionOptions = ChannelConfigOptions;

/**
 * Upper bound for the WebSocket closing handshake started by disconnect(): the close frame is sent and the
 * session waits this long for the peer's close frame. Same bound as the Nalix host (ppn-systems/nalix#519).
 */
export const CLOSE_HANDSHAKE_TIMEOUT_MS = 2000;

/** How the last WebSocket connection of a session ended. */
export interface WebSocketCloseInfo {
  /** RFC 6455 close code (1005 when the peer sent none, 1006 when the connection dropped without a close frame). */
  code: number;
  reason: string;
  wasClean: boolean;
  /** True when this side started the close (disconnect()/close()). */
  initiatedByClient: boolean;
}

/**
 * Maps a WebSocket close to the status that pending requests are rejected with.
 * Nalix hosts send a close frame instead of dropping the socket (ppn-systems/nalix#519): 1000 for a normal
 * close, 1001 when the host shuts down (#534, #544) and 1009 when a message exceeds the host's limit.
 */
export function closeToStatus(info: WebSocketCloseInfo): NalixStatus {
  const text = `WebSocket session closed (close status ${info.code}${info.reason ? `: ${info.reason}` : ''})`;
  const details = { closeCode: info.code, closeReason: info.reason };
  switch (info.code) {
    case 1001:
      return new NalixStatus(StatusCode.UNAVAILABLE, `${text}; the server is shutting down`, {
        ...details,
        reason: ProtocolReason.SERVER_SHUTDOWN,
        transient: true,
      });
    case 1008:
      return new NalixStatus(StatusCode.PERMISSION_DENIED, text, { ...details, reason: ProtocolReason.FORBIDDEN });
    case 1009:
      return new NalixStatus(StatusCode.RESOURCE_EXHAUSTED, text, { ...details, reason: ProtocolReason.MESSAGE_TOO_LARGE });
    case 1011:
      return new NalixStatus(StatusCode.INTERNAL, text, { ...details, reason: ProtocolReason.INTERNAL_ERROR });
    case 1006:
      return new NalixStatus(StatusCode.UNAVAILABLE, text, { ...details, reason: ProtocolReason.CONNECTION_RESET, transient: true });
    default:
      return new NalixStatus(StatusCode.UNAVAILABLE, text, { ...details, reason: ProtocolReason.REMOTE_CLOSED });
  }
}

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
  private _lastClose: WebSocketCloseInfo | null = null;
  // Bumped by every disconnect(): a reconnect that started before it must not publish itself afterwards.
  private _disconnectEpoch: number = 0;
  private _reconnecting: boolean = false;

  constructor(options: ChannelConfig | WebSocketSessionOptions | string, sessionState?: SessionState) {
    const config = options instanceof ChannelConfig ? options : new ChannelConfig(options);
    super(config, sessionState);

    this._reconnectSupervisor = new ReconnectSupervisor(
      () => this.reconnectOnce(),
      this.config.maxReconnectAttempts,
      this.config.reconnectIntervalMs
    );
  }

  public get isConnected(): boolean {
    return this._state === ConnectivityState.READY && this._ws?.readyState === WebSocket.OPEN;
  }

  /** How the most recent WebSocket connection ended, or null while none has closed yet. */
  public get lastClose(): WebSocketCloseInfo | null {
    return this._lastClose;
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
            // An automatic reconnect resets the backoff only once the session is authenticated again.
            if (!this._reconnecting) {
              this._reconnectSupervisor.reset();
            }
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

        ws.onclose = (event: CloseEvent) => {
          // A late close event of a socket this session already replaced must not touch the new connection.
          if (this._ws !== null && this._ws !== ws) {
            return;
          }
          this._ws = null;
          this.stopHeartbeat();
          const wasConnected = this._state === ConnectivityState.READY;
          this._lastClose = {
            code: event?.code ?? 1005,
            reason: event?.reason ?? '',
            wasClean: event?.wasClean ?? false,
            initiatedByClient: this._intentionalClose,
          };
          this._pendingRequests.drain(closeToStatus(this._lastClose));

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

          this.handleInboundFrame(buffer);
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

  /**
   * One automatic reconnect attempt: reopens the transport and, when the session was authenticated,
   * authenticates it again with connectWithResume() (resume, or a full handshake as fallback) before the
   * backoff is reset. Matches the C# ReconnectSupervisor. Without this, the reopened connection would carry
   * frames encrypted with a key the new server connection does not know, and the host closes connections
   * that do not authenticate within its handshake timeout (ppn-systems/nalix#486).
   */
  private async reconnectOnce(): Promise<void> {
    const epoch = this._disconnectEpoch;
    const reauthenticate =
      this.config.resumeOnReconnect && (this._sessionState.encryptionEnabled || hasResumeState(this._sessionState));

    this._reconnecting = true;
    try {
      await this.connect();
      if (epoch !== this._disconnectEpoch) {
        return; // disconnect() was called meanwhile
      }
      if (reauthenticate) {
        await this.connectWithResume();
      }
    } catch (err) {
      if (epoch === this._disconnectEpoch && this.isConnected) {
        // Transport is up but authentication failed: drop it and let the supervisor try again.
        this.cleanupSocket();
        this.setState(ConnectivityState.TRANSIENT_FAILURE);
        this.triggerAutoReconnect();
      }
      throw err;
    } finally {
      this._reconnecting = false;
    }

    if (epoch === this._disconnectEpoch && this.isConnected) {
      this._reconnectSupervisor.reset();
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
   * Swaps the socket for a fresh one before the handshake fallback of connectWithResume(). The old socket is
   * closed without waiting for its closing handshake and without the intentional-disconnect side effects:
   * auto-reconnect stays armed and the late close event of the old socket is ignored.
   */
  public override async reconnectForResumeFallback(): Promise<void> {
    const old = this._ws;
    this._ws = null;
    this.stopHeartbeat();
    if (old) {
      try {
        old.close(1000, 'Resume rejected; reconnecting for handshake');
      } catch {}
    }
    await this.connect();
  }

  /**
   * Gracefully disconnects the WebSocket session: stops auto-reconnect, rejects pending requests with
   * CANCELLED, sends a 1000 close frame and waits for the peer's close frame (bounded by
   * CLOSE_HANDSHAKE_TIMEOUT_MS), so frames written just before, such as the DISCONNECT control frame of
   * disconnectGracefully(), reach the host before the socket goes away. The state is SHUTDOWN as soon as
   * this is called.
   */
  public async disconnect(): Promise<void> {
    this._intentionalClose = true;
    this._disconnectEpoch++;
    this._reconnectSupervisor.cancel();
    this.stopHeartbeat();

    const ws = this._ws;
    this._ws = null;
    let closed: Promise<void> | null = null;

    if (ws) {
      try {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          closed = new Promise<void>((resolve) => {
            const onclose = ws.onclose;
            let seen = false;
            const timer = setTimeout(() => {
              // The peer did not answer the close frame in time; the browser/runtime finishes the close later.
              if (!seen) this._lastClose = {
                code: 1006,
                reason: 'Closing handshake timed out',
                wasClean: false,
                initiatedByClient: true,
              };
              resolve();
            }, CLOSE_HANDSHAKE_TIMEOUT_MS);
            ws.onclose = function (this: WebSocket, ev: CloseEvent) {
              seen = true;
              clearTimeout(timer);
              try {
                onclose?.call(this, ev);
              } finally {
                resolve();
              }
            };
          });
          ws.close(1000, 'Client disconnected');
        }
      } catch {}
    }

    this._pendingRequests.drain(new NalixStatus(StatusCode.CANCELLED, 'Session disconnected intentionally'));
    this.setState(ConnectivityState.SHUTDOWN);

    if (closed) {
      await closed;
    }
  }

  public close(): void {
    this.disconnect().catch(() => {});
  }
}
