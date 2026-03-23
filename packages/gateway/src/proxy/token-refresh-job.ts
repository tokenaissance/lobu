import { createLogger } from "@lobu/core";
import type Redis from "ioredis";
import type { OAuthClient } from "../auth/oauth/client";
import type { AuthProfilesManager } from "../auth/settings/auth-profiles-manager";

const logger = createLogger("token-refresh-job");

const REFRESH_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes
const EXPIRY_BUFFER_MS = 5 * 60 * 1000; // Refresh tokens expiring within 5 minutes

export interface RefreshableProvider {
  providerId: string;
  oauthClient: OAuthClient;
}

/**
 * Background job that proactively refreshes OAuth tokens before they expire.
 *
 * On each tick:
 * 1. Scans authProfiles for OAuth tokens expiring soon across all registered providers
 * 2. Refreshes via the provider's OAuth client
 * 3. Updates authProfiles with new credentials
 */
export class TokenRefreshJob {
  private timer: Timer | null = null;
  private refreshLocks = new Map<string, Promise<void>>();

  constructor(
    private authProfilesManager: AuthProfilesManager,
    private redis: Redis,
    private refreshableProviders: RefreshableProvider[]
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch((err) =>
        logger.error("Token refresh tick failed:", err)
      );
    }, REFRESH_INTERVAL_MS);
    logger.debug("Token refresh job started");
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    logger.info("Token refresh job stopped");
  }

  private async tick(): Promise<void> {
    const pattern = "agent:settings:*";
    let cursor = "0";
    do {
      const [next, keys] = await this.redis.scan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        100
      );
      cursor = next;
      for (const key of keys) {
        const agentId = key.replace("agent:settings:", "");
        await this.maybeRefresh(agentId);
      }
    } while (cursor !== "0");
  }

  private async maybeRefresh(agentId: string): Promise<void> {
    // Prevent concurrent refresh for the same agent
    const existing = this.refreshLocks.get(agentId);
    if (existing) {
      await existing;
      return;
    }

    const promise = this.doRefresh(agentId);
    this.refreshLocks.set(agentId, promise);
    try {
      await promise;
    } finally {
      this.refreshLocks.delete(agentId);
    }
  }

  private async doRefresh(agentId: string): Promise<void> {
    for (const { providerId, oauthClient } of this.refreshableProviders) {
      const profiles = await this.authProfilesManager.getProviderProfiles(
        agentId,
        providerId
      );
      const oauthProfile = profiles.find(
        (profile) =>
          profile.authType === "oauth" && !!profile.metadata?.refreshToken
      );

      if (!oauthProfile?.metadata?.refreshToken) continue;

      const expiresAt = oauthProfile.metadata.expiresAt || 0;
      const isExpiring = expiresAt <= Date.now() + EXPIRY_BUFFER_MS;
      if (!isExpiring) continue;

      logger.info(
        `Refreshing ${providerId} token for agent ${agentId} profile ${oauthProfile.id}`,
        { expiresAt: new Date(expiresAt).toISOString() }
      );

      try {
        const newCredentials = await oauthClient.refreshToken(
          oauthProfile.metadata.refreshToken
        );

        await this.authProfilesManager.upsertProfile({
          agentId,
          id: oauthProfile.id,
          provider: oauthProfile.provider,
          credential: newCredentials.accessToken,
          authType: "oauth",
          label: oauthProfile.label,
          model: oauthProfile.model,
          metadata: {
            ...oauthProfile.metadata,
            refreshToken: newCredentials.refreshToken,
            expiresAt: newCredentials.expiresAt,
          },
          makePrimary: false,
        });

        logger.info(`Token refreshed for agent ${agentId} (${providerId})`);
      } catch (error) {
        logger.error(
          `Failed to refresh ${providerId} token for agent ${agentId}`,
          {
            error,
            profileId: oauthProfile.id,
          }
        );
      }
    }
  }
}
