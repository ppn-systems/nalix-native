import { SequenceCounter } from './sequence.js';

/**
 * Encapsulates the runtime state of a transport session, separating ephemeral connection data
 * (like encryption keys and session tokens) from persistent configuration options.
 * Matches Nalix.SDK.Transport.SessionState.
 *
 * The envelope sequence counters live here, next to the key they belong to, so a SessionState
 * handed to a new session object for resume carries them along. Nalix 14.4.x restores its own
 * sequence state on resume (ppn-systems/nalix#479), so a resumed client must continue its
 * counters rather than start again at 0.
 */
export class SessionState {
  /**
   * The 32-byte encryption key used for secure communication.
   */
  public secret: Uint8Array | null = null;

  /**
   * The unique session token assigned by the server (64-bit uint).
   */
  public sessionToken: bigint = 0n;

  /**
   * Indicates whether AEAD encryption is actively applied to all outbound/inbound packets.
   */
  public encryptionEnabled: boolean = false;

  /**
   * Envelope sequence numbers issued to outbound encrypted frames under the current key.
   */
  public readonly sendSequence: SequenceCounter = new SequenceCounter();

  /**
   * Envelope sequence numbers accepted from inbound encrypted frames under the current key,
   * with the replay window.
   */
  public readonly receiveSequence: SequenceCounter = new SequenceCounter();

  /**
   * Restarts both sequence directions at 0. Called when a new key starts: a full handshake
   * and a rekey. Not called on reconnect or resume.
   */
  public resetSequenceCounters(): void {
    this.sendSequence.reset();
    this.receiveSequence.reset();
  }

  /**
   * Resets the session state back to its unencrypted, initial state.
   */
  public reset(): void {
    if (this.secret) {
      this.secret.fill(0);
      this.secret = null;
    }
    this.sessionToken = 0n;
    this.encryptionEnabled = false;
    this.resetSequenceCounters();
  }
}
