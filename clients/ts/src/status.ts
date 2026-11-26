/**
 * Canonical status codes for Nalix client operations.
 */
export enum StatusCode {
  OK = 0,
  CANCELLED = 1,
  UNKNOWN = 2,
  INVALID_ARGUMENT = 3,
  DEADLINE_EXCEEDED = 4,
  NOT_FOUND = 5,
  ALREADY_EXISTS = 6,
  PERMISSION_DENIED = 7,
  RESOURCE_EXHAUSTED = 8,
  FAILED_PRECONDITION = 9,
  ABORTED = 10,
  OUT_OF_RANGE = 11,
  UNIMPLEMENTED = 12,
  INTERNAL = 13,
  UNAVAILABLE = 14,
  DATA_LOSS = 15,
  UNAUTHENTICATED = 16,
}

export const StatusCodeNames: Record<StatusCode, string> = {
  [StatusCode.OK]: 'OK',
  [StatusCode.CANCELLED]: 'CANCELLED',
  [StatusCode.UNKNOWN]: 'UNKNOWN',
  [StatusCode.INVALID_ARGUMENT]: 'INVALID_ARGUMENT',
  [StatusCode.DEADLINE_EXCEEDED]: 'DEADLINE_EXCEEDED',
  [StatusCode.NOT_FOUND]: 'NOT_FOUND',
  [StatusCode.ALREADY_EXISTS]: 'ALREADY_EXISTS',
  [StatusCode.PERMISSION_DENIED]: 'PERMISSION_DENIED',
  [StatusCode.RESOURCE_EXHAUSTED]: 'RESOURCE_EXHAUSTED',
  [StatusCode.FAILED_PRECONDITION]: 'FAILED_PRECONDITION',
  [StatusCode.ABORTED]: 'ABORTED',
  [StatusCode.OUT_OF_RANGE]: 'OUT_OF_RANGE',
  [StatusCode.UNIMPLEMENTED]: 'UNIMPLEMENTED',
  [StatusCode.INTERNAL]: 'INTERNAL',
  [StatusCode.UNAVAILABLE]: 'UNAVAILABLE',
  [StatusCode.DATA_LOSS]: 'DATA_LOSS',
  [StatusCode.UNAUTHENTICATED]: 'UNAUTHENTICATED',
};

/**
 * Protocol-level detail attached to a status when the server (or the transport) said why.
 */
export interface NalixStatusDetails {
  /** Nalix ProtocolReason (uint16) reported by the server, when known. */
  reason?: number;
  /** Nalix ProtocolAdvice (uint8) from a SYSTEM_DIRECTIVE, when known. */
  advice?: number;
  /** True when the server flagged the failure as transient (ControlFlags.IS_TRANSIENT). */
  transient?: boolean;
  /** WebSocket close code (RFC 6455) when the status comes from a closed connection. */
  closeCode?: number;
  /** WebSocket close reason text when the status comes from a closed connection. */
  closeReason?: string;
}

/**
 * Represents the outcome of a Nalix operation.
 */
export class NalixStatus extends Error {
  public readonly code: StatusCode;
  public readonly codeName: string;
  public readonly details?: NalixStatusDetails;

  constructor(code: StatusCode, message: string = StatusCodeNames[code] ?? 'UNKNOWN', details?: NalixStatusDetails) {
    super(`${StatusCodeNames[code] ?? 'UNKNOWN'}: ${message}`);
    this.name = 'NalixStatus';
    this.code = code;
    this.codeName = StatusCodeNames[code] ?? 'UNKNOWN';
    if (details) {
      this.details = details;
    }
  }

  public get isOk(): boolean {
    return this.code === StatusCode.OK;
  }

  public static ok(): NalixStatus {
    return new NalixStatus(StatusCode.OK, 'OK');
  }

  public static error(code: StatusCode, message?: string): NalixStatus {
    return new NalixStatus(code, message);
  }
}
