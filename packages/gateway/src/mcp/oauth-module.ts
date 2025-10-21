import { BaseModule, createLogger } from "@peerbot/core";
import type { Request, Response } from "express";
import type { McpConfigService } from "./config-service";
import type { McpCredentialStore } from "./credential-store";
import type { OAuthStateStore } from "./oauth-state-store";
import { OAuth2Client } from "./oauth-client";
import type { McpInputStore } from "./input-store";

const logger = createLogger("mcp-oauth-module");

interface McpStatus {
  id: string;
  name: string;
  isAuthenticated: boolean;
  authType: "oauth" | "inputs";
  metadata?: Record<string, unknown>;
}

/**
 * MCP OAuth Module - Handles OAuth authentication for MCP servers
 * Provides login/logout functionality via Slack home tab
 */
export class McpOAuthModule extends BaseModule {
  name = "mcp-oauth";
  private oauth2Client: OAuth2Client;

  constructor(
    private configService: McpConfigService,
    private credentialStore: McpCredentialStore,
    private stateStore: OAuthStateStore,
    private inputStore: McpInputStore
  ) {
    super();
    this.oauth2Client = new OAuth2Client();
  }

  isEnabled(): boolean {
    // Always enabled if MCP config service is available
    return true;
  }

  /**
   * Register OAuth endpoints
   */
  registerEndpoints(app: any): void {
    // Initialize OAuth flow
    app.get("/mcp/oauth/init/:mcpId", async (req: Request, res: Response) => {
      await this.handleOAuthInit(req, res);
    });

    // OAuth callback endpoint
    app.get("/mcp/oauth/callback", async (req: Request, res: Response) => {
      await this.handleOAuthCallback(req, res);
    });

    // Logout endpoint
    app.post(
      "/mcp/oauth/logout/:mcpId",
      async (req: Request, res: Response) => {
        await this.handleLogout(req, res);
      }
    );

    logger.info("MCP OAuth endpoints registered");
  }

  /**
   * Render home tab with MCP connection status
   */
  async renderHomeTab(userId: string): Promise<any[]> {
    const blocks: any[] = [];

    try {
      const mcpStatuses = await this.getMcpStatuses(userId);

      if (mcpStatuses.length === 0) {
        return [];
      }

      // Header
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*🔌 MCP Connections*\n_Model Context Protocol integrations_",
        },
      });

      blocks.push({ type: "divider" });

      // Show each MCP status
      for (const mcp of mcpStatuses) {
        const mcpBlocks = this.renderMcpStatus(mcp);
        blocks.push(...mcpBlocks);
      }
    } catch (error) {
      logger.error("Failed to render MCP home tab", { error, userId });
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: "⚠️ _Failed to load MCP status_",
        },
      });
    }

    return blocks;
  }

  /**
   * Handle home tab action (login/logout/configure buttons)
   */
  async handleAction(
    actionId: string,
    userId: string,
    context: any
  ): Promise<boolean> {
    // Handle login button (OAuth)
    if (actionId.startsWith("mcp_login_")) {
      const mcpId = actionId.replace("mcp_login_", "");

      try {
        const httpServer = await this.configService.getHttpServer(mcpId);
        if (!httpServer || !httpServer.oauth) {
          logger.error(`MCP ${mcpId} not found or OAuth not configured`);
          return false;
        }

        // Generate state
        const state = await this.stateStore.create({ userId, mcpId });

        // Build OAuth URL
        const redirectUri = this.getCallbackUrl();
        const loginUrl = this.oauth2Client.buildAuthUrl(
          httpServer.oauth,
          state,
          redirectUri
        );

        // Send DM with login link
        if (context.client) {
          await context.client.chat.postMessage({
            channel: userId,
            text: `🔐 Click the link below to authenticate with ${this.formatMcpName(mcpId)}:`,
            blocks: [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `🔐 *Authenticate with ${this.formatMcpName(mcpId)}*`,
                },
              },
              {
                type: "actions",
                elements: [
                  {
                    type: "button",
                    text: {
                      type: "plain_text",
                      text: `Login to ${this.formatMcpName(mcpId)}`,
                    },
                    url: loginUrl,
                    style: "primary",
                  },
                ],
              },
            ],
          });
        }

        logger.info(`Sent OAuth link to user ${userId} for MCP ${mcpId}`);
        return true;
      } catch (error) {
        logger.error("Failed to handle login action", { error, mcpId, userId });
        return false;
      }
    }

    // Handle configure button (inputs)
    if (actionId.startsWith("mcp_configure_")) {
      const mcpId = actionId.replace("mcp_configure_", "");

      try {
        const httpServer = await this.configService.getHttpServer(mcpId);
        if (
          !httpServer ||
          !httpServer.inputs ||
          httpServer.inputs.length === 0
        ) {
          logger.error(`MCP ${mcpId} not found or has no inputs`);
          return false;
        }

        // Build modal with input fields
        const modal = this.buildInputModal(mcpId, httpServer.inputs);

        // Open modal
        if (context.client && context.body?.trigger_id) {
          await context.client.views.open({
            trigger_id: context.body.trigger_id,
            view: modal,
          });
        }

        logger.info(`Opened input modal for user ${userId}, MCP ${mcpId}`);
        return true;
      } catch (error) {
        logger.error("Failed to handle configure action", {
          error,
          mcpId,
          userId,
        });
        return false;
      }
    }

    // Handle logout/clear button
    if (actionId.startsWith("mcp_logout_")) {
      const mcpId = actionId.replace("mcp_logout_", "");

      // Delete both OAuth credentials and input values
      await this.credentialStore.delete(userId, mcpId);
      await this.inputStore.delete(userId, mcpId);

      logger.info(`User ${userId} logged out/cleared from ${mcpId}`);

      // Update home tab
      if (context.updateAppHome) {
        await context.updateAppHome(userId, context.client);
      }

      return true;
    }

    return false;
  }

  /**
   * Handle view submission (modal submitted)
   */
  async handleViewSubmission(
    _viewId: string,
    userId: string,
    values: any,
    privateMetadata: string
  ): Promise<void> {
    try {
      // Parse metadata to get mcpId
      const metadata = JSON.parse(privateMetadata);
      const mcpId = metadata.mcpId;

      if (!mcpId) {
        logger.error("No mcpId in modal metadata");
        return;
      }

      // Extract input values from modal submission
      const inputValues: Record<string, string> = {};
      for (const [blockId, block] of Object.entries(values)) {
        const actionIds = Object.keys(block as any);
        if (actionIds.length > 0 && actionIds[0]) {
          const actionId: string = actionIds[0];
          const value = (block as any)[actionId]?.value;
          if (value) {
            inputValues[blockId] = value;
          }
        }
      }

      // Store input values
      await this.inputStore.set(userId, mcpId, inputValues);
      logger.info(`Stored input values for user ${userId}, MCP ${mcpId}`);
    } catch (error) {
      logger.error("Failed to handle view submission", { error, userId });
      throw error;
    }
  }

  /**
   * Build Slack modal for collecting input values
   */
  private buildInputModal(mcpId: string, inputs: any[]): any {
    const blocks: any[] = [];

    // Add input blocks for each required input
    for (const input of inputs) {
      blocks.push({
        type: "input",
        block_id: input.id,
        label: {
          type: "plain_text",
          text: input.description || input.id,
        },
        element: {
          type: "plain_text_input",
          action_id: input.id,
          placeholder: {
            type: "plain_text",
            text: `Enter ${input.description || input.id}`,
          },
        },
      });
    }

    return {
      type: "modal",
      callback_id: `mcp_input_modal_${mcpId}`,
      private_metadata: JSON.stringify({ mcpId }),
      title: {
        type: "plain_text",
        text: `Configure ${this.formatMcpName(mcpId)}`,
      },
      submit: {
        type: "plain_text",
        text: "Save",
      },
      close: {
        type: "plain_text",
        text: "Cancel",
      },
      blocks,
    };
  }

  /**
   * Get status of all configured MCP servers for a user
   */
  private async getMcpStatuses(userId: string): Promise<McpStatus[]> {
    const httpServers = await this.configService.getAllHttpServers();
    const statuses: McpStatus[] = [];

    for (const [id, serverConfig] of httpServers) {
      // Support both OAuth and input-based authentication
      const hasOAuth = !!serverConfig.oauth;
      const hasInputs = !!(
        serverConfig.inputs && serverConfig.inputs.length > 0
      );

      if (!hasOAuth && !hasInputs) {
        continue; // Skip MCPs without authentication
      }

      let isAuthenticated = false;
      let metadata: Record<string, unknown> | undefined;

      if (hasOAuth) {
        // Check OAuth credentials
        const credentials = await this.credentialStore.get(userId, id);
        isAuthenticated = !!(
          credentials?.accessToken &&
          (!credentials.expiresAt || credentials.expiresAt > Date.now())
        );
        metadata = credentials?.metadata;
      } else if (hasInputs) {
        // Check if user has provided input values
        const inputValues = await this.inputStore.get(userId, id);
        isAuthenticated = !!inputValues;
      }

      statuses.push({
        id,
        name: this.formatMcpName(id),
        isAuthenticated,
        authType: hasOAuth ? "oauth" : "inputs",
        metadata,
      });
    }

    return statuses;
  }

  /**
   * Render blocks for a single MCP status
   */
  private renderMcpStatus(mcp: McpStatus): any[] {
    const blocks: any[] = [];

    // MCP name and status
    const statusIcon = mcp.isAuthenticated ? "✅" : "⚪";
    const statusText = mcp.isAuthenticated
      ? mcp.authType === "oauth"
        ? "Connected"
        : "Configured"
      : mcp.authType === "oauth"
        ? "Not Connected"
        : "Not Configured";

    // Determine button based on auth type
    let actionButton;
    if (mcp.isAuthenticated) {
      // Show clear/logout button
      actionButton = {
        type: "button",
        text: {
          type: "plain_text",
          text: mcp.authType === "oauth" ? "Logout" : "Clear",
        },
        style: "danger",
        action_id: `mcp_logout_${mcp.id}`,
        value: mcp.id,
      };
    } else {
      // Show login/configure button
      actionButton = {
        type: "button",
        text: {
          type: "plain_text",
          text: mcp.authType === "oauth" ? "Login" : "Configure",
        },
        style: "primary",
        action_id:
          mcp.authType === "oauth"
            ? `mcp_login_${mcp.id}`
            : `mcp_configure_${mcp.id}`,
        value: mcp.id,
      };
    }

    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${statusIcon} *${mcp.name}*\n_${statusText}_`,
      },
      accessory: actionButton,
    });

    // Show metadata if authenticated (OAuth only)
    if (mcp.isAuthenticated && mcp.authType === "oauth" && mcp.metadata) {
      const username = mcp.metadata.username || mcp.metadata.login;
      if (username) {
        blocks.push({
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `Authenticated as: *${username}*`,
            },
          ],
        });
      }
    }

    return blocks;
  }

  /**
   * Handle OAuth initialization - redirect user to MCP login
   */
  private async handleOAuthInit(req: Request, res: Response): Promise<void> {
    const { mcpId } = req.params;
    const userId = req.query.userId as string;

    if (!userId) {
      res.status(400).json({ error: "Missing userId parameter" });
      return;
    }

    if (!mcpId) {
      res.status(400).json({ error: "Missing mcpId parameter" });
      return;
    }

    try {
      // Get MCP config
      const httpServer = await this.configService.getHttpServer(mcpId);
      if (!httpServer || !httpServer.oauth) {
        res
          .status(404)
          .json({ error: "MCP not found or OAuth not configured" });
        return;
      }

      // Generate and store state
      const state = await this.stateStore.create({ userId, mcpId });

      // Build OAuth URL
      const redirectUri = this.getCallbackUrl();
      const loginUrl = this.oauth2Client.buildAuthUrl(
        httpServer.oauth,
        state,
        redirectUri
      );

      // Redirect to OAuth provider
      res.redirect(loginUrl);
      logger.info(`Initiated OAuth for user ${userId}, MCP ${mcpId}`);
    } catch (error) {
      logger.error("Failed to init OAuth", { error, mcpId, userId });
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

      // Get MCP config for token exchange
      const httpServer = await this.configService.getHttpServer(
        stateData.mcpId
      );
      if (!httpServer) {
        res
          .status(404)
          .send(this.renderErrorPage("mcp_not_found", "MCP server not found"));
        return;
      }

      // Exchange code for token
      let credentials;
      const redirectUri = this.getCallbackUrl();

      if (httpServer.oauth) {
        // Full OAuth2 token exchange
        credentials = await this.oauth2Client.exchangeCodeForToken(
          code as string,
          httpServer.oauth,
          redirectUri
        );
      } else {
        // Fallback: use code as token (for simple cases)
        logger.warn(
          `MCP ${stateData.mcpId} has no oauth config, using code as token`
        );
        credentials = {
          accessToken: code as string,
          tokenType: "Bearer",
          expiresAt: Date.now() + 3600000, // 1 hour default
          metadata: {
            grantedAt: new Date().toISOString(),
          },
        };
      }

      // Store credentials
      const ttl = credentials.expiresAt
        ? Math.floor((credentials.expiresAt - Date.now()) / 1000)
        : 3600;

      await this.credentialStore.set(
        stateData.userId,
        stateData.mcpId,
        credentials,
        ttl
      );

      logger.info(
        `OAuth successful for user ${stateData.userId}, MCP ${stateData.mcpId}`
      );

      // Show success page
      res.send(this.renderSuccessPage(stateData.mcpId));
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
    const { mcpId } = req.params;
    const userId = req.body.userId || req.query.userId;

    if (!userId) {
      res.status(400).json({ error: "Missing userId" });
      return;
    }

    try {
      await this.credentialStore.delete(userId as string, mcpId!);
      logger.info(`User ${userId} logged out from ${mcpId}`);
      res.json({ success: true });
    } catch (error) {
      logger.error("Failed to logout", { error, mcpId, userId });
      res.status(500).json({ error: "Failed to logout" });
    }
  }

  /**
   * Get OAuth callback URL
   */
  private getCallbackUrl(): string {
    const baseUrl =
      process.env.PEERBOT_PUBLIC_GATEWAY_URL || "http://localhost:8080";
    return `${baseUrl}/mcp/oauth/callback`;
  }

  /**
   * Format MCP ID into human-readable name
   */
  private formatMcpName(mcpId: string): string {
    return mcpId
      .split("-")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }

  /**
   * Render success page after OAuth
   */
  private renderSuccessPage(mcpId: string): string {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Authentication Successful</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
              display: flex;
              align-items: center;
              justify-content: center;
              height: 100vh;
              margin: 0;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            }
            .container {
              background: white;
              padding: 3rem;
              border-radius: 12px;
              text-align: center;
              box-shadow: 0 20px 60px rgba(0,0,0,0.3);
              max-width: 400px;
            }
            .success-icon {
              font-size: 4rem;
              margin-bottom: 1rem;
            }
            h1 {
              color: #2d3748;
              margin: 0 0 1rem 0;
            }
            p {
              color: #718096;
              line-height: 1.6;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="success-icon">✅</div>
            <h1>Connected!</h1>
            <p>Successfully authenticated with <strong>${this.formatMcpName(mcpId)}</strong></p>
            <p>You can now close this window and return to Slack.</p>
          </div>
        </body>
      </html>
    `;
  }

  /**
   * Render error page for OAuth failures
   */
  private renderErrorPage(error: string, description?: string): string {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Authentication Failed</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
              display: flex;
              align-items: center;
              justify-content: center;
              height: 100vh;
              margin: 0;
              background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
            }
            .container {
              background: white;
              padding: 3rem;
              border-radius: 12px;
              text-align: center;
              box-shadow: 0 20px 60px rgba(0,0,0,0.3);
              max-width: 400px;
            }
            .error-icon {
              font-size: 4rem;
              margin-bottom: 1rem;
            }
            h1 {
              color: #2d3748;
              margin: 0 0 1rem 0;
            }
            p {
              color: #718096;
              line-height: 1.6;
            }
            .error-code {
              background: #f7fafc;
              padding: 0.5rem;
              border-radius: 6px;
              font-family: monospace;
              font-size: 0.875rem;
              color: #e53e3e;
              margin-top: 1rem;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="error-icon">❌</div>
            <h1>Authentication Failed</h1>
            <p>${description || "An error occurred during authentication"}</p>
            <div class="error-code">${error}</div>
            <p style="margin-top: 2rem;">Please close this window and try again from Slack.</p>
          </div>
        </body>
      </html>
    `;
  }
}
