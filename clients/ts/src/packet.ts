import { NalixStatus, StatusCode } from './status.js';

export const NALIX_HEADER_SIZE = 6;

/**
 * Bitwise flags that describe the state or properties of a network packet.
 * Matches Nalix.Abstractions.Networking.Packets.PacketFlags.
 */
export enum PacketFlags {
  NONE = 0x00,
  COMPRESSED = 1 << 1, // 0x02
  ENCRYPTED = 1 << 2,   // 0x04
  FRAGMENTED = 1 << 3,  // 0x08
}

/**
 * Nalix v14 6-byte wire protocol header.
 * Byte Layout (Little-Endian):
 *   [0..1]: OpCode (uint16)
 *   [2]:    Flags (uint8)
 *   [3]:    Priority (uint8)
 *   [4..5]: SequenceId (uint16)
 */
export class PacketHeader {
  public opcode: number;
  public flags: number;
  public priority: number;
  public sequenceId: number;

  constructor(opcode: number = 0, flags: number = 0, priority: number = 0, sequenceId: number = 0) {
    this.opcode = opcode & 0xffff;
    this.flags = flags & 0xff;
    this.priority = priority & 0xff;
    this.sequenceId = sequenceId & 0xffff;
  }

  public encode(dst: Uint8Array, offset: number = 0): void {
    if (dst.length - offset < NALIX_HEADER_SIZE) {
      throw new NalixStatus(StatusCode.RESOURCE_EXHAUSTED, 'Destination buffer too small for 6-byte header');
    }
    const view = new DataView(dst.buffer, dst.byteOffset + offset, NALIX_HEADER_SIZE);
    view.setUint16(0, this.opcode, true);
    view.setUint8(2, this.flags);
    view.setUint8(3, this.priority);
    view.setUint16(4, this.sequenceId, true);
  }

  public static decode(src: Uint8Array, offset: number = 0): PacketHeader {
    if (src.length - offset < NALIX_HEADER_SIZE) {
      throw new NalixStatus(StatusCode.OUT_OF_RANGE, 'Source buffer too small for 6-byte header');
    }
    const view = new DataView(src.buffer, src.byteOffset + offset, NALIX_HEADER_SIZE);
    const opcode = view.getUint16(0, true);
    const flags = view.getUint8(2);
    const priority = view.getUint8(3);
    const sequenceId = view.getUint16(4, true);

    return new PacketHeader(opcode, flags, priority, sequenceId);
  }
}

export type PayloadLike = Uint8Array | ArrayBuffer | string | null | undefined;

export interface PacketCreateOptions {
  flags?: number;
  priority?: number;
  sequenceId?: number;
}

/**
 * A Nalix protocol packet composed of a 6-byte header and a binary payload.
 */
export class Packet {
  public header: PacketHeader;
  public payload: Uint8Array;

  constructor(header: PacketHeader, payload: Uint8Array = new Uint8Array(0)) {
    this.header = header;
    this.payload = payload;
  }

  /**
   * Helper to decode payload bytes as a UTF-8 string.
   */
  public text(): string {
    return new TextDecoder().decode(this.payload);
  }

  /**
   * Helper to parse payload bytes as JSON.
   */
  public json<T = any>(): T {
    const str = this.text();
    return JSON.parse(str) as T;
  }

  /**
   * Encodes the packet into wire format (6-byte header + binary payload).
   */
  public encode(): Uint8Array {
    const totalLength = NALIX_HEADER_SIZE + this.payload.length;
    const buffer = new Uint8Array(totalLength);
    this.header.encode(buffer, 0);
    if (this.payload.length > 0) {
      buffer.set(this.payload, NALIX_HEADER_SIZE);
    }
    return buffer;
  }

  /**
   * Decodes a binary buffer into a Nalix Packet.
   */
  public static decode(raw: Uint8Array | ArrayBuffer): Packet {
    const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
    const header = PacketHeader.decode(bytes, 0);
    const payload = bytes.subarray(NALIX_HEADER_SIZE);
    return new Packet(header, payload);
  }

  /**
   * High-level factory method to create a Packet without manual header instantiation.
   */
  public static create(opcode: number, payload?: PayloadLike, options?: PacketCreateOptions): Packet {
    let body: Uint8Array;
    if (!payload) {
      body = new Uint8Array(0);
    } else if (typeof payload === 'string') {
      body = new TextEncoder().encode(payload);
    } else if (payload instanceof Uint8Array) {
      body = payload;
    } else if (payload instanceof ArrayBuffer) {
      body = new Uint8Array(payload);
    } else {
      body = new Uint8Array(0);
    }

    const header = new PacketHeader(
      opcode,
      options?.flags ?? 0,
      options?.priority ?? 0,
      options?.sequenceId ?? 0
    );
    return new Packet(header, body);
  }

  /**
   * Factory method to create a Packet with a JSON-serialized payload.
   */
  public static fromJson(opcode: number, obj: any, options?: PacketCreateOptions): Packet {
    const jsonStr = JSON.stringify(obj);
    return Packet.create(opcode, jsonStr, options);
  }
}
