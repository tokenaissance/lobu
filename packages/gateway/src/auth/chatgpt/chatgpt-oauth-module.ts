import { BaseModule, createLogger, type ModelProviderModule } from "@lobu/core";
import { Hono } from "hono";
import type { AgentSettingsStore } from "../settings/agent-settings-store";
import { ChatGPTDeviceCodeClient } from "./device-code-client";

const logger = createLogger("chatgpt-oauth-module");

/**
 * ChatGPT OAuth Module - Handles device code authentication for ChatGPT.
 * Stores the access token in AgentSettings.envVars as OPENAI_API_KEY.
 * Pi-ai's openai-codex provider picks up OPENAI_API_KEY automatically.
 */
export class ChatGPTOAuthModule
  extends BaseModule
  implements ModelProviderModule
{
  name = "chatgpt-oauth";
  providerId = "chatgpt";
  providerDisplayName = "ChatGPT";
  providerIconUrl = "https://chatgpt.com/favicon.ico";
  authType = "device-code" as const;
  private deviceCodeClient: ChatGPTDeviceCodeClient;
  private app: Hono;

  constructor(private agentSettingsStore: AgentSettingsStore) {
    super();
    this.deviceCodeClient = new ChatGPTDeviceCodeClient();
    this.app = new Hono();
    this.setupRoutes();
  }

  isEnabled(): boolean {
    return true;
  }

  // ---- ModelProviderModule methods ----

  getSecretEnvVarNames(): string[] {
    // Token lives in envVars, no special placeholder handling needed
    return [];
  }

  async hasCredentials(agentId: string): Promise<boolean> {
    const settings = await this.agentSettingsStore.getSettings(agentId);
    return !!settings?.envVars?.OPENAI_API_KEY;
  }

  hasSystemKey(): boolean {
    return !!process.env.OPENAI_API_KEY;
  }

  getProxyBaseUrlMappings(): Record<string, string> {
    // No proxy — worker talks directly to chatgpt.com
    return {};
  }

  injectSystemKeyFallback(
    envVars: Record<string, string>
  ): Record<string, string> {
    if (!envVars.OPENAI_API_KEY) {
      const systemKey = process.env.OPENAI_API_KEY;
      if (systemKey) {
        envVars.OPENAI_API_KEY = systemKey;
      }
    }
    return envVars;
  }

  /**
   * Build environment variables for worker deployment.
   * Reads OPENAI_API_KEY from agent settings envVars.
   */
  async buildEnvVars(
    _userId: string,
    agentId: string,
    envVars: Record<string, string>
  ): Promise<Record<string, string>> {
    if (!envVars.OPENAI_API_KEY) {
      const settings = await this.agentSettingsStore.getSettings(agentId);
      const token = settings?.envVars?.OPENAI_API_KEY;
      if (token) {
        logger.info(`Injecting OPENAI_API_KEY for agent ${agentId}`);
        envVars.OPENAI_API_KEY = token;
      }
    }

    return envVars;
  }

  getApp(): Hono {
    return this.app;
  }

  /**
   * Get authentication status for ChatGPT provider.
   */
  async getAuthStatus(
    _userId: string,
    agentId: string
  ): Promise<
    Array<{
      id: string;
      name: string;
      isAuthenticated: boolean;
      metadata?: Record<string, any>;
    }>
  > {
    try {
      const hasCredentials = await this.hasCredentials(agentId);
      const isAuthenticated = hasCredentials || this.hasSystemKey();

      return [
        {
          id: "chatgpt",
          name: "ChatGPT",
          isAuthenticated,
          metadata: {
            systemTokenAvailable: this.hasSystemKey(),
          },
        },
      ];
    } catch (error) {
      logger.error("Failed to get ChatGPT auth status", { error });
      return [];
    }
  }

  private setupRoutes(): void {
    // Start device code flow
    this.app.post("/start", async (c) => {
      try {
        const result = await this.deviceCodeClient.requestDeviceCode();
        return c.json({
          userCode: result.userCode,
          deviceAuthId: result.deviceAuthId,
          interval: result.interval,
          verificationUrl: "https://auth.openai.com/codex/device",
        });
      } catch (error) {
        logger.error("Failed to start device code flow", { error });
        return c.json({ error: "Failed to start device code flow" }, 500);
      }
    });

    // Poll for token
    this.app.post("/poll", async (c) => {
      try {
        const body = await c.req.json();
        const { deviceAuthId, userCode, agentId } = body;

        if (!deviceAuthId || !userCode || !agentId) {
          return c.json(
            { error: "Missing deviceAuthId, userCode, or agentId" },
            400
          );
        }

        const result = await this.deviceCodeClient.pollForToken(
          deviceAuthId,
          userCode
        );

        if (!result) {
          return c.json({ status: "pending" });
        }

        // Save token to agent settings envVars
        const settings = await this.agentSettingsStore.getSettings(agentId);
        const existingEnvVars = settings?.envVars || {};
        await this.agentSettingsStore.updateSettings(agentId, {
          envVars: {
            ...existingEnvVars,
            OPENAI_API_KEY: result.accessToken,
          },
        });

        logger.info(`ChatGPT token saved for agent ${agentId}`);

        return c.json({
          status: "success",
          accountId: result.accountId,
        });
      } catch (error) {
        logger.error("Failed to poll for token", { error });
        return c.json({ error: "Failed to poll for token" }, 500);
      }
    });

    // Logout - remove token
    this.app.post("/logout", async (c) => {
      try {
        const body = await c.req.json().catch(() => ({}));
        const agentId = body.agentId || c.req.query("agentId");

        if (!agentId) {
          return c.json({ error: "Missing agentId" }, 400);
        }

        const settings = await this.agentSettingsStore.getSettings(agentId);
        if (settings?.envVars?.OPENAI_API_KEY) {
          const { OPENAI_API_KEY: _, ...remainingEnvVars } = settings.envVars;
          await this.agentSettingsStore.updateSettings(agentId, {
            envVars: remainingEnvVars,
          });
          logger.info(`ChatGPT token removed for agent ${agentId}`);
        }

        return c.json({ success: true });
      } catch (error) {
        logger.error("Failed to logout from ChatGPT", { error });
        return c.json({ error: "Failed to logout" }, 500);
      }
    });

    logger.info("ChatGPT auth routes configured");
  }

  registerEndpoints(_app: any): void {
    logger.info("ChatGPT auth endpoints registered via module system");
  }
}
