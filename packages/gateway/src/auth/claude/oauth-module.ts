import { BaseModule, createLogger, decrypt } from "@peerbot/core";
import type { Request, Response } from "express";
import type { IMessageQueue } from "../../infrastructure/queue";
import { ClaudeOAuthClient } from "../oauth/claude-client";
import type { ClaudeCredentialStore } from "./credential-store";
import type { ClaudeModelPreferenceStore } from "./model-preference-store";
import type { ClaudeOAuthStateStore } from "./oauth-state-store";

const logger = createLogger("claude-oauth-module");

/**
 * Claude OAuth Module - Handles OAuth authentication for Claude
 * Provides login/logout functionality via Slack home tab
 * Also injects user OAuth tokens and model preferences into worker deployments
 */
export class ClaudeOAuthModule extends BaseModule {
  name = "claude-oauth";
  private oauthClient: ClaudeOAuthClient;
  private publicGatewayUrl: string;
  private systemTokenAvailable: boolean;
  private queue: IMessageQueue;

  constructor(
    private credentialStore: ClaudeCredentialStore,
    private stateStore: ClaudeOAuthStateStore,
    private modelPreferenceStore: ClaudeModelPreferenceStore,
    queue: IMessageQueue,
    publicGatewayUrl: string,
    systemTokenAvailable: boolean
  ) {
    super();

    this.oauthClient = new ClaudeOAuthClient();
    this.queue = queue;
    this.publicGatewayUrl = publicGatewayUrl;
    this.systemTokenAvailable = systemTokenAvailable;
  }

  isEnabled(): boolean {
    // Always enabled - we show model selection even with system token
    return true;
  }

  /**
   * Build environment variables for worker deployment
   * Injects user's Claude OAuth token and model preference if available
   */
  async buildEnvVars(
    userId: string,
    envVars: Record<string, string>
  ): Promise<Record<string, string>> {
    // Try to get user's credentials
    const credentials = await this.credentialStore.getCredentials(userId);

    if (credentials) {
      // User has OAuth credentials - use their token
      logger.info(`Injecting user OAuth token for ${userId}`);
      envVars.CLAUDE_CODE_OAUTH_TOKEN = credentials.accessToken;
    } else {
      logger.debug(`No user credentials for ${userId}, using system token`);
      // System token (if any) will already be in envVars from base deployment
    }

    // Inject user's model preference if set
    const modelPreference =
      await this.modelPreferenceStore.getModelPreference(userId);
    if (modelPreference) {
      logger.info(
        `Injecting model preference for ${userId}: ${modelPreference}`
      );
      envVars.AGENT_DEFAULT_MODEL = modelPreference;
    }

    return envVars;
  }

  /**
   * Validate and decode the secure token generated for OAuth init links
   * Returns the userId if valid, null otherwise
   */
  private validateSecureToken(token: string): string | null {
    try {
      const decrypted = decrypt(token);
      const data = JSON.parse(decrypted) as {
        userId?: string;
        expiresAt?: number;
      };

      if (!data.userId || !data.expiresAt) {
        logger.warn("Token missing required fields");
        return null;
      }

      if (Date.now() > data.expiresAt) {
        logger.warn("Token expired", { userId: data.userId });
        return null;
      }

      return data.userId;
    } catch (error) {
      logger.error("Failed to validate secure token", { error });
      return null;
    }
  }

  /**
   * Register OAuth endpoints
   */
  registerEndpoints(app: any): void {
    // Initialize OAuth flow
    app.get("/claude/oauth/init", async (req: Request, res: Response) => {
      await this.handleOAuthInit(req, res);
    });

    // OAuth callback endpoint
    app.get("/claude/oauth/callback", async (req: Request, res: Response) => {
      await this.handleOAuthCallback(req, res);
    });

    // Logout endpoint
    app.post("/claude/oauth/logout", async (req: Request, res: Response) => {
      await this.handleLogout(req, res);
    });

    logger.info("Claude OAuth endpoints registered");
  }

  /**
   * Render home tab with Claude authentication status and model selection
   * TODO: We need to have Slack logic implemented by the Slack mode in a modular way. Think of a better way to do it via Platform Abstraction.
   */
  async renderHomeTab(userId: string): Promise<any[]> {
    const blocks: any[] = [];

    try {
      const hasCredentials = await this.credentialStore.hasCredentials(userId);
      const availableModels =
        await this.modelPreferenceStore.getAvailableModels();
      const currentModel =
        await this.modelPreferenceStore.getModelPreference(userId);

      // Single section with model dropdown and login/logout button side by side
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*Model Selection*",
        },
      });

      if (availableModels.length === 0) {
        // No models available - show error
        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: "⚠️ _Unable to fetch available models._",
          },
        });
      } else {
        // Show model dropdown and login/logout button side by side using actions block
        const selectedModelInfo = availableModels.find(
          (m: any) => m.id === currentModel
        );

        const elements: any[] = [
          {
            type: "static_select",
            placeholder: {
              type: "plain_text",
              text: "Select a model",
            },
            action_id: "claude_select_model",
            options: availableModels.map((model: any) => ({
              text: {
                type: "plain_text",
                text: model.display_name,
              },
              value: model.id,
            })),
            initial_option:
              currentModel && selectedModelInfo
                ? {
                    text: {
                      type: "plain_text",
                      text: selectedModelInfo.display_name,
                    },
                    value: currentModel,
                  }
                : undefined,
          },
        ];

        // Add login/logout button only if no system token
        if (!this.systemTokenAvailable) {
          if (hasCredentials) {
            // Add logout button
            elements.push({
              type: "button",
              text: {
                type: "plain_text",
                text: "Logout from Claude",
              },
              style: "danger",
              action_id: "claude_logout",
              value: "logout",
            });
          } else {
            // Add login button
            elements.push({
              type: "button",
              text: {
                type: "plain_text",
                text: "Login with Claude",
              },
              style: "primary",
              action_id: "claude_auth_start",
              value: "start_auth",
            });
          }
        }

        blocks.push({
          type: "actions",
          elements: elements,
        });
      }
    } catch (error) {
      logger.error("Failed to render Claude OAuth home tab", { error, userId });
    }

    return blocks;
  }

  /**
   * Handle home tab action (logout button, model selection, and auth modal)
   */
  async handleAction(
    actionId: string,
    userId: string,
    context: any
  ): Promise<boolean> {
    if (actionId === "claude_logout") {
      await this.credentialStore.deleteCredentials(userId);
      logger.info(`User ${userId} logged out from Claude`);

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
      const state = await this.stateStore.create(userId, codeVerifier);

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
        channelId: context.channelId,
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

      // Store credentials
      await this.credentialStore.setCredentials(userId, credentials);
      logger.info(`OAuth successful for user ${userId} via modal`);

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
      threadId: loginContext.messageTs || undefined,
      ephemeral: true,
      content: message,
      processedMessageIds: [`auth_success_${Date.now()}`],
    });

    logger.info(`Sent success message to user ${userId} via ${source}`);
  }

  /**
   * Handle OAuth initialization - redirect user to Claude login
   */
  private async handleOAuthInit(req: Request, res: Response): Promise<void> {
    const token = req.query.token as string;

    if (!token) {
      res.status(400).json({ error: "Missing token parameter" });
      return;
    }

    // Validate and decode token
    const userId = this.validateSecureToken(token);
    if (!userId) {
      res.status(401).json({ error: "Invalid or expired token" });
      return;
    }

    try {
      // Generate PKCE code verifier
      const codeVerifier = this.oauthClient.generateCodeVerifier();

      // Store state with code verifier
      const state = await this.stateStore.create(userId, codeVerifier);

      // Build authorization URL
      const callbackUrl = `${this.publicGatewayUrl}/claude/oauth/callback`;
      const authUrl = this.oauthClient.buildAuthUrl(
        state,
        codeVerifier,
        callbackUrl
      );

      // Redirect to Claude OAuth
      res.redirect(authUrl);
      logger.info(`Initiated OAuth for user ${userId}`);
    } catch (error) {
      logger.error("Failed to init OAuth", { error, userId });
      res.status(500).json({ error: "Failed to initialize OAuth" });
    }
  }

  /**
   * Handle OAuth callback - exchange code for token and store credentials
   */
  private async handleOAuthCallback(
    req: Request,
    res: Response
  ): Promise<void> {
    const { code, state, error, error_description } = req.query;

    // Handle OAuth errors (user denied, etc.)
    if (error) {
      logger.warn(`OAuth error: ${error}`, { error_description });
      res.send(
        this.renderErrorPage(error as string, error_description as string)
      );
      return;
    }

    if (!code || !state) {
      res
        .status(400)
        .send(this.renderErrorPage("invalid_request", "Missing code or state"));
      return;
    }

    try {
      // Validate and consume state
      const stateData = await this.stateStore.consume(state as string);
      if (!stateData) {
        res
          .status(400)
          .send(
            this.renderErrorPage(
              "invalid_state",
              "Invalid or expired state parameter"
            )
          );
        return;
      }

      // Exchange code for token using PKCE
      const callbackUrl = `${this.publicGatewayUrl}/claude/oauth/callback`;
      const credentials = await this.oauthClient.exchangeCodeForToken(
        code as string,
        stateData.codeVerifier,
        callbackUrl
      );

      // Store credentials
      await this.credentialStore.setCredentials(stateData.userId, credentials);

      logger.info(`OAuth successful for user ${stateData.userId}`);

      // Show success page
      res.send(this.renderSuccessPage());
    } catch (error) {
      logger.error("Failed to handle OAuth callback", { error });
      res
        .status(500)
        .send(
          this.renderErrorPage(
            "server_error",
            "Failed to complete authentication"
          )
        );
    }
  }

  /**
   * Handle logout - delete credentials
   */
  private async handleLogout(req: Request, res: Response): Promise<void> {
    const userId = req.body.userId || req.query.userId;

    if (!userId) {
      res.status(400).json({ error: "Missing userId" });
      return;
    }

    try {
      await this.credentialStore.deleteCredentials(userId as string);
      logger.info(`User ${userId} logged out from Claude`);
      res.json({ success: true });
    } catch (error) {
      logger.error("Failed to logout", { error, userId });
      res.status(500).json({ error: "Failed to logout" });
    }
  }

  private renderSuccessPage(): string {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Authentication Successful</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; text-align: center; padding: 50px; }
    .success { color: #10b981; font-size: 48px; }
    h1 { color: #1f2937; }
    p { color: #6b7280; font-size: 18px; }
  </style>
</head>
<body>
  <div class="success">✓</div>
  <h1>Authentication Successful</h1>
  <p>You're all set! You can now close this window and return to Slack.</p>
</body>
</html>
    `;
  }

  private renderErrorPage(error: string, description?: string): string {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Authentication Error</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; text-align: center; padding: 50px; }
    .error { color: #ef4444; font-size: 48px; }
    h1 { color: #1f2937; }
    p { color: #6b7280; font-size: 18px; }
    .code { font-family: monospace; background: #f3f4f6; padding: 4px 8px; border-radius: 4px; }
  </style>
</head>
<body>
  <div class="error">✗</div>
  <h1>Authentication Error</h1>
  <p>Error: <span class="code">${error}</span></p>
  ${description ? `<p>${description}</p>` : ""}
  <p>Please try again or contact support if the problem persists.</p>
</body>
</html>
    `;
  }
}
