import { createLogger, type Logger } from "@peerbot/core";
import type Redis from "ioredis";

/**
 * Base interface for OAuth credentials
 * All credential types must at least have an access token
 */
export interface BaseCredentials {
  accessToken: string;
}

/**
 * Generic credential store for OAuth tokens
 * Pattern: {keyPrefix}:{...keyParts}
 */
export class BaseCredentialStore<T extends BaseCredentials> {
  protected logger: Logger;

  constructor(
    protected redis: Redis,
    protected keyPrefix: string,
    loggerName: string
  ) {
    this.logger = createLogger(loggerName);
  }

  /**
   * Build Redis key from parts
   */
  protected buildKey(...parts: string[]): string {
    return [this.keyPrefix, ...parts].join(":");
  }

  /**
   * Store credentials (public for composition pattern)
   */
  async setCredentials(
    key: string,
    credentials: T,
    ttlSeconds?: number
  ): Promise<void> {
    try {
      const data = JSON.stringify(credentials);
      if (ttlSeconds) {
        await this.redis.setex(key, ttlSeconds, data);
      } else {
        await this.redis.set(key, data);
      }
    } catch (error) {
      this.logger.error("Failed to store credentials", { error, key });
      throw error;
    }
  }

  /**
   * Get credentials (public for composition pattern)
   * Returns null if not found or invalid
   */
  async getCredentials(key: string): Promise<T | null> {
    try {
      const data = await this.redis.get(key);
      if (!data) {
        return null;
      }

      const credentials = JSON.parse(data) as T;

      // Validate required field
      if (!credentials.accessToken) {
        this.logger.warn("Invalid credentials: missing accessToken", { key });
        return null;
      }

      return credentials;
    } catch (error) {
      this.logger.error("Failed to get credentials", { error, key });
      return null;
    }
  }

  /**
   * Delete credentials (public for composition pattern)
   */
  async deleteCredentials(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch (error) {
      this.logger.error("Failed to delete credentials", { error, key });
    }
  }

  /**
   * Check if credentials exist (public for composition pattern)
   */
  async hasCredentials(key: string): Promise<boolean> {
    try {
      const exists = await this.redis.exists(key);
      return exists === 1;
    } catch (error) {
      this.logger.error("Failed to check credentials", { error, key });
      return false;
    }
  }
}
