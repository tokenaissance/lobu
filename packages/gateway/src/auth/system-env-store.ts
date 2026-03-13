import { createLogger, decrypt, encrypt } from "@lobu/core";
import type Redis from "ioredis";

const logger = createLogger("system-env-store");
const KEY_PREFIX = "system:env:";

/**
 * Redis-backed store for system environment variables.
 * Maintains an in-memory cache for synchronous resolution
 * (required by the string-substitution system).
 */
export class SystemEnvStore {
  private redis: Redis;
  private cache: Map<string, string> = new Map();

  constructor(redis: Redis) {
    this.redis = redis;
  }

  async get(key: string): Promise<string | null> {
    try {
      const raw = await this.redis.get(`${KEY_PREFIX}${key}`);
      if (raw === null) return null;
      return decrypt(raw);
    } catch (error) {
      logger.error("Failed to get env var", { key, error });
      return null;
    }
  }

  async set(key: string, value: string): Promise<void> {
    try {
      await this.redis.set(`${KEY_PREFIX}${key}`, encrypt(value));
      this.cache.set(key, value);
      logger.info(`Set system env var: ${key}`);
    } catch (error) {
      logger.error("Failed to set env var", { key, error });
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.redis.del(`${KEY_PREFIX}${key}`);
      this.cache.delete(key);
      logger.info(`Deleted system env var: ${key}`);
    } catch (error) {
      logger.error("Failed to delete env var", { key, error });
    }
  }

  async listAll(): Promise<Record<string, string>> {
    const result: Record<string, string> = {};
    let cursor = "0";
    try {
      do {
        const [nextCursor, keys] = await this.redis.scan(
          cursor,
          "MATCH",
          `${KEY_PREFIX}*`,
          "COUNT",
          100
        );
        cursor = nextCursor;
        for (const key of keys) {
          const raw = await this.redis.get(key);
          if (raw !== null) {
            result[key.slice(KEY_PREFIX.length)] = decrypt(raw);
          }
        }
      } while (cursor !== "0");
    } catch (error) {
      logger.error("Failed to list env vars", { error });
    }
    return result;
  }

  /**
   * Synchronous lookup: cache first, then process.env.
   * Used by the string-substitution env resolver.
   */
  resolve(key: string): string | undefined {
    return this.cache.get(key) ?? process.env[key] ?? undefined;
  }

  /**
   * Load all system:env:* keys from Redis into the in-memory cache.
   * Call on startup before registering the resolver.
   */
  async refreshCache(): Promise<void> {
    const all = await this.listAll();
    this.cache.clear();
    for (const [key, value] of Object.entries(all)) {
      this.cache.set(key, value);
    }
    logger.info(`Loaded ${this.cache.size} system env vars into cache`);
  }
}
