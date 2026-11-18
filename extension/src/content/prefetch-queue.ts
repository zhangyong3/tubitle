interface PrefetchTask<T> { key: string; value: T; retries: number; generation: number }
interface PrefetchOptions<T> {
  run(value: T): Promise<unknown>;
  onError(value: T, error: unknown): void;
  onIdle?(): void;
  concurrency?: number;
  capacity?: number;
}

/** Bounded speculative work; current-sentence requests bypass this queue. */
export class PrefetchQueue<T> {
  private waiting: PrefetchTask<T>[] = [];
  private running = new Set<string>();
  private generation = 0;
  private blockedUntil = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly options: PrefetchOptions<T>) {}
  get idle(): boolean { return this.waiting.length === 0 && this.running.size === 0; }
  get size(): number { return this.waiting.length + this.running.size; }
  has(key: string): boolean { return this.running.has(key) || this.waiting.some(task => task.key === key); }

  add(key: string, value: T): boolean {
    // Two old in-flight requests can coexist with a fresh 15 after a seek.
    if (this.has(key) || this.size >= (this.options.capacity ?? 17)) return false;
    this.waiting.push({ key, value, retries: 0, generation: this.generation });
    this.drain();
    return true;
  }

  clear(resetCooldown = true): void {
    this.generation++;
    this.waiting = [];
    clearTimeout(this.timer);
    this.timer = undefined;
    if (resetCooldown) this.blockedUntil = 0;
  }

  private drain(): void {
    if (!this.waiting.length) return;
    const delay = this.blockedUntil - Date.now();
    if (delay > 0) {
      if (this.timer === undefined) this.timer = setTimeout(() => { this.timer = undefined; this.drain(); }, delay);
      return;
    }
    while (this.waiting.length && this.running.size < (this.options.concurrency ?? 2)) {
      const task = this.waiting.shift()!;
      this.running.add(task.key);
      void this.execute(task);
    }
  }

  private async execute(task: PrefetchTask<T>): Promise<void> {
    let retry = false;
    try { await this.options.run(task.value); }
    catch (error) {
      if (task.generation === this.generation) {
        const detail = error as { status?: number; retryAfterMs?: number } | undefined;
        const status = detail?.status;
        const transient = status === undefined || status < 400 || status >= 500 || status === 408 || status === 429;
        if (transient) {
          const delay = Math.max(2000 * 2 ** task.retries + Math.random() * 250, detail?.retryAfterMs || 0);
          this.blockedUntil = Math.max(this.blockedUntil, Date.now() + delay);
          retry = task.retries < 2;
          task.retries++;
        }
        this.options.onError(task.value, error);
      }
    } finally {
      this.running.delete(task.key);
      if (retry && task.generation === this.generation) this.waiting.unshift(task);
      this.drain();
      if (this.idle) this.options.onIdle?.();
    }
  }
}
