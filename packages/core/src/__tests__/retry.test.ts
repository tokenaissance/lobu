import { describe, expect, mock, test } from "bun:test";
import { retryWithBackoff } from "../utils/retry";

describe("retryWithBackoff", () => {
  test("returns result on first success", async () => {
    const fn = mock(() => Promise.resolve("ok"));
    const result = await retryWithBackoff(fn);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test("retries on failure and returns on eventual success", async () => {
    let attempt = 0;
    const fn = mock(async () => {
      attempt++;
      if (attempt < 3) throw new Error(`fail ${attempt}`);
      return "success";
    });

    const result = await retryWithBackoff(fn, {
      maxRetries: 3,
      baseDelay: 0,
    });
    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test("throws last error when all retries exhausted", async () => {
    const fn = mock(async () => {
      throw new Error("always fails");
    });

    await expect(
      retryWithBackoff(fn, { maxRetries: 2, baseDelay: 0 })
    ).rejects.toThrow("always fails");
    // 1 initial + 2 retries = 3 calls
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test("maxRetries=0 means single attempt, no retries", async () => {
    const fn = mock(async () => {
      throw new Error("fail");
    });

    await expect(
      retryWithBackoff(fn, { maxRetries: 0, baseDelay: 0 })
    ).rejects.toThrow("fail");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test("calls onRetry callback with attempt number and error", async () => {
    let attempt = 0;
    const fn = async () => {
      attempt++;
      if (attempt < 3) throw new Error(`err-${attempt}`);
      return "done";
    };

    const retries: { attempt: number; message: string }[] = [];
    await retryWithBackoff(fn, {
      maxRetries: 3,
      baseDelay: 0,
      onRetry: (attempt, error) => {
        retries.push({ attempt, message: error.message });
      },
    });

    expect(retries).toEqual([
      { attempt: 1, message: "err-1" },
      { attempt: 2, message: "err-2" },
    ]);
  });

  test("uses defaults when no options provided", async () => {
    const fn = mock(() => Promise.resolve(42));
    const result = await retryWithBackoff(fn);
    expect(result).toBe(42);
  });

  test("linear strategy increases delay linearly", async () => {
    const delays: number[] = [];
    const originalSetTimeout = globalThis.setTimeout;

    // Patch setTimeout to capture delays (but resolve immediately)
    globalThis.setTimeout = ((fn: () => void, ms: number) => {
      delays.push(ms);
      return originalSetTimeout(fn, 0);
    }) as any;

    let attempt = 0;
    try {
      await retryWithBackoff(
        async () => {
          attempt++;
          if (attempt <= 3) throw new Error("fail");
          return "ok";
        },
        { maxRetries: 3, baseDelay: 100, strategy: "linear" }
      );
    } finally {
      globalThis.setTimeout = originalSetTimeout;
    }

    // Linear: 100*(0+1)=100, 100*(1+1)=200, 100*(2+1)=300
    expect(delays).toEqual([100, 200, 300]);
  });

  test("exponential strategy doubles delay", async () => {
    const delays: number[] = [];
    const originalSetTimeout = globalThis.setTimeout;

    globalThis.setTimeout = ((fn: () => void, ms: number) => {
      delays.push(ms);
      return originalSetTimeout(fn, 0);
    }) as any;

    let attempt = 0;
    try {
      await retryWithBackoff(
        async () => {
          attempt++;
          if (attempt <= 3) throw new Error("fail");
          return "ok";
        },
        { maxRetries: 3, baseDelay: 100, strategy: "exponential" }
      );
    } finally {
      globalThis.setTimeout = originalSetTimeout;
    }

    // Exponential: 100*2^0=100, 100*2^1=200, 100*2^2=400
    expect(delays).toEqual([100, 200, 400]);
  });
});
