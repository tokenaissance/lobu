import { describe, expect, test } from "bun:test";
import { SystemMessageLimiter } from "../infrastructure/redis/system-message-limiter";

type SetMode = "NX" | undefined;

class FakeRedis {
  private data = new Map<string, { value: string; expiresAtMs?: number }>();

  private isExpired(entry: { expiresAtMs?: number } | undefined): boolean {
    if (!entry) return true;
    if (entry.expiresAtMs === undefined) return false;
    return entry.expiresAtMs <= Date.now();
  }

  private getEntry(
    key: string
  ): { value: string; expiresAtMs?: number } | undefined {
    const entry = this.data.get(key);
    if (!entry) return undefined;
    if (this.isExpired(entry)) {
      this.data.delete(key);
      return undefined;
    }
    return entry;
  }

  async exists(key: string): Promise<number> {
    return this.getEntry(key) ? 1 : 0;
  }

  async get(key: string): Promise<string | null> {
    const entry = this.getEntry(key);
    return entry ? entry.value : null;
  }

  // ioredis-compatible signature: set(key, value, "EX", seconds, "NX")
  async set(
    key: string,
    value: string,
    exToken?: "EX",
    exSeconds?: number,
    mode?: SetMode
  ): Promise<"OK" | null> {
    if (mode === "NX" && this.getEntry(key)) {
      return null;
    }

    const expiresAtMs =
      exToken === "EX" && typeof exSeconds === "number"
        ? Date.now() + Math.max(0, exSeconds) * 1000
        : undefined;

    this.data.set(key, { value, expiresAtMs });
    return "OK";
  }

  async del(key: string): Promise<number> {
    const existed = this.data.delete(key);
    return existed ? 1 : 0;
  }
}

describe("SystemMessageLimiter", () => {
  test("sends once and suppresses subsequent sends within TTL", async () => {
    const redis = new FakeRedis() as any;
    const limiter = new SystemMessageLimiter(redis, "test");

    let sentCount = 0;
    const sendFn = async () => {
      sentCount += 1;
    };

    const first = await limiter.sendOnce("k", sendFn, {
      sentTtlSeconds: 60,
      lockTtlSeconds: 30,
    });
    const second = await limiter.sendOnce("k", sendFn, {
      sentTtlSeconds: 60,
      lockTtlSeconds: 30,
    });

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(sentCount).toBe(1);
  });

  test("suppresses concurrent sends using lock even before sent marker is written", async () => {
    const redis = new FakeRedis() as any;
    const limiter = new SystemMessageLimiter(redis, "test");

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    let started = 0;
    const sendFn = async () => {
      started += 1;
      await gate;
    };

    const p1 = limiter.sendOnce("k2", sendFn, {
      sentTtlSeconds: 60,
      lockTtlSeconds: 30,
    });
    const p2 = limiter.sendOnce("k2", sendFn, {
      sentTtlSeconds: 60,
      lockTtlSeconds: 30,
    });

    // Ensure both have attempted to run; only one should have entered sendFn.
    await new Promise((r) => setTimeout(r, 0));
    expect(started).toBe(1);

    release();
    const [r1, r2] = await Promise.all([p1, p2]);
    expect([r1, r2].filter(Boolean).length).toBe(1);
  });

  test("does not set sent marker on failure (allows retry)", async () => {
    const redis = new FakeRedis() as any;
    const limiter = new SystemMessageLimiter(redis, "test");

    let attempts = 0;
    const sendFn = async () => {
      attempts += 1;
      throw new Error("fail");
    };

    await expect(
      limiter.sendOnce("k3", sendFn, { sentTtlSeconds: 60, lockTtlSeconds: 30 })
    ).rejects.toThrow("fail");

    // Next call should try again (not suppressed).
    await expect(
      limiter.sendOnce("k3", sendFn, { sentTtlSeconds: 60, lockTtlSeconds: 30 })
    ).rejects.toThrow("fail");

    expect(attempts).toBe(2);
  });
});
