import { BaseRedisStore, createLogger } from "@lobu/core";
import type Redis from "ioredis";

const logger = createLogger("oauth-identity-store");

/**
 * Record linking an OAuth provider identity to a platform user.
 */
export interface OAuthIdentityMapping {
  /** Platform user ID (Slack: U12345, Telegram: 67890) */
  userId: string;
  /** Messaging platform (slack, telegram, whatsapp) */
  platform: string;
  /** When the mapping was first established */
  linkedAt: string;
  /** When the mapping was last verified */
  lastVerifiedAt: string;
}

/**
 * Stores mappings between OAuth provider identities and platform users.
 *
 * Key pattern: oauth:identity:{provider}:{oauthSub}
 *
 * First access establishes the mapping (trusted because the settings link
 * was sent to the correct user in chat). Subsequent accesses verify the
 * mapping matches — if a different platform user tries to use the same
 * OAuth identity, access is denied.
 */
export class OAuthIdentityStore extends BaseRedisStore<OAuthIdentityMapping> {
  constructor(redis: Redis) {
    super({
      redis,
      keyPrefix: "oauth:identity",
      loggerName: "oauth-identity-store",
    });
  }

  /**
   * Link an OAuth identity to a platform user.
   * Returns false if already linked to a DIFFERENT user.
   */
  async linkIdentity(
    provider: string,
    oauthSub: string,
    userId: string,
    platform: string
  ): Promise<{ linked: boolean; existingUserId?: string }> {
    const key = this.buildKey(provider, oauthSub);
    const existing = await this.get(key);

    if (existing) {
      if (existing.userId === userId && existing.platform === platform) {
        // Same user — update lastVerifiedAt
        existing.lastVerifiedAt = new Date().toISOString();
        await this.set(key, existing);
        logger.info("OAuth identity re-verified", {
          provider,
          oauthSub: `${oauthSub.substring(0, 8)}...`,
          userId,
        });
        return { linked: true };
      }

      // Different user — reject
      logger.warn("OAuth identity already linked to different user", {
        provider,
        oauthSub: `${oauthSub.substring(0, 8)}...`,
        existingUserId: existing.userId,
        attemptedUserId: userId,
      });
      return { linked: false, existingUserId: existing.userId };
    }

    // New mapping
    const mapping: OAuthIdentityMapping = {
      userId,
      platform,
      linkedAt: new Date().toISOString(),
      lastVerifiedAt: new Date().toISOString(),
    };
    await this.set(key, mapping);

    logger.info("OAuth identity linked", {
      provider,
      oauthSub: `${oauthSub.substring(0, 8)}...`,
      userId,
      platform,
    });
    return { linked: true };
  }

  /**
   * Verify that an OAuth identity maps to the expected platform user.
   */
  async verifyIdentity(
    provider: string,
    oauthSub: string,
    expectedUserId: string
  ): Promise<boolean> {
    const key = this.buildKey(provider, oauthSub);
    const mapping = await this.get(key);

    if (!mapping) {
      // No mapping exists yet — caller should create one
      return true;
    }

    return mapping.userId === expectedUserId;
  }

  /**
   * Get the platform user ID for an OAuth identity.
   */
  async getMapping(
    provider: string,
    oauthSub: string
  ): Promise<OAuthIdentityMapping | null> {
    const key = this.buildKey(provider, oauthSub);
    return this.get(key);
  }

  /**
   * Remove an OAuth identity mapping.
   */
  async unlinkIdentity(provider: string, oauthSub: string): Promise<void> {
    const key = this.buildKey(provider, oauthSub);
    await this.delete(key);
  }
}
