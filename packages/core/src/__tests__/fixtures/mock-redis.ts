/**
 * Unified in-memory Redis mock for testing.
 *
 * Replaces three duplicated implementations:
 *   - MockRedisClient in gateway setup.ts
 *   - FakeRedis in system-message-limiter.test.ts
 *   - queue mock getRedisClient
 *
 * Supports string, set, list, and hash operations with TTL tracking.
 */

type SetMode = "NX" | undefined;

export class MockRedisClient {
  private store = new Map<string, { value: string; ttl?: number }>();
  private sets = new Map<string, Set<string>>();
  private lists = new Map<string, string[]>();
  private currentTime = Date.now();

  // --- String operations ---

  async exists(key: string): Promise<number> {
    const entry = this.store.get(key);
    if (!entry) return 0;
    if (entry.ttl && entry.ttl < this.currentTime) {
      this.store.delete(key);
      return 0;
    }
    return 1;
  }

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.ttl && entry.ttl < this.currentTime) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  /**
   * ioredis-compatible set with optional EX / NX flags.
   * Supports: set(key, value), set(key, value, "EX", sec), set(key, value, "EX", sec, "NX")
   */
  async set(
    key: string,
    value: string,
    exTokenOrTtl?: "EX" | number,
    exSeconds?: number,
    mode?: SetMode
  ): Promise<"OK" | null> {
    // NX check must be synchronous to avoid TOCTOU race
    if (mode === "NX") {
      const entry = this.store.get(key);
      const alive = entry && (!entry.ttl || entry.ttl >= this.currentTime);
      if (alive) return null;
    }

    let ttl: number | undefined;
    if (exTokenOrTtl === "EX" && typeof exSeconds === "number") {
      ttl = this.currentTime + exSeconds * 1000;
    } else if (typeof exTokenOrTtl === "number") {
      ttl = this.currentTime + exTokenOrTtl * 1000;
    }

    this.store.set(key, { value, ttl });
    return "OK";
  }

  async setex(key: string, ttlSeconds: number, value: string): Promise<void> {
    const ttl = this.currentTime + ttlSeconds * 1000;
    this.store.set(key, { value, ttl });
  }

  async del(...keys: string[]): Promise<number> {
    let deleted = 0;
    for (const key of keys) {
      const existed =
        this.store.has(key) || this.sets.has(key) || this.lists.has(key);
      this.store.delete(key);
      this.sets.delete(key);
      this.lists.delete(key);
      if (existed) deleted++;
    }
    return deleted;
  }

  async expire(key: string, seconds: number): Promise<number> {
    if (this.store.has(key)) {
      const entry = this.store.get(key)!;
      entry.ttl = this.currentTime + seconds * 1000;
      return 1;
    }
    return 0;
  }

  // --- Set operations ---

  async sadd(key: string, ...members: string[]): Promise<number> {
    if (!this.sets.has(key)) this.sets.set(key, new Set());
    const set = this.sets.get(key)!;
    let added = 0;
    for (const m of members) {
      if (!set.has(m)) {
        set.add(m);
        added++;
      }
    }
    return added;
  }

  async srem(key: string, ...members: string[]): Promise<number> {
    const set = this.sets.get(key);
    if (!set) return 0;
    let removed = 0;
    for (const m of members) {
      if (set.delete(m)) removed++;
    }
    return removed;
  }

  async smembers(key: string): Promise<string[]> {
    const set = this.sets.get(key);
    return set ? Array.from(set) : [];
  }

  // --- List operations ---

  async rpush(key: string, ...values: string[]): Promise<number> {
    if (!this.lists.has(key)) this.lists.set(key, []);
    const list = this.lists.get(key)!;
    list.push(...values);
    return list.length;
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    const list = this.lists.get(key);
    if (!list) return [];
    const end = stop === -1 ? list.length : stop + 1;
    return list.slice(start, end);
  }

  // --- Test helpers ---

  advanceTime(ms: number): void {
    this.currentTime += ms;
  }

  has(key: string): boolean {
    return this.store.has(key);
  }

  clear(): void {
    this.store.clear();
    this.sets.clear();
    this.lists.clear();
  }
}
