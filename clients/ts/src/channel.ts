import { CipherSuiteType } from './security.js';

/**
 * Connectivity states representing the channel lifecycle.
 */
export enum ConnectivityState {
  IDLE = 'IDLE',
  CONNECTING = 'CONNECTING',
  READY = 'READY',
  TRANSIENT_FAILURE = 'TRANSIENT_FAILURE',
  SHUTDOWN = 'SHUTDOWN',
}

/**
 * Configuration options for establishing a Nalix WebSocket channel.
 */
export interface ChannelConfigOptions {
  url?: string;
  host?: string;
  port?: number;
  path?: string;
  useTls?: boolean;
  subprotocol?: string;
  connectTimeoutMs?: number;
  requestTimeoutMs?: number;
  maxMessageSize?: number;
  autoReconnect?: boolean;
  reconnectIntervalMs?: number;
  maxReconnectAttempts?: number;
  heartbeatIntervalMs?: number;
  compressionEnabled?: boolean;
  compressionThreshold?: number;
  algorithm?: CipherSuiteType;
  serverPublicKey?: Uint8Array;
  allowTofu?: boolean;
  resumeEnabled?: boolean;
  resumeTimeoutMs?: number;
  resumeFallbackToHandshake?: boolean;
}

export class ChannelConfig {
  public readonly host: string;
  public readonly port: number;
  public readonly path: string;
  public readonly useTls: boolean;
  public readonly subprotocol?: string;
  public readonly connectTimeoutMs: number;
  public readonly requestTimeoutMs: number;
  public readonly maxMessageSize: number;
  public readonly autoReconnect: boolean;
  public readonly reconnectIntervalMs: number;
  public readonly maxReconnectAttempts: number;
  public readonly heartbeatIntervalMs: number;
  public readonly compressionEnabled: boolean;
  public readonly compressionThreshold: number;
  public readonly algorithm: CipherSuiteType;
  public readonly serverPublicKey?: Uint8Array;
  public readonly allowTofu: boolean;
  public readonly resumeEnabled: boolean;
  public readonly resumeTimeoutMs: number;
  public readonly resumeFallbackToHandshake: boolean;
  private readonly _overrideUrl?: string;

  constructor(options: ChannelConfigOptions | string) {
    if (typeof options === 'string') {
      this._overrideUrl = options;
      try {
        const parsed = new URL(options);
        this.useTls = parsed.protocol === 'wss:' || parsed.protocol === 'https:';
        this.host = parsed.hostname;
        this.port = parsed.port ? parseInt(parsed.port, 10) : (this.useTls ? 443 : 80);
        this.path = parsed.pathname || '/ws/';
      } catch {
        this.useTls = true;
        this.host = options;
        this.port = 443;
        this.path = '/ws/';
      }
      this.subprotocol = undefined;
      this.connectTimeoutMs = 10000;
      this.requestTimeoutMs = 5000;
      this.maxMessageSize = 65536;
      this.autoReconnect = false;
      this.reconnectIntervalMs = 2000;
      this.maxReconnectAttempts = 5;
      this.heartbeatIntervalMs = 0;
      this.compressionEnabled = true;
      this.compressionThreshold = 512;
      this.algorithm = CipherSuiteType.Chacha20Poly1305;
      this.serverPublicKey = undefined;
      this.allowTofu = true;
      this.resumeEnabled = true;
      this.resumeTimeoutMs = 3000;
      this.resumeFallbackToHandshake = true;
    } else {
      if (options.url) {
        this._overrideUrl = options.url;
        try {
          const parsed = new URL(options.url);
          this.useTls = options.useTls ?? (parsed.protocol === 'wss:' || parsed.protocol === 'https:');
          this.host = options.host ?? parsed.hostname;
          this.port = options.port ?? (parsed.port ? parseInt(parsed.port, 10) : (this.useTls ? 443 : 80));
          this.path = options.path ?? (parsed.pathname || '/ws/');
        } catch {
          this.useTls = options.useTls ?? true;
          this.host = options.host ?? 'localhost';
          this.port = options.port ?? (this.useTls ? 443 : 80);
          this.path = options.path ?? '/ws/';
        }
      } else {
        this.host = options.host ?? 'localhost';
        this.useTls = options.useTls ?? true;
        this.port = options.port ?? (this.useTls ? 443 : 80);
        this.path = options.path ? (options.path.startsWith('/') ? options.path : `/${options.path}`) : '/ws/';
      }

      this.subprotocol = options.subprotocol;
      this.connectTimeoutMs = options.connectTimeoutMs ?? 10000;
      this.requestTimeoutMs = options.requestTimeoutMs ?? 5000;
      this.maxMessageSize = options.maxMessageSize ?? 65536;
      this.autoReconnect = options.autoReconnect ?? false;
      this.reconnectIntervalMs = options.reconnectIntervalMs ?? 2000;
      this.maxReconnectAttempts = options.maxReconnectAttempts ?? 5;
      this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 0;
      this.compressionEnabled = options.compressionEnabled ?? true;
      this.compressionThreshold = options.compressionThreshold ?? 512;
      this.algorithm = options.algorithm ?? CipherSuiteType.Chacha20Poly1305;
      this.serverPublicKey = options.serverPublicKey;
      this.allowTofu = options.allowTofu ?? true;
      this.resumeEnabled = options.resumeEnabled ?? true;
      this.resumeTimeoutMs = options.resumeTimeoutMs ?? 3000;
      this.resumeFallbackToHandshake = options.resumeFallbackToHandshake ?? true;
    }
  }

  public get url(): string {
    if (this._overrideUrl) {
      return this._overrideUrl;
    }
    const scheme = this.useTls ? 'wss' : 'ws';
    const isStandardPort = (this.useTls && this.port === 443) || (!this.useTls && this.port === 80);
    const hostPort = isStandardPort ? this.host : `${this.host}:${this.port}`;
    return `${scheme}://${hostPort}${this.path}`;
  }
}
