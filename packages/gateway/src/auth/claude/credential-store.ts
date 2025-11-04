import type Redis from "ioredis";
import { BaseCredentialStore } from "../credential-store";

export interface ClaudeCredentials {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresAt: number; // Unix timestamp in milliseconds
  scopes: string[];
}

/**
 * Store and retrieve Claude OAuth credentials from Redis
 * Pattern: claude:credential:{userId}
 */
export class ClaudeCredentialStore extends BaseCredentialStore<ClaudeCredentials> {
  constructor(redis: Redis) {
    super(redis, "claude:credential", "claude-credential-store");
  }

  /**
   * Store Claude credentials for a user
   */
  async setCredentials(
    userId: string,
    credentials: ClaudeCredentials
  ): Promise<void> {
    const key = this.buildKey(userId);
    await super.setCredentials(key, credentials);

    this.logger.info(`Stored Claude credentials for user ${userId}`, {
      expiresAt: new Date(credentials.expiresAt).toISOString(),
      scopes: credentials.scopes,
    });
  }

  /**
   * Get Claude credentials for a user
   * Returns null if not found or if credentials are missing required fields
   */
  async getCredentials(userId: string): Promise<ClaudeCredentials | null> {
    const key = this.buildKey(userId);
    const credentials = await super.getCredentials(key);

    if (!credentials) {
      this.logger.debug(`No Claude credentials found for user ${userId}`);
    }

    return credentials;
  }

  /**
   * Delete Claude credentials for a user
   */
  async deleteCredentials(userId: string): Promise<void> {
    const key = this.buildKey(userId);
    await super.deleteCredentials(key);
    this.logger.info(`Deleted Claude credentials for user ${userId}`);
  }

  /**
   * Check if user has Claude credentials
   */
  async hasCredentials(userId: string): Promise<boolean> {
    const key = this.buildKey(userId);
    return super.hasCredentials(key);
  }
}
