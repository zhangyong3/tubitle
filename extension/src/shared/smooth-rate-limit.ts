export class SmoothRateLimit {
  private nextRequestAt = 0;

  constructor(private readonly intervalMs: number) {}

  reserve(now = Date.now()): number {
    const scheduledAt = Math.max(now, this.nextRequestAt);
    this.nextRequestAt = scheduledAt + this.intervalMs;
    return scheduledAt - now;
  }
}
