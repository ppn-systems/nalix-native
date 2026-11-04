import { test } from 'node:test';
import assert from 'node:assert/strict';
import { x25519 } from '@noble/curves/ed25519.js';
import {
  HandshakeX25519,
  performHandshake,
  TransportSession,
  Packet,
  PacketHeader,
  PacketFlags,
  FrameCipher,
  FramePipeline,
  ProtocolOpCode,
  ChannelConfig,
  ConnectivityState,
  NalixStatus,
  StatusCode,
} from '../src/index.js';

test('HandshakeX25519 primitives (HKDF-Keccak256, transcript, proofs)', () => {
  const clientKey = x25519.keygen();
  const clientNonce = new Uint8Array(32);
  const serverKey = x25519.keygen();
  const serverNonce = new Uint8Array(32);
  crypto.getRandomValues(clientNonce);
  crypto.getRandomValues(serverNonce);

  // 1. Transcript hash
  const transcriptHash = HandshakeX25519.computeTranscriptHash(
    clientKey.publicKey,
    clientNonce,
    serverKey.publicKey,
    serverNonce
  );
  assert.equal(transcriptHash.length, 32);

  // 2. Shared secrets
  const sharedEE = x25519.getSharedSecret(clientKey.secretKey, serverKey.publicKey);
  const sharedSE = x25519.getSharedSecret(clientKey.secretKey, serverKey.publicKey); // simulated static
  const masterSecret = HandshakeX25519.computeMasterSecret(sharedEE, sharedSE);
  assert.equal(masterSecret.length, 32);

  // 3. Proofs
  const serverProof = HandshakeX25519.computeServerProof(masterSecret, transcriptHash);
  const clientProof = HandshakeX25519.computeClientProof(masterSecret, transcriptHash);
  const finishProof = HandshakeX25519.computeServerFinishProof(masterSecret, transcriptHash);
  const sessionKey = HandshakeX25519.deriveSessionKey(masterSecret, clientNonce, serverNonce, transcriptHash);

  assert.equal(serverProof.length, 32);
  assert.equal(clientProof.length, 32);
  assert.equal(finishProof.length, 32);
  assert.equal(sessionKey.length, 32);
});

/**
 * Mock TransportSession simulating a Nalix server running the X25519 handshake.
 */
class MockServerHandshakeSession extends TransportSession {
  public serverStaticKey = x25519.keygen();
  public serverEphemeralKey = x25519.keygen();
  public serverNonce = new Uint8Array(32);
  public derivedServerSessionKey: Uint8Array | null = null;
  public derivedServerToken: bigint = 9876543210n;
  private _connected: boolean = true;
  private _clientEphemeralPub: Uint8Array | null = null;
  private _clientNonce: Uint8Array | null = null;
  private _masterSecret: Uint8Array | null = null;
  private _transcriptHash: Uint8Array | null = null;

  constructor() {
    super(new ChannelConfig({ url: 'wss://localhost/ws/', allowTofu: true }));
    crypto.getRandomValues(this.serverNonce);
    this._state = ConnectivityState.READY;
  }

  public get isConnected(): boolean {
    return this._connected;
  }

  public async connect(): Promise<void> {
    this._connected = true;
    this.setState(ConnectivityState.READY);
  }

  public async disconnect(): Promise<void> {
    this._connected = false;
    this.setState(ConnectivityState.SHUTDOWN);
  }

  public close(): void {
    this.disconnect().catch(() => {});
  }

  protected sendRawFrame(bytes: Uint8Array): void {
    // Decode incoming raw client frame
    const packet = Packet.decode(bytes);
    this.handleClientPacket(packet);
  }

  private handleClientPacket(packet: Packet): void {
    if (packet.header.opcode === ProtocolOpCode.SESSION_INIT) {
      // Step 1: Client sent SessionInit
      this._clientEphemeralPub = packet.payload.slice(0, 32);
      this._clientNonce = packet.payload.slice(32, 64);

      // Server computes Diffie-Hellman secrets
      const sharedEE = x25519.getSharedSecret(this.serverEphemeralKey.secretKey, this._clientEphemeralPub);
      const sharedSE = x25519.getSharedSecret(this.serverStaticKey.secretKey, this._clientEphemeralPub);
      this._masterSecret = HandshakeX25519.computeMasterSecret(sharedEE, sharedSE);

      this._transcriptHash = HandshakeX25519.computeTranscriptHash(
        this._clientEphemeralPub,
        this._clientNonce,
        this.serverEphemeralKey.publicKey,
        this.serverNonce
      );

      const serverProof = HandshakeX25519.computeServerProof(this._masterSecret, this._transcriptHash);

      // Prepare SessionChallenge payload (OpCode 0x0006: 32B pub + 32B nonce + 32B proof)
      const challengePayload = new Uint8Array(96);
      challengePayload.set(this.serverEphemeralKey.publicKey, 0);
      challengePayload.set(this.serverNonce, 32);
      challengePayload.set(serverProof, 64);

      const challengePacket = new Packet(
        new PacketHeader(ProtocolOpCode.SESSION_CHALLENGE, 0, 0, packet.header.sequenceId),
        challengePayload
      );

      setTimeout(() => {
        this.dispatchInboundPacket(challengePacket);
      }, 5);
    } else if (packet.header.opcode === ProtocolOpCode.SESSION_PROOF) {
      // Step 2: Client sent SessionProof
      const clientProof = packet.payload.slice(0, 32);
      const expectedClientProof = HandshakeX25519.computeClientProof(this._masterSecret!, this._transcriptHash!);
      assert.deepEqual(clientProof, expectedClientProof, 'Server must verify client proof');

      // Server derives session key
      this.derivedServerSessionKey = HandshakeX25519.deriveSessionKey(
        this._masterSecret!,
        this._clientNonce!,
        this.serverNonce,
        this._transcriptHash!
      );

      const finishProof = HandshakeX25519.computeServerFinishProof(this._masterSecret!, this._transcriptHash!);

      // Prepare SessionEstablished payload (OpCode 0x0007: 32B proof + 8B token)
      const establishedPayload = new Uint8Array(40);
      establishedPayload.set(finishProof, 0);
      const view = new DataView(establishedPayload.buffer, establishedPayload.byteOffset, establishedPayload.byteLength);
      view.setBigUint64(32, this.derivedServerToken, true);

      // Server encrypts SessionEstablished
      // (AAD = EnvelopeHeader || Nonce || FrameHeader6, matching the Nalix host)
      const establishedHeader = new PacketHeader(ProtocolOpCode.SESSION_ESTABLISHED, PacketFlags.ENCRYPTED, 0, packet.header.sequenceId);
      const frameHeader = new Uint8Array(6);
      establishedHeader.encode(frameHeader, 0);
      const encryptedPayload = FrameCipher.encrypt(establishedPayload, this.derivedServerSessionKey!, 1, undefined, frameHeader);

      const establishedPacket = new Packet(establishedHeader, encryptedPayload);

      setTimeout(() => {
        const decoded = FramePipeline.processInbound(establishedPacket, this.sessionState);
        this.dispatchInboundPacket(decoded);
      }, 5);
    }
  }
}

test('Full X25519 Handshake completes end-to-end and synchronizes session key', async () => {
  const session = new MockServerHandshakeSession();

  // Run client handshake against mock server
  const result = await session.handshake({
    serverPublicKey: session.serverStaticKey.publicKey,
    timeoutMs: 2000,
  });

  assert.ok(result.sessionKey.length === 32, 'Session key must be 32 bytes');
  assert.equal(result.sessionToken, 9876543210n, 'Session token must match server token');
  assert.deepEqual(result.sessionKey, session.derivedServerSessionKey, 'Client and Server session keys MUST match');
  assert.equal(session.sessionState.encryptionEnabled, true, 'Encryption must be enabled after handshake');
  assert.deepEqual(session.sessionState.secret, result.sessionKey, 'SessionState secret must be set');
});
