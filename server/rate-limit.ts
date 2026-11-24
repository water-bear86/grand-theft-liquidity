export class RateLimiter {
  private buckets = new Map<string, number[]>();

  private max: number;
  constructor(max = 2048) {
    this.max = max;
  }

  allow(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
    const start = now - windowMs;
    const times = (this.buckets.get(key) ?? []).filter((time) => time > start);
    if (times.length >= limit) {
      this.buckets.set(key, times);
      return false;
    }
    times.push(now);
    this.buckets.set(key, times);
    if (this.buckets.size > this.max) this.prune(start);
    return true;
  }

  private prune(start: number) {
    for (const [key, times] of this.buckets) {
      const next = times.filter((time) => time > start);
      if (next.length) this.buckets.set(key, next);
      else this.buckets.delete(key);
    }
  }
}
