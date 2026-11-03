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
  host: string;
  port?: number;
  path?: string;
  useTls?: boolean;
  subprotocol?: string;
  connectTimeoutMs?: number;
  maxMessageSize?: number;
}

export class ChannelConfig {
  public readonly host: string;
  public readonly port: number;
  public readonly path: string;
  public readonly useTls: boolean;
  public readonly subprotocol: string;
  public readonly connectTimeoutMs: number;
  public readonly maxMessageSize: number;

  constructor(options: ChannelConfigOptions) {
    this.host = options.host;
    this.useTls = options.useTls ?? true;
    this.port = options.port ?? (this.useTls ? 443 : 80);
    this.path = options.path ? (options.path.startsWith('/') ? options.path : `/${options.path}`) : '/ws/';
    this.subprotocol = options.subprotocol ?? 'nalix.v1';
    this.connectTimeoutMs = options.connectTimeoutMs ?? 10000;
    this.maxMessageSize = options.maxMessageSize ?? 65536;
  }

  public get url(): string {
    const scheme = this.useTls ? 'wss' : 'ws';
    const isStandardPort = (this.useTls && this.port === 443) || (!this.useTls && this.port === 80);
    const hostPort = isStandardPort ? this.host : `${this.host}:${this.port}`;
    return `${scheme}://${hostPort}${this.path}`;
  }
}
