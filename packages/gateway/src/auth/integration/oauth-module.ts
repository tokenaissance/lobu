import type { IntegrationCredentialRecord } from "@lobu/core";
import { createLogger } from "@lobu/core";
import type { Context } from "hono";
import { Hono } from "hono";
import type { WorkerConnectionManager } from "../../gateway/connection-manager";
import type { IMessageQueue } from "../../infrastructure/queue";
import { GenericOAuth2Client } from "../oauth/generic-client";
import type { McpOAuthStateStore } from "../oauth/state-store";
import {
  renderOAuthErrorPage,
  renderOAuthSuccessPage,
} from "../oauth-templates";
import type { AuthSessionStore } from "../settings/session-store";
import type { IntegrationConfigService } from "./config-service";
import type { IntegrationCredentialStore } from "./credential-store";

const logger = createLogger("integration-oauth-module");

export interface ThreadContext {
  channelId: string;
  conversationId: string;
  teamId: string;
  platform: string;
}

/**
 * Session payload for integration OAuth init URLs.
 * Stored server-side in Redis via AuthSessionStore.
 */
interface IntegrationInitSession {
  userId: string;
  agentId: string;
  integrationId: string;
  requestedScopes: string[];
  accountId: string;
  threadContext?: ThreadContext;
}

/**
 * Integration OAuth Module — handles OAuth init/callback for generic integrations.
 * Uses server-side Redis sessions instead of encrypted tokens in URLs.
 */
export class IntegrationOAuthModule {
  private oauth2Client: GenericOAuth2Client;
  private app: Hono;

  constructor(
    private configService: IntegrationConfigService,
    private credentialStore: IntegrationCredentialStore,
    private stateStore: McpOAuthStateStore,
    private sessionStore: AuthSessionStore,
    _publicGatewayUrl: string,
    private callbackUrl: string,
    private queue?: IMessageQueue,
    private connectionManager?: WorkerConnectionManager
  ) {
    this.oauth2Client = new GenericOAuth2Client();
    this.app = new Hono();
    this.setupRoutes();
  }

  getApp(): Hono {
    return this.app;
  }

  setConnectionManager(connectionManager: WorkerConnectionManager): void {
    this.connectionManager = connectionManager;
  }

  /**
   * Create a server-side session for the OAuth init URL.
   * Returns an opaque session ID (no encrypted tokens in URLs).
   */
  async createInitSession(
    userId: string,
    agentId: string,
    integrationId: string,
    requestedScopes: string[],
    accountId = "default",
    threadContext?: ThreadContext
  ): Promise<string> {
    const ttlMs = 15 * 60 * 1000; // 15 minutes
    const { sessionId } = await this.sessionStore.createSession(
      {
        userId,
        platform: threadContext?.platform || "unknown",
        agentId,
      },
      ttlMs
    );

    // Store integration-specific metadata alongside the session
    const metaKey = `auth:session:meta:${sessionId}`;
    const meta: IntegrationInitSession = {
      userId,
      agentId,
      integrationId,
      requestedScopes,
      accountId,
      threadContext,
    };
    const ttlSeconds = Math.ceil(ttlMs / 1000);
    await this.sessionStore.redis.setex(
      metaKey,
      ttlSeconds,
      JSON.stringify(meta)
    );

    return sessionId;
  }

  /**
   * Retrieve and consume integration init session metadata.
   */
  private async consumeInitSession(
    sessionId: string
  ): Promise<IntegrationInitSession | null> {
    // Consume the auth session (one-time use)
    const session = await this.sessionStore.consumeSession(sessionId);
    if (!session) return null;

    // Retrieve and delete the integration metadata
    const metaKey = `auth:session:meta:${sessionId}`;
    const metaData = await this.sessionStore.redis.getdel(metaKey);
    if (!metaData) {
      logger.warn("Integration init session missing metadata", {
        sessionId: `${sessionId.substring(0, 8)}...`,
      });
      return null;
    }

    try {
      return JSON.parse(metaData) as IntegrationInitSession;
    } catch {
      logger.error("Failed to parse integration init session metadata");
      return null;
    }
  }

  private setupRoutes(): void {
    this.app.get("/init/:id", (c) => this.handleOAuthInit(c));
    this.app.get("/callback", (c) => this.handleOAuthCallback(c));
    logger.info("Integration OAuth routes configured");
  }

  /**
   * GET /api/v1/auth/integration/init/:id?s=<sessionId>
   * Validates session, builds auth URL with incremental scope support, redirects.
   */
  private async handleOAuthInit(c: Context): Promise<Response> {
    const integrationId = c.req.param("id");
    const sessionId = c.req.query("s");

    if (!sessionId) {
      return c.json({ error: "Missing session parameter" }, 400);
    }

    const initSession = await this.consumeInitSession(sessionId);
    if (!initSession) {
      return c.json({ error: "Invalid or expired session" }, 401);
    }

    if (initSession.integrationId !== integrationId) {
      return c.json({ error: "Session integrationId mismatch" }, 400);
    }

    const { userId, agentId, requestedScopes, accountId, threadContext } =
      initSession;

    try {
      const config = await this.configService.getIntegration(integrationId);
      if (!config) {
        return c.json({ error: "Integration not found" }, 404);
      }

      if (!config.oauth) {
        return c.json({ error: "Integration does not support OAuth" }, 400);
      }

      // Check if incremental auth: user already has credentials with some scopes
      let scopesForRequest = requestedScopes;
      let extraParams: Record<string, string> = {};

      if (config.oauth.incrementalAuth) {
        const existing = await this.credentialStore.getCredentials(
          agentId,
          integrationId,
          accountId
        );
        if (existing?.grantedScopes?.length) {
          const newScopes = requestedScopes.filter(
            (s) => !existing.grantedScopes.includes(s)
          );
          if (newScopes.length === 0) {
            return c.json({
              message: "All requested scopes are already granted",
            });
          }
          scopesForRequest = newScopes;
          extraParams = { include_granted_scopes: "true" };
        }
      }

      // Create state for CSRF protection
      const state = await this.stateStore.createWithNonce({
        userId,
        agentId,
        mcpId: `${integrationId}:${accountId}`,
        redirectPath: threadContext ? JSON.stringify(threadContext) : undefined,
      });

      // Build auth URL
      const authUrl = this.oauth2Client.buildAuthUrl(
        {
          authUrl: config.oauth.authUrl,
          tokenUrl: config.oauth.tokenUrl,
          clientId: config.oauth.clientId,
          clientSecret: config.oauth.clientSecret,
          scopes: scopesForRequest,
          grantType: "authorization_code",
          responseType: "code",
        },
        state,
        this.callbackUrl
      );

      // Append extra params (e.g., include_granted_scopes)
      const url = new URL(authUrl);
      for (const [key, value] of Object.entries(extraParams)) {
        url.searchParams.set(key, value);
      }

      logger.info(
        `Initiated integration OAuth for user ${userId}, agent ${agentId}, integration ${integrationId}`
      );
      return c.redirect(url.toString());
    } catch (error) {
      logger.error("Failed to init integration OAuth", {
        error,
        integrationId,
        userId,
      });
      return c.json({ error: "Failed to initialize OAuth" }, 500);
    }
  }

  /**
   * GET /api/v1/auth/integration/callback
   * Exchanges code for token, parses granted scopes, stores credentials.
   */
  private async handleOAuthCallback(c: Context): Promise<Response> {
    const code = c.req.query("code");
    const state = c.req.query("state");
    const error = c.req.query("error");
    const errorDescription = c.req.query("error_description");

    if (error) {
      logger.warn(`Integration OAuth error: ${error}`, { errorDescription });
      return c.html(renderOAuthErrorPage(error, errorDescription || ""));
    }

    if (!code || !state) {
      return c.html(
        renderOAuthErrorPage("invalid_request", "Missing code or state"),
        400
      );
    }

    try {
      // Validate and consume state
      const stateData = await this.stateStore.consume(state);
      if (!stateData) {
        return c.html(
          renderOAuthErrorPage(
            "invalid_state",
            "Invalid or expired state parameter"
          ),
          400
        );
      }

      // mcpId encodes {integrationId}:{accountId}
      const colonIdx = stateData.mcpId.indexOf(":");
      const integrationId =
        colonIdx === -1
          ? stateData.mcpId
          : stateData.mcpId.substring(0, colonIdx);
      const accountId =
        colonIdx === -1
          ? "default"
          : stateData.mcpId.substring(colonIdx + 1) || "default";
      const { agentId, userId } = stateData;

      // Recover thread context from redirectPath
      let threadContext: ThreadContext | undefined;
      if (stateData.redirectPath) {
        try {
          threadContext = JSON.parse(stateData.redirectPath) as ThreadContext;
        } catch {
          logger.warn("Failed to parse thread context from state redirectPath");
        }
      }

      const config = await this.configService.getIntegration(integrationId);
      if (!config) {
        return c.html(
          renderOAuthErrorPage(
            "integration_not_found",
            "Integration configuration not found"
          ),
          404
        );
      }

      if (!config.oauth) {
        return c.html(
          renderOAuthErrorPage(
            "invalid_integration",
            "Integration does not support OAuth"
          ),
          400
        );
      }

      // Exchange code for token
      const credentials = await this.oauth2Client.exchangeCodeForToken(
        code,
        {
          authUrl: config.oauth.authUrl,
          tokenUrl: config.oauth.tokenUrl,
          clientId: config.oauth.clientId,
          clientSecret: config.oauth.clientSecret,
          grantType: "authorization_code",
          responseType: "code",
        },
        this.callbackUrl
      );

      // Parse granted scopes from token response metadata
      const scopeString = (credentials.metadata?.scope as string) || "";
      const grantedScopes = scopeString
        ? scopeString.split(/[\s,]+/).filter(Boolean)
        : [];

      // Merge with existing scopes if incremental auth
      let finalScopes = grantedScopes;
      if (config.oauth.incrementalAuth) {
        const existing = await this.credentialStore.getCredentials(
          agentId,
          integrationId,
          accountId
        );
        if (existing?.grantedScopes?.length) {
          const merged = new Set([...existing.grantedScopes, ...grantedScopes]);
          finalScopes = [...merged];
        }
      }

      // Store credentials with scope tracking
      const record: IntegrationCredentialRecord = {
        accessToken: credentials.accessToken,
        tokenType: credentials.tokenType || "Bearer",
        expiresAt: credentials.expiresAt,
        refreshToken: credentials.refreshToken,
        grantedScopes: finalScopes,
        metadata: {
          ...credentials.metadata,
          grantedAt: new Date().toISOString(),
        },
      };

      await this.credentialStore.setCredentials(
        agentId,
        integrationId,
        record,
        accountId
      );

      logger.info(
        `Integration OAuth successful for agent ${agentId}, integration ${integrationId}, account ${accountId}, scopes: ${finalScopes.join(", ")}`
      );

      // Invalidate worker's cached session context
      this.connectionManager?.notifyAgent(agentId, "config_changed", {
        changes: [`integration:${integrationId}:${accountId}:connected`],
      });

      // Send post-auth notification to resume the agent session
      await this.sendAuthNotification(
        userId,
        agentId,
        config.label,
        integrationId,
        accountId,
        finalScopes,
        threadContext
      );

      return c.html(renderOAuthSuccessPage(config.label));
    } catch (error) {
      logger.error("Failed to handle integration OAuth callback", { error });
      return c.html(
        renderOAuthErrorPage(
          "server_error",
          "Failed to complete authentication"
        ),
        500
      );
    }
  }

  private async sendAuthNotification(
    userId: string,
    agentId: string,
    integrationLabel: string,
    integrationId: string,
    accountId: string,
    grantedScopes: string[],
    threadContext?: ThreadContext
  ): Promise<void> {
    if (!this.queue || !threadContext) {
      logger.info(
        "Skipping post-auth notification (no queue or thread context)"
      );
      return;
    }

    try {
      const scopeList =
        grantedScopes.length > 0 ? grantedScopes.join(", ") : "default";
      const accountInfo =
        accountId !== "default" ? ` (account: ${accountId})` : "";
      const messageText = `[System] User authenticated with ${integrationLabel}${accountInfo}. Granted scopes: ${scopeList}. You can now use CallService with integration "${integrationId}"${accountInfo} to make API calls.`;

      await this.queue.createQueue("messages");
      await this.queue.send("messages", {
        userId,
        conversationId: threadContext.conversationId,
        messageId: `integration_auth_${integrationId}_${accountId}_${Date.now()}`,
        channelId: threadContext.channelId,
        teamId: threadContext.teamId,
        agentId,
        botId: "system",
        platform: threadContext.platform,
        messageText,
        platformMetadata: {
          isIntegrationAuth: true,
          integrationId,
          accountId,
        },
        agentOptions: {},
      });

      logger.info(
        `Sent post-auth notification for ${integrationLabel}${accountInfo} to thread ${threadContext.conversationId}`
      );
    } catch (error) {
      logger.error("Failed to send post-auth notification", { error });
    }
  }
}
