import { createLogger } from "@lobu/core";
import type Redis from "ioredis";
import { ClaudeOAuthClient } from "../auth/oauth/claude-client";
import type { AuthProfilesManager } from "../auth/settings/auth-profiles-manager";
import { updateSecretValue } from "./secret-proxy";

const logger = createLogger("token-refresh-job");

const REFRESH_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes
const EXPIRY_BUFFER_MS = 5 * 60 * 1000; // Refresh tokens expiring within 5 minutes

/**
 * Background job that proactively refreshes Claude OAuth tokens before they expire.
 *
 * On each tick:
 * 1. Scans authProfiles for Claude OAuth tokens expiring soon
 * 2. Refreshes via Claude OAuth client
 * 3. Updates authProfiles with new credentials
 * 4. Updates active Redis placeholder mappings so the proxy serves fresh tokens
 *
 * TODO: Generalize to all OAuth providers when more providers support refresh tokens.
 */
export class TokenRefreshJob {
  private timer: Timer | null = null;
  private oauthClient: ClaudeOAuthClient;
  private refreshLocks = new Map<string, Promise<void>>();

  constructor(
    private authProfilesManager: AuthProfilesManager,
    private redis: Redis
  ) {
    this.oauthClient = new ClaudeOAuthClient();
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch((err) =>
        logger.error("Token refresh tick failed:", err)
      );
    }, REFRESH_INTERVAL_MS);
    logger.info("Token refresh job started (interval: 2m)");
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
    const profiles = await this.authProfilesManager.getProviderProfiles(
      agentId,
      "claude"
    );
    const oauthProfile = profiles.find(
      (profile) =>
        profile.authType === "oauth" && !!profile.metadata?.refreshToken
    );

    if (!oauthProfile?.metadata?.refreshToken) return;

    const expiresAt = oauthProfile.metadata.expiresAt || 0;
    const isExpiring = expiresAt <= Date.now() + EXPIRY_BUFFER_MS;
    if (!isExpiring) return;

    logger.info(
      `Refreshing Claude token for agent ${agentId} profile ${oauthProfile.id}`,
      { expiresAt: new Date(expiresAt).toISOString() }
    );

    try {
      const newCredentials = await this.oauthClient.refreshToken(
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

      const updated = await updateSecretValue(
        this.redis,
        agentId,
        "CLAUDE_CODE_OAUTH_TOKEN",
        newCredentials.accessToken
      );

      logger.info(`Token refreshed for agent ${agentId} (claude)`, {
        updatedPlaceholders: updated,
      });
    } catch (error) {
      logger.error(`Failed to refresh Claude token for agent ${agentId}`, {
        error,
        profileId: oauthProfile.id,
      });
    }
  }
}
