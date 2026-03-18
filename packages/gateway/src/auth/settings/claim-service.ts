import { randomBytes } from "node:crypto";
import { createLogger } from "@lobu/core";
import type Redis from "ioredis";
import { resolvePublicUrl } from "../../utils/public-url";

const logger = createLogger("settings-claim-service");

/** Claim data stored in Redis */
interface ClaimData {
  platform: string;
  channelId: string;
  platformUserId: string;
}

/** Access entry stored in Redis set */
interface AccessEntry {
  platform: string;
  channelId: string;
}

/**
 * Manages channel ownership claims and permanent access grants for OAuth settings.
 *
 * Flow:
 * 1. User types /configure → createClaim() generates a one-time claim code
 * 2. Claim code is embedded in the settings URL (?claim=X)
 * 3. After OAuth login, consumeClaim() proves the OAuth user owns the channel
 * 4. grantAccess() records permanent access for that OAuth user + channel pair
 */
export class ClaimService {
  private static readonly CLAIM_TTL_SECONDS = 5 * 60; // 5 minutes
  private static readonly CLAIM_PREFIX = "settings:claim:";
  private static readonly ACCESS_PREFIX = "settings:access:";
  private static readonly IDENTITY_PREFIX = "settings:identity:";

  constructor(private redis: Redis) {}

  /**
   * Create a one-time claim code proving channel membership.
   * Returns the claim code to embed in the settings URL.
   */
  async createClaim(
    platform: string,
    channelId: string,
    platformUserId: string
  ): Promise<string> {
    const code = randomBytes(24).toString("base64url");
    const key = `${ClaimService.CLAIM_PREFIX}${code}`;
    const data: ClaimData = { platform, channelId, platformUserId };

    await this.redis.setex(
      key,
      ClaimService.CLAIM_TTL_SECONDS,
      JSON.stringify(data)
    );

    logger.info("Created claim code", { platform, channelId, platformUserId });
    return code;
  }

  /**
   * Consume a claim code (one-time use).
   * Returns the claim data if valid, null if expired or already used.
   */
  async consumeClaim(code: string): Promise<ClaimData | null> {
    const key = `${ClaimService.CLAIM_PREFIX}${code}`;
    const data = await this.redis.getdel(key);

    if (!data) {
      logger.warn("Invalid or expired claim code", { code });
      return null;
    }

    try {
      const parsed = JSON.parse(data) as ClaimData;
      logger.info("Consumed claim code", {
        platform: parsed.platform,
        channelId: parsed.channelId,
      });
      return parsed;
    } catch {
      logger.error("Failed to parse claim data", { code });
      return null;
    }
  }

  /**
   * Grant permanent access for an OAuth user to a platform channel.
   */
  async grantAccess(
    oauthUserId: string,
    platform: string,
    channelId: string
  ): Promise<void> {
    const key = `${ClaimService.ACCESS_PREFIX}${oauthUserId}`;
    const entry: AccessEntry = { platform, channelId };
    await this.redis.sadd(key, JSON.stringify(entry));
    logger.info("Granted access", { oauthUserId, platform, channelId });
  }

  /**
   * Get all channels accessible to an OAuth user.
   */
  async getAccessibleChannels(oauthUserId: string): Promise<AccessEntry[]> {
    const key = `${ClaimService.ACCESS_PREFIX}${oauthUserId}`;
    const members = await this.redis.smembers(key);
    return members.map((m) => JSON.parse(m) as AccessEntry);
  }

  /**
   * Link a platform identity to an OAuth user ID.
   * Subsequent Telegram initData sessions can resolve the linked OAuth identity.
   */
  async linkPlatformIdentity(
    platform: string,
    platformUserId: string,
    oauthUserId: string
  ): Promise<void> {
    const key = `${ClaimService.IDENTITY_PREFIX}${platform}:${platformUserId}`;
    await this.redis.set(key, oauthUserId);
    logger.info("Linked platform identity", {
      platform,
      platformUserId,
      oauthUserId,
    });
  }

  /**
   * Get the linked OAuth user ID for a platform identity.
   * Returns null if no link exists.
   */
  async getLinkedOAuthUserId(
    platform: string,
    platformUserId: string
  ): Promise<string | null> {
    const key = `${ClaimService.IDENTITY_PREFIX}${platform}:${platformUserId}`;
    return this.redis.get(key);
  }

  /**
   * Check if an OAuth user has access to a specific channel.
   */
  async hasAccess(
    oauthUserId: string,
    platform: string,
    channelId: string
  ): Promise<boolean> {
    const key = `${ClaimService.ACCESS_PREFIX}${oauthUserId}`;
    const entry: AccessEntry = { platform, channelId };
    return (await this.redis.sismember(key, JSON.stringify(entry))) === 1;
  }
}

/**
 * Build a settings URL using a claim code.
 * Replaces the old token-based buildSettingsUrl.
 */
export function buildClaimSettingsUrl(
  claimCode: string,
  opts?: { agentId?: string }
): string {
  const path = opts?.agentId
    ? `/agent/${encodeURIComponent(opts.agentId)}`
    : "/agent";
  const url = new URL(resolvePublicUrl(path));
  url.searchParams.set("claim", claimCode);
  return url.toString();
}
