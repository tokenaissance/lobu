import {
  BaseModule,
  createLogger,
  type ModelOption,
  type ModelProviderModule,
} from "@lobu/core";
import { Hono } from "hono";
import type { AgentSettingsStore } from "../settings/agent-settings-store";
import {
  AuthProfilesManager,
  createAuthProfileLabel,
} from "../settings/auth-profiles-manager";
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
  supportedAuthTypes: ("oauth" | "device-code" | "api-key")[] = [
    "device-code",
    "api-key",
  ];
  apiKeyInstructions =
    'Enter your <a href="https://platform.openai.com/api-keys" target="_blank" class="text-slate-600 underline">OpenAI API key</a>:';
  apiKeyPlaceholder = "sk-...";
  catalogDescription = "OpenAI's ChatGPT with device code authentication";
  private deviceCodeClient: ChatGPTDeviceCodeClient;
  private app: Hono;
  private authProfilesManager: AuthProfilesManager;

  constructor(private agentSettingsStore: AgentSettingsStore) {
    super();
    this.deviceCodeClient = new ChatGPTDeviceCodeClient();
    this.authProfilesManager = new AuthProfilesManager(this.agentSettingsStore);
    this.app = new Hono();
    this.setupRoutes();
  }

  isEnabled(): boolean {
    return true;
  }

  // ---- ModelProviderModule methods ----

  getSecretEnvVarNames(): string[] {
    return ["OPENAI_API_KEY"];
  }

  getCredentialEnvVarName(): string {
    return "OPENAI_API_KEY";
  }

  getUpstreamConfig(): { slug: string; upstreamBaseUrl: string } {
    return {
      slug: "openai-codex",
      upstreamBaseUrl: "https://chatgpt.com/backend-api",
    };
  }

  async hasCredentials(agentId: string): Promise<boolean> {
    return this.authProfilesManager.hasProviderProfiles(
      agentId,
      this.providerId
    );
  }

  hasSystemKey(): boolean {
    return !!process.env.OPENAI_API_KEY;
  }

  getProxyBaseUrlMappings(proxyUrl: string): Record<string, string> {
    return { OPENAI_BASE_URL: `${proxyUrl}/openai-codex` };
  }

  getCliBackendConfig() {
    return {
      name: "codex",
      command: "npx",
      args: ["-y", "acpx@latest", "codex", "--quiet"],
      modelArg: "--model",
    };
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

  async getModelOptions(
    agentId: string,
    _userId: string
  ): Promise<ModelOption[]> {
    const token = await this.getCredential(agentId);
    if (!token) return [];

    const response = await fetch("https://chatgpt.com/backend-api/models", {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
    }).catch(() => null);

    if (!response || !response.ok) {
      return [];
    }

    const payload = (await response.json().catch(() => ({}))) as {
      models?: Array<{
        slug?: string;
        title?: string;
      }>;
    };

    return (payload.models || [])
      .map((model) => {
        const slug = model.slug?.trim();
        if (!slug) return null;
        return {
          value: `openclaw/openai-codex/${slug}`,
          label: model.title?.trim() || slug,
        } satisfies ModelOption;
      })
      .filter((item): item is ModelOption => Boolean(item));
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
      const profile = await this.authProfilesManager.getBestProfile(
        agentId,
        this.providerId
      );
      const token = profile?.credential;
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

        await this.authProfilesManager.upsertProfile({
          agentId,
          provider: this.providerId,
          credential: result.accessToken,
          authType: "device-code",
          label: createAuthProfileLabel(
            this.providerDisplayName,
            result.accessToken,
            result.accountId
          ),
          metadata: {
            accountId: result.accountId,
            refreshToken: result.refreshToken,
            expiresAt: Date.now() + result.expiresIn * 1000,
          },
          makePrimary: true,
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

    // Save API key (alternative to device code)
    this.app.post("/save-key", async (c) => {
      try {
        const body = await c.req.json();
        const { agentId, apiKey } = body;

        if (!agentId || !apiKey) {
          return c.json({ error: "Missing agentId or apiKey" }, 400);
        }

        await this.authProfilesManager.upsertProfile({
          agentId,
          provider: this.providerId,
          credential: apiKey,
          authType: "api-key",
          label: createAuthProfileLabel(this.providerDisplayName, apiKey),
          makePrimary: true,
        });

        logger.info(`ChatGPT API key saved for agent ${agentId}`);
        return c.json({ success: true });
      } catch (error) {
        logger.error("Failed to save ChatGPT API key", { error });
        return c.json({ error: "Failed to save API key" }, 500);
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

        await this.authProfilesManager.deleteProviderProfiles(
          agentId,
          this.providerId
        );
        logger.info(`ChatGPT token removed for agent ${agentId}`);

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

  private async getCredential(agentId: string): Promise<string | null> {
    const profile = await this.authProfilesManager.getBestProfile(
      agentId,
      this.providerId
    );
    if (profile?.credential) {
      return profile.credential;
    }

    return process.env.OPENAI_API_KEY || null;
  }
}
