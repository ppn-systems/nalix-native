import { Packet, PacketFlags } from './packet.js';
import { ChannelConfig } from './channel.js';
import { SessionState } from './state.js';
import { FrameCompression } from './compression.js';
import { FrameCipher } from './security.js';
import { NalixStatus, StatusCode } from './status.js';

/**
 * Unifies execution of cryptographic and compression transforms for inbound and outbound frames.
 * Directly mirrors Nalix.Codec.Transforms.FramePipeline.
 */
export class FramePipeline {
  /**
   * Applies outbound transforms:
   * 1. Auto-assigns SequenceId (16-bit) if unset.
   * 2. Compresses payload using LZ4 if enabled, threshold met, and worthwhile (>12.5% reduction).
   * 3. Encrypts payload using ChaCha20-Poly1305 if encryption is enabled.
   */
  public static processOutbound(
    packet: Packet,
    config: ChannelConfig,
    state: SessionState,
    nextSeq16: () => number,
    nextSeq32: () => number,
    encrypt?: boolean
  ): Packet {
    // 1. Auto-assign 16-bit packet sequence ID if unset (0)
    if (packet.header.sequenceId === 0) {
      packet.header.sequenceId = nextSeq16();
    }

    let payload = packet.payload;
    let flags = packet.header.flags;

    // 2. Compression (compress first)
    if (config.compressionEnabled && payload.length >= config.compressionThreshold) {
      const compressed = FrameCompression.compress(payload);
      if (compressed !== null) {
        payload = compressed;
        flags |= PacketFlags.COMPRESSED;
      }
    }

    // 3. Encryption (encrypt after compression)
    // System frames (opcode < 0x0100) are unencrypted by default unless explicitly specified.
    // Application frames (opcode >= 0x0100) are encrypted when session encryption is enabled.
    const shouldEncrypt = encrypt !== undefined
      ? encrypt
      : (state.encryptionEnabled && packet.header.opcode >= 0x0100);

    if (shouldEncrypt) {
      if (!state.secret) {
        throw new NalixStatus(StatusCode.FAILED_PRECONDITION, 'Encryption requested but no session secret configured');
      }

      const seq = nextSeq32();
      payload = FrameCipher.encrypt(payload, state.secret, seq, config.algorithm);
      flags |= PacketFlags.ENCRYPTED;
    }

    packet.header.flags = flags;
    packet.payload = payload;
    return packet;
  }

  /**
   * Applies inbound transforms in reverse order:
   * 1. Decrypts payload if ENCRYPTED flag is set.
   * 2. Decompresses payload if COMPRESSED flag is set.
   */
  public static processInbound(packet: Packet, state: SessionState): Packet {
    let payload = packet.payload;
    let flags = packet.header.flags;

    // 1. Decryption (decrypt first)
    if ((flags & PacketFlags.ENCRYPTED) !== 0) {
      if (!state.secret) {
        throw new NalixStatus(StatusCode.UNAUTHENTICATED, 'Received encrypted packet but no session secret configured');
      }

      const res = FrameCipher.decrypt(payload, state.secret);
      payload = res.plaintext;
      flags &= ~PacketFlags.ENCRYPTED;
    }

    // 2. Decompression (decompress after decryption)
    if ((flags & PacketFlags.COMPRESSED) !== 0) {
      payload = FrameCompression.decompress(payload);
      flags &= ~PacketFlags.COMPRESSED;
    }

    packet.header.flags = flags;
    packet.payload = payload;
    return packet;
  }
}
