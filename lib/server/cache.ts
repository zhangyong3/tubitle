export class LruCache<T> {
  private readonly values = new Map<string, T>();

  constructor(private readonly capacity: number) {}

  get(key: string): T | undefined {
    const value = this.values.get(key);
    if (value === undefined) return undefined;
    this.values.delete(key);
    this.values.set(key, value);
    return value;
  }

  set(key: string, value: T): void {
    this.values.delete(key);
    this.values.set(key, value);
    if (this.values.size > this.capacity) {
      const oldest = this.values.keys().next().value;
      if (oldest) this.values.delete(oldest);
    }
  }
}
