import { createLogger } from "@lobu/core";
import type { ClaudeCredentialStore } from "../auth/claude/credential-store";
import { ClaudeOAuthClient } from "../auth/oauth/claude-client";
import type { AgentSettingsStore } from "../auth/settings/agent-settings-store";
import { updateSecretValue } from "./secret-proxy";
import type Redis from "ioredis";

const logger = createLogger("token-refresh-job");

const REFRESH_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes
const EXPIRY_BUFFER_MS = 5 * 60 * 1000; // Refresh tokens expiring within 5 minutes

/**
 * Background job that proactively refreshes OAuth tokens before they expire.
 *
 * On each tick:
 * 1. Scans ClaudeCredentialStore for tokens expiring soon
 * 2. Refreshes via ClaudeOAuthClient
 * 3. Updates ClaudeCredentialStore with new credentials
 * 4. Syncs new access token to AgentSettingsStore.envVars
 * 5. Updates active Redis placeholder mappings so the proxy serves fresh tokens
 */
export class TokenRefreshJob {
  private timer: Timer | null = null;
  private oauthClient: ClaudeOAuthClient;
  private refreshLocks = new Map<string, Promise<void>>();

  constructor(
    private credentialStore: ClaudeCredentialStore,
    private agentSettingsStore: AgentSettingsStore,
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
    // Scan for all claude:credential:* keys
    const pattern = "claude:credential:*";
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
        const agentId = key.replace("claude:credential:", "");
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
    const credentials = await this.credentialStore.getCredentials(agentId);
    if (!credentials || !credentials.refreshToken) return;

    const isExpiring = credentials.expiresAt <= Date.now() + EXPIRY_BUFFER_MS;
    if (!isExpiring) return;

    logger.info(`Refreshing token for agent ${agentId}`, {
      expiresAt: new Date(credentials.expiresAt).toISOString(),
    });

    try {
      const newCredentials = await this.oauthClient.refreshToken(
        credentials.refreshToken
      );

      // 1. Update credential store
      await this.credentialStore.setCredentials(agentId, newCredentials);

      // 2. Sync to agent settings envVars
      const settings = await this.agentSettingsStore.getSettings(agentId);
      if (settings?.envVars) {
        settings.envVars.CLAUDE_CODE_OAUTH_TOKEN = newCredentials.accessToken;
        await this.agentSettingsStore.saveSettings(agentId, settings);
      }

      // 3. Update active placeholder mappings
      const updated = await updateSecretValue(
        this.redis,
        agentId,
        "CLAUDE_CODE_OAUTH_TOKEN",
        newCredentials.accessToken
      );

      logger.info(`Token refreshed for agent ${agentId}`, {
        updatedPlaceholders: updated,
      });
    } catch (error) {
      logger.error(`Failed to refresh token for agent ${agentId}`, { error });

      // Delete invalid credentials on refresh failure
      try {
        await this.credentialStore.deleteCredentials(agentId);
        logger.info(`Deleted invalid credentials for agent ${agentId}`);
      } catch (deleteError) {
        logger.error(`Failed to delete invalid credentials`, { deleteError });
      }
    }
  }
}
