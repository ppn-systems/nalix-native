import { ChannelConfig, ChannelConfigOptions, ConnectivityState } from './channel.js';
import { Packet } from './packet.js';
import { NalixStatus, StatusCode } from './status.js';

export type PacketCallback = (packet: Packet) => void;
export type StateCallback = (state: ConnectivityState) => void;

/**
 * NalixClient provides high-performance WebSocket communication with a Nalix server.
 * Operates in modern web browsers and Node.js (22+) using the standard WebSocket API.
 */
export class NalixClient {
  public readonly config: ChannelConfig;
  private _state: ConnectivityState = ConnectivityState.IDLE;
  private _ws: WebSocket | null = null;
  private _packetListeners: Set<PacketCallback> = new Set();
  private _stateListeners: Set<StateCallback> = new Set();
  private _inboundQueue: Packet[] = [];
  private _pendingResolvers: Array<{ resolve: (p: Packet) => void; reject: (err: NalixStatus) => void }> = [];

  constructor(options: ChannelConfig | ChannelConfigOptions) {
    this.config = options instanceof ChannelConfig ? options : new ChannelConfig(options);
  }

  public get state(): ConnectivityState {
    return this._state;
  }

  public get isConnected(): boolean {
    return this._state === ConnectivityState.READY && this._ws?.readyState === WebSocket.OPEN;
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

  public onPacket(callback: PacketCallback): () => void {
    this._packetListeners.add(callback);
    return () => this._packetListeners.delete(callback);
  }

  public onStateChange(callback: StateCallback): () => void {
    this._stateListeners.add(callback);
    return () => this._stateListeners.delete(callback);
  }

  public async connect(): Promise<void> {
    if (this.isConnected) {
      return;
    }

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
          reject(new NalixStatus(StatusCode.DEADLINE_EXCEEDED, `Connection to ${this.config.url} timed out`));
        }
      }, this.config.connectTimeoutMs);

      try {
        const ws = new WebSocketImpl(this.config.url, this.config.subprotocol);
        ws.binaryType = 'arraybuffer';
        this._ws = ws;

        ws.onopen = () => {
          if (!settled) {
            settled = true;
            clearTimeout(timeoutTimer);
            this.setState(ConnectivityState.READY);
            resolve();
          }
        };

        ws.onerror = (_evt) => {
          if (!settled) {
            settled = true;
            clearTimeout(timeoutTimer);
            this.setState(ConnectivityState.TRANSIENT_FAILURE);
            reject(new NalixStatus(StatusCode.UNAVAILABLE, `Failed to connect to ${this.config.url}`));
          }
        };

        ws.onclose = () => {
          this.setState(ConnectivityState.SHUTDOWN);
          const err = new NalixStatus(StatusCode.UNAVAILABLE, 'WebSocket connection closed');
          while (this._pendingResolvers.length > 0) {
            this._pendingResolvers.shift()?.reject(err);
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
              return; // Ignore non-binary messages
            }

            const packet = Packet.decode(buffer);

            // If a receive() promise is awaiting, resolve it first
            if (this._pendingResolvers.length > 0) {
              const resolver = this._pendingResolvers.shift();
              resolver?.resolve(packet);
            } else {
              this._inboundQueue.push(packet);
            }

            // Dispatch to registered packet callbacks
            for (const listener of this._packetListeners) {
              try {
                listener(packet);
              } catch {}
            }
          } catch (err) {
            // Malformed packet
          }
        };
      } catch (err: any) {
        if (!settled) {
          settled = true;
          clearTimeout(timeoutTimer);
          this.setState(ConnectivityState.TRANSIENT_FAILURE);
          reject(new NalixStatus(StatusCode.INTERNAL, err?.message ?? 'Failed to instantiate WebSocket'));
        }
      }
    });
  }

  public send(packet: Packet): void {
    if (!this.isConnected || !this._ws) {
      throw new NalixStatus(StatusCode.UNAVAILABLE, 'Channel is not connected');
    }

    const bytes = packet.encode();
    this._ws.send(bytes);
  }

  public async receive(timeoutMs: number = 5000): Promise<Packet> {
    if (this._inboundQueue.length > 0) {
      return this._inboundQueue.shift()!;
    }

    if (!this.isConnected) {
      throw new NalixStatus(StatusCode.UNAVAILABLE, 'Channel is not connected');
    }

    return new Promise<Packet>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this._pendingResolvers.findIndex((r) => r.resolve === resolve);
        if (idx !== -1) {
          this._pendingResolvers.splice(idx, 1);
        }
        reject(new NalixStatus(StatusCode.DEADLINE_EXCEEDED, 'Receive operation timed out'));
      }, timeoutMs);

      this._pendingResolvers.push({
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

  public disconnect(): void {
    if (this._ws) {
      try {
        this._ws.close();
      } catch {}
      this._ws = null;
    }
    this.setState(ConnectivityState.SHUTDOWN);
  }
}
