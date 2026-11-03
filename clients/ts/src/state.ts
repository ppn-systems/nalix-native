/**
 * Encapsulates the runtime state of a transport session, separating ephemeral connection data
 * (like encryption keys and session tokens) from persistent configuration options.
 * Matches Nalix.SDK.Transport.SessionState.
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
   * Resets the session state back to its unencrypted, initial state.
   */
  public reset(): void {
    if (this.secret) {
      this.secret.fill(0);
      this.secret = null;
    }
    this.sessionToken = 0n;
    this.encryptionEnabled = false;
  }
}
