/**
 * Small in-memory sliding-window limiter for the Mini App's API routes. It lives per server instance
 * (there is no database behind OddsFront); Polymarket enforces the builder's real relayer budget.
 */
export class WindowLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly maxKeys: number;

  constructor(limit: number, windowMs: number, maxKeys = 10_000) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.maxKeys = maxKeys;
  }

  /** Counts one hit for `key`; false once the key used up its window. */
  take(key: string, now = Date.now()) {
    const recent = (this.hits.get(key) || []).filter((at) => now - at < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > this.maxKeys) {
      for (const [candidate, times] of this.hits) {
        if (!times.some((at) => now - at < this.windowMs)) this.hits.delete(candidate);
        if (this.hits.size <= this.maxKeys) break;
      }
    }
    return true;
  }
}
