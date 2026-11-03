/**
 * Supervisor responsible solely for automatic connection recovery and backoff scheduling.
 * Directly mirrors Nalix.SDK.Transport.Internal.ReconnectSupervisor.
 */
export class ReconnectSupervisor {
  private _attempts: number = 0;
  private _timer: any = null;
  private _cancelled: boolean = false;

  constructor(
    private readonly _reconnectAction: () => Promise<void>,
    private readonly _maxAttempts: number,
    private readonly _intervalMs: number
  ) {}

  public get attempts(): number {
    return this._attempts;
  }

  public get isScheduled(): boolean {
    return this._timer !== null;
  }

  /**
   * Resets the attempt counter and cancels any active reconnect timer.
   */
  public reset(): void {
    this.cancel();
    this._attempts = 0;
    this._cancelled = false;
  }

  /**
   * Cancels any pending reconnection timer.
   */
  public cancel(): void {
    if (this._timer !== null) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    this._cancelled = true;
  }

  /**
   * Schedules a reconnection attempt if auto-reconnect is enabled and attempts have not been exhausted.
   * Returns true if a reconnect was scheduled, false otherwise.
   */
  public schedule(): boolean {
    if (this._cancelled || this._timer !== null) {
      return false;
    }

    if (this._maxAttempts > 0 && this._attempts >= this._maxAttempts) {
      return false;
    }

    this._attempts++;
    // Exponential backoff capped at 30 seconds
    const delay = Math.min(this._intervalMs * Math.pow(1.5, this._attempts - 1), 30000);

    this._timer = setTimeout(async () => {
      this._timer = null;
      if (!this._cancelled) {
        try {
          await this._reconnectAction();
        } catch {}
      }
    }, delay);

    return true;
  }
}
