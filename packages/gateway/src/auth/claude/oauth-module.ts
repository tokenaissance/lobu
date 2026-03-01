import { createLogger, decrypt } from "@lobu/core";
import type { Context } from "hono";
import type { IMessageQueue } from "../../infrastructure/queue";
import type { ModelOption } from "../../modules/module-system";
import { BaseProviderModule } from "../base-provider-module";
import { ClaudeOAuthClient } from "../oauth/claude-client";
import type { ClaudeOAuthStateStore } from "../oauth/state-store";
import {
  renderOAuthErrorPage,
  renderOAuthSuccessPage,
} from "../oauth-templates";
import {
  type AuthProfilesManager,
  createAuthProfileLabel,
} from "../settings/auth-profiles-manager";
import type { ClaudeCredentials } from "./credential-store";
import type { ClaudeModelPreferenceStore } from "./model-preference-store";

const logger = createLogger("claude-oauth-module");

/**
 * Claude OAuth Module - Handles OAuth authentication for Claude
 * Provides login/logout functionality via Slack home tab
 * Also injects user OAuth tokens and model preferences into worker deployments
 */
export class ClaudeOAuthModule extends BaseProviderModule {
  private oauthClient: ClaudeOAuthClient;
  private publicGatewayUrl: string;
  private queue: IMessageQueue;
  private modelPreferenceStore: ClaudeModelPreferenceStore;
  private stateStore: ClaudeOAuthStateStore;

  constructor(
    authProfilesManager: AuthProfilesManager,
    stateStore: ClaudeOAuthStateStore,
    modelPreferenceStore: ClaudeModelPreferenceStore,
    queue: IMessageQueue,
    publicGatewayUrl: string
  ) {
    super(
      {
        providerId: "claude",
        providerDisplayName: "Claude",
        providerIconUrl:
          "https://www.google.com/s2/favicons?domain=anthropic.com&sz=128",
        credentialEnvVarName: "CLAUDE_CODE_OAUTH_TOKEN",
        secretEnvVarNames: [
          "ANTHROPIC_API_KEY",
          "ANTHROPIC_AUTH_TOKEN",
          "CLAUDE_CODE_OAUTH_TOKEN",
        ],
        slug: "anthropic",
        upstreamBaseUrl: "https://api.anthropic.com",
        baseUrlEnvVarName: "ANTHROPIC_BASE_URL",
        authType: "oauth",
        supportedAuthTypes: ["oauth", "api-key"],
        apiKeyInstructions:
          'Enter your <a href="https://console.anthropic.com/settings/keys" target="_blank" class="text-blue-600 underline">Anthropic API key</a>:',
        apiKeyPlaceholder: "sk-ant-...",
        catalogDescription: "Anthropic's Claude AI with OAuth authentication",
      },
      authProfilesManager
    );
    // Preserve existing module name
    this.name = "claude-oauth";
    this.oauthClient = new ClaudeOAuthClient();
    this.stateStore = stateStore;
    this.modelPreferenceStore = modelPreferenceStore;
    this.queue = queue;
    this.publicGatewayUrl = publicGatewayUrl;
  }

  // ---- Overrides for multi-env-var logic ----

  override hasSystemKey(): boolean {
    return !!(
      process.env.ANTHROPIC_AUTH_TOKEN || process.env.CLAUDE_CODE_OAUTH_TOKEN
    );
  }

  override injectSystemKeyFallback(
    envVars: Record<string, string>
  ): Record<string, string> {
    if (!envVars.ANTHROPIC_API_KEY && !envVars.CLAUDE_CODE_OAUTH_TOKEN) {
      // Prefer ANTHROPIC_AUTH_TOKEN (explicit user config in .env) over
      // ANTHROPIC_API_KEY (which may be injected by Claude Code's shell env).
      const systemApiKey =
        process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY;
      const systemOAuthToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;

      if (systemApiKey) {
        envVars.ANTHROPIC_API_KEY = systemApiKey;
      } else if (systemOAuthToken) {
        envVars.CLAUDE_CODE_OAUTH_TOKEN = systemOAuthToken;
      }
    }
    return envVars;
  }

  override async buildEnvVars(
    agentId: string,
    envVars: Record<string, string>
  ): Promise<Record<string, string>> {
    const profile = await this.authProfilesManager.getBestProfile(
      agentId,
      this.providerId
    );

    if (profile?.credential) {
      logger.info(`Injecting ${profile.authType} profile for space ${agentId}`);
      if (profile.authType === "oauth") {
        envVars.CLAUDE_CODE_OAUTH_TOKEN = profile.credential;
      } else {
        envVars.ANTHROPIC_API_KEY = profile.credential;
      }
    }

    // AGENT_DEFAULT_MODEL is now delivered dynamically via session context.
    // No longer baked into static container env vars.

    return envVars;
  }

  getCliBackendConfig() {
    return {
      name: "claude-code",
      command: "npx",
      args: ["-y", "acpx@latest", "claude", "--print"],
      modelArg: "--model",
      sessionArg: "--session",
    };
  }

  async getModelOptions(
    agentId: string,
    userId: string
  ): Promise<ModelOption[]> {
    const availableModels = await this.fetchClaudeModels(agentId);
    if (availableModels.length === 0) return [];

    const preferredModel =
      await this.modelPreferenceStore.getModelPreference(userId);
    logger.debug("Building Claude model options", {
      agentId,
      userId,
      preferredModel,
    });
    const defaultModel =
      preferredModel ||
      process.env.AGENT_DEFAULT_MODEL ||
      "claude-sonnet-4-20250514";
    const options: ModelOption[] = [];
    const seen = new Set<string>();

    const addOption = (value: string, label: string) => {
      if (seen.has(value)) return;
      seen.add(value);
      options.push({ value, label });
    };

    const defaultEntry = availableModels.find((m) => m.id === defaultModel);
    if (defaultEntry) {
      addOption(defaultModel, defaultEntry.display_name || defaultModel);
    }

    for (const model of availableModels) {
      addOption(model.id, model.display_name || model.id);
    }

    return options;
  }

  /**
   * Validate and decode the secure token generated for OAuth init links
   * Returns the userId and agentId if valid, null otherwise
   */
  private validateSecureToken(
    token: string
  ): { userId: string; agentId: string } | null {
    try {
      const decrypted = decrypt(token);
      const data = JSON.parse(decrypted) as {
        userId?: string;
        agentId?: string;
        expiresAt?: number;
      };

      if (!data.userId || !data.agentId || !data.expiresAt) {
        logger.warn("Token missing required fields");
        return null;
      }

      if (Date.now() > data.expiresAt) {
        logger.warn("Token expired", {
          userId: data.userId,
          agentId: data.agentId,
        });
        return null;
      }

      return { userId: data.userId, agentId: data.agentId };
    } catch (error) {
      logger.error("Failed to validate secure token", { error });
      return null;
    }
  }

  /**
   * Setup Claude-specific OAuth routes
   */
  protected override setupRoutes(): void {
    // Initialize OAuth flow
    this.app.get("/init", (c) => this.handleOAuthInit(c));

    // OAuth callback endpoint
    this.app.get("/callback", (c) => this.handleOAuthCallback(c));

    logger.info("Claude OAuth routes configured");
  }

  /**
   * Get platform-agnostic authentication status for Claude
   * Returns abstract provider data that can be rendered by any platform adapter
   */
  async getAuthStatus(
    userId: string,
    agentId: string
  ): Promise<
    Array<{
      id: string;
      name: string;
      isAuthenticated: boolean;
      loginUrl?: string;
      logoutUrl?: string;
      metadata?: Record<string, any>;
    }>
  > {
    try {
      const hasCredentials = await this.authProfilesManager.hasProviderProfiles(
        agentId,
        this.providerId
      );
      const availableModels = await this.fetchClaudeModels(agentId);
      const currentModel =
        await this.modelPreferenceStore.getModelPreference(userId);

      const isAuthenticated = hasCredentials || this.hasSystemKey();

      // Only show login/logout if no system token (users manage their own auth)
      let loginUrl: string | undefined;
      let logoutUrl: string | undefined;

      if (!this.hasSystemKey()) {
        if (!hasCredentials) {
          // Not authenticated - provide login action
          // We use action_id pattern for Slack button actions
          loginUrl = "action:claude_auth_start";
        } else {
          // Authenticated - provide logout action
          logoutUrl = "action:claude_logout";
        }
      }

      return [
        {
          id: "claude",
          name: "Claude",
          isAuthenticated,
          loginUrl,
          logoutUrl,
          metadata: {
            availableModels,
            currentModel,
            systemTokenAvailable: this.hasSystemKey(),
          },
        },
      ];
    } catch (error) {
      logger.error("Failed to get Claude auth status", { error, userId });
      return [];
    }
  }

  /**
   * Handle home tab action (logout button, model selection, and auth modal)
   */
  async handleAction(
    actionId: string,
    userId: string,
    agentId: string,
    context: any
  ): Promise<boolean> {
    if (actionId === "claude_logout") {
      await this.authProfilesManager.deleteProviderProfiles(
        agentId,
        this.providerId
      );
      logger.info(`Space ${agentId} logged out from Claude`);

      // Update home tab
      if (context.updateAppHome) {
        await context.updateAppHome(userId, context.client);
      }

      return true;
    }

    if (actionId === "claude_select_model") {
      // Get selected model from action body
      const selectedValue = context.body?.actions?.[0]?.selected_option?.value;
      if (selectedValue) {
        await this.modelPreferenceStore.setModelPreference(
          userId,
          selectedValue
        );
        logger.info(`User ${userId} selected model: ${selectedValue}`);

        // Update home tab to reflect the change
        if (context.updateAppHome) {
          await context.updateAppHome(userId, context.client);
        }
      }

      return true;
    }

    if (actionId === "claude_auth_start") {
      // Open modal with Claude OAuth URL and auth code input
      // Generate PKCE code verifier
      const codeVerifier = this.oauthClient.generateCodeVerifier();

      // Generate OAuth state for CSRF protection and store with code verifier
      const state = await this.stateStore.create({
        userId,
        agentId,
        codeVerifier,
      });

      // Build Claude OAuth URL that redirects to console.anthropic.com callback
      const authUrl = this.oauthClient.buildAuthUrl(
        state,
        codeVerifier,
        "https://console.anthropic.com/oauth/code/callback"
      );

      // Detect context - where was the button clicked?
      // For ephemeral messages, Slack doesn't include the message object
      // We need to check the action body structure
      const body = context.body as any;

      // Check if it's from home tab (has view field) or from a message
      const isHomeTab = !!body.view;

      // For ephemeral messages in threads, the container has thread_ts
      const container = body.container;
      const message = body.message;

      let threadTs: string | undefined;

      if (container) {
        // Ephemeral message - use container.thread_ts if in a thread
        threadTs = container.thread_ts || container.message_ts;
      } else if (message) {
        // Regular message - use thread_ts or ts
        threadTs = message.thread_ts || message.ts;
      }

      const loginContext = {
        state,
        source: isHomeTab ? "home_tab" : "ephemeral_message",
        platform: "slack",
        channelId: context.channelId,
        teamId: context.teamId,
        messageTs: threadTs,
      };

      try {
        await context.client.views.open({
          trigger_id: context.body.trigger_id,
          view: {
            type: "modal",
            callback_id: "claude_auth_submit",
            private_metadata: JSON.stringify(loginContext), // Pass context through modal
            title: {
              type: "plain_text",
              text: "Login to Claude",
            },
            submit: {
              type: "plain_text",
              text: "Submit",
            },
            close: {
              type: "plain_text",
              text: "Cancel",
            },
            blocks: [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `*Step 1:* Click the link below to authorize with Claude:\n\n<${authUrl}|🔗 Login with Claude>`,
                },
              },
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: "*Step 2:* After authorizing, you'll see an authentication code.",
                },
              },
              {
                type: "input",
                block_id: "auth_code_block",
                element: {
                  type: "plain_text_input",
                  action_id: "auth_code_input",
                  placeholder: {
                    type: "plain_text",
                    text: "abc123...#xyz789...",
                  },
                },
                label: {
                  type: "plain_text",
                  text: "Authentication Code",
                },
              },
            ],
          },
        });

        logger.info(`Opened auth modal for user ${userId} with state ${state}`);
      } catch (error) {
        logger.error("Failed to open auth modal", { error, userId });
      }

      return true;
    }

    return false;
  }

  /**
   * Handle modal submission for authorization code
   */
  async handleViewSubmission(
    _viewId: string,
    userId: string,
    values: any,
    privateMetadata: string
  ): Promise<void> {
    const input = values?.auth_code_block?.auth_code_input?.value?.trim();

    if (!input) {
      logger.warn("No input provided", { userId });
      throw new Error("Authentication code is required");
    }

    // Parse the authentication code
    // Expected format: CODE#STATE (e.g., NdaqposxAuKMWyGKRfjZ9C00hg7VG3z1GI8XCMxPKSgHnz70#uwXkLAjz2C3AXHGKqZfVsHx-Syr6XuNWyRoZ1R70ikA)
    let authCode: string;
    let state: string;

    try {
      // Check if it's a URL format (for backward compatibility)
      if (input.startsWith("http://") || input.startsWith("https://")) {
        const url = new URL(input);
        authCode = url.searchParams.get("code") || "";
        state = url.hash.substring(1); // Remove the # prefix
      } else {
        // Parse CODE#STATE format
        const parts = input.split("#");
        if (parts.length !== 2) {
          throw new Error("Invalid format - expected CODE#STATE");
        }
        authCode = parts[0].trim();
        state = parts[1].trim();
      }

      if (!authCode || !state) {
        throw new Error("Missing code or state");
      }

      logger.info(`Parsed authentication code`, {
        userId,
        hasCode: !!authCode,
        hasState: !!state,
      });
    } catch (parseError) {
      logger.error("Failed to parse authentication code", {
        userId,
        input,
        error: parseError,
      });
      throw new Error(
        "Invalid format. Please paste the entire authentication code (CODE#STATE) from Claude."
      );
    }

    // Retrieve and consume the OAuth state to get code verifier
    const stateData = await this.stateStore.consume(state);
    if (!stateData) {
      logger.error("Failed to retrieve OAuth state", { userId, state });
      throw new Error("Invalid or expired authentication state");
    }

    try {
      logger.info(`Processing authorization code for user ${userId}`);

      // Exchange auth code for tokens using console.anthropic.com callback
      const credentials = await this.oauthClient.exchangeCodeForToken(
        authCode,
        stateData.codeVerifier,
        "https://console.anthropic.com/oauth/code/callback",
        state
      );

      // Store credentials using agentId for multi-tenant isolation
      await this.saveClaudeCredentials(stateData.agentId, credentials);
      logger.info(`OAuth successful for space ${stateData.agentId} via modal`);

      // Parse login context to determine where to send success message
      let loginContext: any = { source: "home_tab" };
      try {
        loginContext = JSON.parse(privateMetadata || "{}");
      } catch {
        logger.warn(`Failed to parse private metadata: ${privateMetadata}`);
      }

      // Send success message based on context
      await this.sendSuccessMessage(userId, loginContext);
    } catch (error) {
      logger.error("Failed to process auth code", { error, userId });
      throw error;
    }
  }

  /**
   * Send success message after successful authentication
   */
  private async sendSuccessMessage(
    userId: string,
    loginContext: any
  ): Promise<void> {
    const source = loginContext.source || "home_tab";
    let message: string;

    if (source === "ephemeral_message") {
      // User clicked login from ephemeral message in DM
      message =
        "✅ *Login Successful!*\n\nYou're now authenticated with Claude. Please send your message again to process it.";
    } else {
      // User clicked login from home tab
      message =
        "✅ *Login Successful!*\n\nYou're now authenticated with Claude. You can start chatting with the bot!";
    }

    // Create thread_response queue if it doesn't exist
    await this.queue.createQueue("thread_response");

    // Send ephemeral success message
    await this.queue.send("thread_response", {
      messageId: `auth_success_${Date.now()}`,
      userId,
      channelId: loginContext.channelId || userId, // Use DM channel if no channelId
      conversationId: loginContext.messageTs || "",
      platform: loginContext.platform || "slack",
      teamId: loginContext.teamId || "slack",
      ephemeral: true,
      content: message,
      processedMessageIds: [`auth_success_${Date.now()}`],
    });

    logger.info(`Sent success message to user ${userId} via ${source}`);
  }

  /**
   * Handle OAuth initialization - redirect user to Claude login
   */
  private async handleOAuthInit(c: Context): Promise<Response> {
    const token = c.req.query("token");

    if (!token) {
      return c.json({ error: "Missing token parameter" }, 400);
    }

    // Validate and decode token
    const tokenData = this.validateSecureToken(token);
    if (!tokenData) {
      return c.json({ error: "Invalid or expired token" }, 401);
    }

    const { userId, agentId } = tokenData;

    try {
      // Generate PKCE code verifier
      const codeVerifier = this.oauthClient.generateCodeVerifier();

      // Store state with code verifier and agentId
      const state = await this.stateStore.create({
        userId,
        agentId,
        codeVerifier,
      });

      // Build authorization URL
      const callbackUrl = `${this.publicGatewayUrl}/api/v1/auth/claude/callback`;
      const authUrl = this.oauthClient.buildAuthUrl(
        state,
        codeVerifier,
        callbackUrl
      );

      // Redirect to Claude OAuth
      logger.info(`Initiated OAuth for space ${agentId}`);
      return c.redirect(authUrl);
    } catch (error) {
      logger.error("Failed to init OAuth", { error, agentId });
      return c.json({ error: "Failed to initialize OAuth" }, 500);
    }
  }

  /**
   * Handle OAuth callback - exchange code for token and store credentials
   */
  private async handleOAuthCallback(c: Context): Promise<Response> {
    const code = c.req.query("code");
    const state = c.req.query("state");
    const error = c.req.query("error");
    const error_description = c.req.query("error_description");

    // Handle OAuth errors (user denied, etc.)
    if (error) {
      logger.warn(`OAuth error: ${error}`, { error_description });
      return c.html(renderOAuthErrorPage(error, error_description || ""));
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

      // Exchange code for token using PKCE
      const callbackUrl = `${this.publicGatewayUrl}/api/v1/auth/claude/callback`;
      const credentials = await this.oauthClient.exchangeCodeForToken(
        code,
        stateData.codeVerifier,
        callbackUrl
      );

      // Store credentials using agentId for multi-tenant isolation
      await this.saveClaudeCredentials(stateData.agentId, credentials);

      logger.info(`OAuth successful for space ${stateData.agentId}`);

      // Show success page
      return c.html(renderOAuthSuccessPage("Claude"));
    } catch (error) {
      logger.error("Failed to handle OAuth callback", { error });
      return c.html(
        renderOAuthErrorPage(
          "server_error",
          "Failed to complete authentication"
        ),
        500
      );
    }
  }

  async setCredentials(agentId: string, credentials: unknown): Promise<void> {
    await this.saveClaudeCredentials(agentId, credentials as ClaudeCredentials);
  }

  async deleteCredentials(agentId: string): Promise<void> {
    await this.authProfilesManager.deleteProviderProfiles(
      agentId,
      this.providerId
    );
  }

  private async saveClaudeCredentials(
    agentId: string,
    credentials: ClaudeCredentials
  ): Promise<void> {
    await this.authProfilesManager.upsertProfile({
      agentId,
      provider: this.providerId,
      credential: credentials.accessToken,
      authType: "oauth",
      label: createAuthProfileLabel(
        this.providerDisplayName,
        credentials.accessToken
      ),
      metadata: {
        refreshToken: credentials.refreshToken,
        expiresAt: credentials.expiresAt,
      },
      makePrimary: true,
    });
  }

  private static readonly FALLBACK_MODELS: Array<{
    id: string;
    display_name: string;
    type: string;
  }> = [
    {
      id: "claude-sonnet-4-20250514",
      display_name: "Claude Sonnet 4",
      type: "model",
    },
    {
      id: "claude-opus-4-20250514",
      display_name: "Claude Opus 4",
      type: "model",
    },
    {
      id: "claude-haiku-3-5-20241022",
      display_name: "Claude Haiku 3.5",
      type: "model",
    },
  ];

  private async fetchClaudeModels(
    agentId: string
  ): Promise<Array<{ id: string; display_name: string; type: string }>> {
    const profile = await this.authProfilesManager.getBestProfile(
      agentId,
      this.providerId
    );

    const oauthToken =
      profile?.authType === "oauth" ? profile.credential : undefined;
    const apiKey =
      profile?.authType !== "oauth"
        ? profile?.credential
        : process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY;

    const headers: Record<string, string> = {
      Accept: "application/json",
      "anthropic-version": "2023-06-01",
    };
    if (oauthToken) {
      headers.Authorization = `Bearer ${oauthToken}`;
    } else if (apiKey) {
      headers["x-api-key"] = apiKey;
    } else {
      return ClaudeOAuthModule.FALLBACK_MODELS;
    }

    const response = await fetch("https://api.anthropic.com/v1/models", {
      headers,
    }).catch((err) => {
      logger.warn(
        { error: err?.message, agentId },
        "fetchClaudeModels: fetch failed"
      );
      return null;
    });

    if (!response || !response.ok) {
      logger.warn(
        {
          agentId,
          status: response?.status,
          hasOauth: !!oauthToken,
          hasApiKey: !!apiKey,
        },
        "fetchClaudeModels: non-ok response, using fallback models"
      );
      return ClaudeOAuthModule.FALLBACK_MODELS;
    }

    const payload = (await response.json().catch(() => ({}))) as {
      data?: Array<{ id?: string; display_name?: string; type?: string }>;
    };

    const models = (payload.data || [])
      .map((item) => {
        const id = item.id?.trim();
        if (!id) return null;
        return {
          id,
          display_name: item.display_name || id,
          type: item.type || "model",
        };
      })
      .filter(
        (item): item is { id: string; display_name: string; type: string } =>
          Boolean(item)
      );

    return models.length > 0 ? models : ClaudeOAuthModule.FALLBACK_MODELS;
  }
}
