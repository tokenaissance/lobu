/**
 * Async lock for serializing concurrent operations
 * Prevents race conditions in async code by ensuring only one operation runs at a time
 *
 * @example
 * ```typescript
 * class StreamSession {
 *   private streamLock = new AsyncLock();
 *
 *   async appendDelta(delta: string) {
 *     return this.streamLock.acquire(() => this.appendDeltaUnsafe(delta));
 *   }
 *
 *   private async appendDeltaUnsafe(delta: string) {
 *     // Critical section - only one execution at a time
 *   }
 * }
 * ```
 */
export class AsyncLock {
  private lock: Promise<void> = Promise.resolve();
  private lockContext: string;

  constructor(context: string = "unknown") {
    this.lockContext = context;
  }

  /**
   * Acquire lock and execute function exclusively
   *
   * @param fn - The async function to execute with exclusive access
   * @param timeoutMs - Maximum time to wait for lock acquisition (default: 30s)
   * @returns The result of the function
   * @throws Error if lock acquisition times out
   */
  async acquire<T>(
    fn: () => Promise<T>,
    timeoutMs: number = 30000
  ): Promise<T> {
    const currentLock = this.lock;
    let releaseLock: (() => void) | undefined;

    // Create new lock that will be released when fn completes
    this.lock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
      // Wait for previous operation with timeout to prevent deadlock
      const lockTimeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(
            new Error(
              `Lock acquisition timeout after ${timeoutMs}ms - possible deadlock in ${this.lockContext}`
            )
          );
        }, timeoutMs);
      });

      await Promise.race([currentLock, lockTimeout]);
      clearTimeout(timer);

      // Execute function with exclusive access
      return await fn();
    } finally {
      clearTimeout(timer);
      // Always release lock, even on error
      releaseLock?.();
    }
  }
}
