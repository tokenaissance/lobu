import { BaseRedisStore } from "@lobu/core";
import type Redis from "ioredis";

interface AdminStatusEntry {
  isAdmin: boolean;
  cachedAt: number;
}

/**
 * Cache admin status checks to avoid platform API rate limiting.
 * TTL: 5 minutes by default.
 *
 * Storage: admin_status:{platform}:{chatId}:{userId}
 */
export class AdminStatusCache extends BaseRedisStore<AdminStatusEntry> {
  private readonly CACHE_TTL_SECONDS = 300; // 5 minutes

  constructor(redis: Redis) {
    super({
      redis,
      keyPrefix: "admin_status",
      loggerName: "admin-status-cache",
    });
  }

  /**
   * Get cached admin status.
   * Returns null if not cached or expired.
   */
  async getStatus(
    platform: string,
    chatId: string,
    userId: string
  ): Promise<boolean | null> {
    const key = this.buildKey(platform, chatId, userId);
    const cached = await this.get(key);
    if (!cached) return null;
    return cached.isAdmin;
  }

  /**
   * Cache admin status with TTL.
   */
  async setStatus(
    platform: string,
    chatId: string,
    userId: string,
    isAdmin: boolean
  ): Promise<void> {
    const key = this.buildKey(platform, chatId, userId);
    await this.set(
      key,
      { isAdmin, cachedAt: Date.now() },
      this.CACHE_TTL_SECONDS
    );
  }
}
