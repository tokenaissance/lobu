import { createLogger } from "@lobu/core";
import type Redis from "ioredis";
import type { McpConfigService } from "../auth/mcp/config-service";
import type { McpCredentialStore } from "../auth/mcp/credential-store";
import type { OAuthClient } from "../auth/oauth/client";
import type { GenericOAuth2Client } from "../auth/oauth/generic-client";
import type { AuthProfilesManager } from "../auth/settings/auth-profiles-manager";

const logger = createLogger("token-refresh-job");

const REFRESH_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes
const EXPIRY_BUFFER_MS = 5 * 60 * 1000; // Refresh tokens expiring within 5 minutes

export interface RefreshableProvider {
  providerId: string;
  oauthClient: OAuthClient;
}

export interface McpRefreshDeps {
  mcpCredentialStore: McpCredentialStore;
  mcpConfigService: McpConfigService;
  oauth2Client: GenericOAuth2Client;
}

/**
 * Background job that proactively refreshes OAuth tokens before they expire.
 *
 * On each tick:
 * 1. Scans authProfiles for OAuth tokens expiring soon across all registered providers
 * 2. Refreshes via the provider's OAuth client
 * 3. Updates authProfiles with new credentials
 *
 * With stable agent markers, the proxy resolves credentials from auth profiles
 * at request time, so updating the profile is sufficient — no need to update
 * Redis placeholder mappings.
 */
export class TokenRefreshJob {
  private timer: Timer | null = null;
  private refreshLocks = new Map<string, Promise<void>>();

  constructor(
    private authProfilesManager: AuthProfilesManager,
    private redis: Redis,
    private refreshableProviders: RefreshableProvider[],
    private mcpDeps?: McpRefreshDeps
  ) {}

  /**
   * Set MCP dependencies for proactive MCP token refresh.
   * Called after MCP services are initialized (separate init phase).
   */
  setMcpDeps(deps: McpRefreshDeps): void {
    this.mcpDeps = deps;
    logger.info("MCP credential refresh enabled");
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

    // Proactively refresh MCP credentials
    if (this.mcpDeps) {
      await this.refreshMcpCredentials();
    }
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

  /**
   * Scan all MCP credentials and proactively refresh tokens expiring soon.
   * Clears stale credentials when refresh fails so the settings page
   * correctly shows "unauthenticated" and the user can re-login.
   */
  private async refreshMcpCredentials(): Promise<void> {
    const { mcpCredentialStore, mcpConfigService, oauth2Client } =
      this.mcpDeps!;

    const pattern = "mcp:credential:*";
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
        // Key format: mcp:credential:{agentId}:{mcpId}
        const parts = key.replace("mcp:credential:", "").split(":");
        if (parts.length < 2) continue;
        const agentId = parts.slice(0, -1).join(":");
        const mcpId = parts[parts.length - 1]!;

        try {
          const credentials = await mcpCredentialStore.getCredentials(
            agentId,
            mcpId
          );
          if (!credentials?.accessToken) continue;

          // Skip if not expiring soon
          if (
            !credentials.expiresAt ||
            credentials.expiresAt > Date.now() + EXPIRY_BUFFER_MS
          ) {
            continue;
          }

          // No refresh token — clear stale credentials
          if (!credentials.refreshToken) {
            if (credentials.expiresAt <= Date.now()) {
              await mcpCredentialStore.deleteCredentials(agentId, mcpId);
              logger.info(
                `Cleared expired MCP credentials (no refresh token)`,
                { agentId, mcpId }
              );
            }
            continue;
          }

          logger.info(`Proactively refreshing MCP token`, { agentId, mcpId });

          // Resolve OAuth config
          const httpServer = await mcpConfigService.getHttpServer(
            mcpId,
            agentId
          );
          let oauthConfig = httpServer?.oauth;

          if (!oauthConfig) {
            const discoveredOAuth =
              await mcpConfigService.getDiscoveredOAuth(mcpId);
            if (discoveredOAuth?.metadata) {
              const discoveryService = mcpConfigService.getDiscoveryService();
              const clientCreds =
                await discoveryService?.getOrCreateClientCredentials(
                  mcpId,
                  discoveredOAuth.metadata
                );
              if (clientCreds?.client_id) {
                oauthConfig = {
                  authUrl: discoveredOAuth.metadata.authorization_endpoint,
                  tokenUrl: discoveredOAuth.metadata.token_endpoint,
                  clientId: clientCreds.client_id,
                  clientSecret: clientCreds.client_secret || "",
                  scopes: discoveredOAuth.metadata.scopes_supported || [],
                  grantType: "authorization_code",
                  responseType: "code",
                  tokenEndpointAuthMethod:
                    clientCreds.token_endpoint_auth_method,
                };
              }
            }
          }

          if (!oauthConfig) {
            logger.debug(`No OAuth config for MCP ${mcpId}, skipping refresh`);
            continue;
          }

          const refreshed = await oauth2Client.refreshToken(
            credentials.refreshToken,
            oauthConfig
          );
          await mcpCredentialStore.setCredentials(agentId, mcpId, refreshed);
          logger.info(`Proactively refreshed MCP token`, { agentId, mcpId });
        } catch (error) {
          // Refresh failed — clear stale credentials so status is accurate
          await mcpCredentialStore.deleteCredentials(agentId, mcpId);
          logger.warn(
            `MCP token proactive refresh failed, cleared stale credentials`,
            {
              agentId,
              mcpId,
              error: error instanceof Error ? error.message : String(error),
            }
          );
        }
      }
    } while (cursor !== "0");
  }
}
