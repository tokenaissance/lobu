import { createLogger } from "@lobu/core";
import type Redis from "ioredis";
import type { OAuth2Config } from "../mcp/config-service";
import { GenericOAuth2Client } from "../oauth/generic-client";
import { OAuthStateStore } from "../oauth/state-store";

const logger = createLogger("settings-oauth-provider");

/**
 * OAuth state data for settings authentication flow.
 */
export interface SettingsOAuthStateData {
  userId: string;
  /** The auth:session:{uuid} session ID */
  sessionId: string;
  platform: string;
}

/**
 * User info returned after OAuth token exchange.
 * The `sub` field is the unique identifier from the OAuth provider.
 */
export interface OAuthUserInfo {
  sub: string;
  email?: string;
  name?: string;
}

/**
 * Configuration for the settings page OAuth provider.
 *
 * Read from environment variables:
 * - SETTINGS_OAUTH_AUTH_URL
 * - SETTINGS_OAUTH_TOKEN_URL
 * - SETTINGS_OAUTH_CLIENT_ID
 * - SETTINGS_OAUTH_CLIENT_SECRET (supports ${env:VAR} substitution)
 * - SETTINGS_OAUTH_SCOPES (comma-separated)
 * - SETTINGS_OAUTH_USERINFO_URL (endpoint returning {sub, email?, name?})
 * - SETTINGS_OAUTH_PROVIDER_NAME (display name, e.g. "Owletto")
 */
export interface SettingsOAuthConfig {
  oauth: OAuth2Config;
  userinfoUrl: string;
  providerName: string;
}

/**
 * Provider-agnostic OAuth authentication for the settings page.
 *
 * Uses the same GenericOAuth2Client as MCP OAuth, consolidating
 * the OAuth infrastructure into a single pattern.
 */
export class SettingsOAuthProvider {
  private oauth2Client: GenericOAuth2Client;
  private stateStore: OAuthStateStore<SettingsOAuthStateData>;
  private config: SettingsOAuthConfig;
  private callbackUrl: string;

  constructor(
    redis: Redis,
    config: SettingsOAuthConfig,
    publicGatewayUrl: string
  ) {
    this.oauth2Client = new GenericOAuth2Client();
    this.stateStore = new OAuthStateStore<SettingsOAuthStateData>(
      redis,
      "settings:oauth:state",
      "settings-oauth-state"
    );
    this.config = config;
    this.callbackUrl = `${publicGatewayUrl}/settings/oauth/callback`;
  }

  /**
   * Check if a settings OAuth provider is configured via environment variables.
   */
  static fromEnv(
    redis: Redis,
    publicGatewayUrl: string
  ): SettingsOAuthProvider | null {
    const authUrl = process.env.SETTINGS_OAUTH_AUTH_URL;
    const tokenUrl = process.env.SETTINGS_OAUTH_TOKEN_URL;
    const clientId = process.env.SETTINGS_OAUTH_CLIENT_ID;
    const clientSecret = process.env.SETTINGS_OAUTH_CLIENT_SECRET;
    const userinfoUrl = process.env.SETTINGS_OAUTH_USERINFO_URL;

    if (!authUrl || !tokenUrl || !clientId || !clientSecret || !userinfoUrl) {
      return null;
    }

    const scopes = process.env.SETTINGS_OAUTH_SCOPES?.split(",").map((s) =>
      s.trim()
    );
    const providerName =
      process.env.SETTINGS_OAUTH_PROVIDER_NAME || "OAuth Provider";

    logger.info(`Settings OAuth provider configured: ${providerName}`);

    return new SettingsOAuthProvider(
      redis,
      {
        oauth: {
          authUrl,
          tokenUrl,
          clientId,
          clientSecret,
          scopes,
          grantType: "authorization_code",
          responseType: "code",
        },
        userinfoUrl,
        providerName,
      },
      publicGatewayUrl
    );
  }

  get providerName(): string {
    return this.config.providerName;
  }

  /**
   * Start the OAuth flow. Creates state and returns the auth URL.
   */
  async startAuth(
    userId: string,
    sessionId: string,
    platform: string
  ): Promise<string> {
    const state = await this.stateStore.create({
      userId,
      sessionId,
      platform,
    });

    return this.oauth2Client.buildAuthUrl(
      this.config.oauth,
      state,
      this.callbackUrl
    );
  }

  /**
   * Handle the OAuth callback. Validates state, exchanges code, fetches user info.
   */
  async handleCallback(
    code: string,
    state: string
  ): Promise<{
    stateData: SettingsOAuthStateData & { createdAt: number };
    userInfo: OAuthUserInfo;
  } | null> {
    const stateData = await this.stateStore.consume(state);
    if (!stateData) {
      logger.warn("Invalid or expired OAuth state");
      return null;
    }

    // Exchange code for token
    const credentials = await this.oauth2Client.exchangeCodeForToken(
      code,
      this.config.oauth,
      this.callbackUrl
    );

    // Fetch user info from the provider
    const userInfo = await this.fetchUserInfo(credentials.accessToken);
    if (!userInfo) {
      logger.error("Failed to fetch user info from OAuth provider");
      return null;
    }

    return { stateData, userInfo };
  }

  /**
   * Fetch user info from the OAuth provider's userinfo endpoint.
   */
  private async fetchUserInfo(
    accessToken: string
  ): Promise<OAuthUserInfo | null> {
    try {
      const response = await fetch(this.config.userinfoUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        logger.error("Userinfo endpoint returned error", {
          status: response.status,
        });
        return null;
      }

      const data = (await response.json()) as Record<string, unknown>;

      // Support common userinfo response formats:
      // Standard: { sub: "...", email: "...", name: "..." }
      // GitHub: { id: 123, login: "..." }
      // Google: { sub: "...", email: "..." }
      const sub = String(
        data.sub || data.id || data.user_id || data.login || ""
      );
      if (!sub) {
        logger.error("Userinfo response missing user identifier (sub/id)");
        return null;
      }

      return {
        sub,
        email: data.email as string | undefined,
        name: (data.name || data.display_name || data.login) as
          | string
          | undefined,
      };
    } catch (error) {
      logger.error("Failed to fetch userinfo", { error });
      return null;
    }
  }
}
