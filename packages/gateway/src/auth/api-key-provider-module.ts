import {
  BaseModule,
  createLogger,
  type ModelOption,
  type ModelProviderModule,
} from "@lobu/core";
import { Hono } from "hono";
import type { AgentSettingsStore } from "./settings/agent-settings-store";
import {
  AuthProfilesManager,
  createAuthProfileLabel,
} from "./settings/auth-profiles-manager";

const logger = createLogger("api-key-provider");

export interface ApiKeyProviderConfig {
  providerId: string;
  providerDisplayName: string;
  providerIconUrl: string;
  envVarName: string;
  apiKeyInstructions: string;
  apiKeyPlaceholder: string;
  systemEnvVarName?: string;
  /** Provider slug for proxy path routing (e.g. "gemini") */
  slug?: string;
  /** Upstream base URL for proxy forwarding (e.g. "https://generativelanguage.googleapis.com") */
  upstreamBaseUrl?: string;
  /** Explicit base URL env var name (defaults to envVarName with _KEY replaced by _BASE_URL) */
  baseUrlEnvVarName?: string;
  agentSettingsStore: AgentSettingsStore;
}

/**
 * Generic API-key provider module.
 * Any model provider that only needs a "paste your API key" flow
 * can be instantiated from this class without writing a full module.
 */
export class ApiKeyProviderModule
  extends BaseModule
  implements ModelProviderModule
{
  name: string;
  providerId: string;
  providerDisplayName: string;
  providerIconUrl: string;
  authType = "api-key" as const;
  apiKeyInstructions: string;
  apiKeyPlaceholder: string;

  private envVarName: string;
  private systemEnvVarName: string;
  private slug?: string;
  private upstreamBaseUrl?: string;
  private baseUrlEnvVarName: string;
  private agentSettingsStore: AgentSettingsStore;
  private authProfilesManager: AuthProfilesManager;
  private app: Hono;

  constructor(config: ApiKeyProviderConfig) {
    super();
    this.providerId = config.providerId;
    this.name = `${config.providerId}-api-key`;
    this.providerDisplayName = config.providerDisplayName;
    this.providerIconUrl = config.providerIconUrl;
    this.envVarName = config.envVarName;
    this.systemEnvVarName = config.systemEnvVarName || config.envVarName;
    this.slug = config.slug || config.providerId;
    this.upstreamBaseUrl = config.upstreamBaseUrl;
    this.baseUrlEnvVarName =
      config.baseUrlEnvVarName ||
      config.envVarName.replace("_KEY", "_BASE_URL");
    this.apiKeyInstructions = config.apiKeyInstructions;
    this.apiKeyPlaceholder = config.apiKeyPlaceholder;
    this.agentSettingsStore = config.agentSettingsStore;
    this.authProfilesManager = new AuthProfilesManager(this.agentSettingsStore);
    this.app = new Hono();
    this.setupRoutes();
  }

  isEnabled(): boolean {
    return true;
  }

  getSecretEnvVarNames(): string[] {
    return [this.envVarName];
  }

  getCredentialEnvVarName(): string {
    return this.envVarName;
  }

  getUpstreamConfig(): { slug: string; upstreamBaseUrl: string } | null {
    if (!this.slug || !this.upstreamBaseUrl) return null;
    return { slug: this.slug, upstreamBaseUrl: this.upstreamBaseUrl };
  }

  async hasCredentials(agentId: string): Promise<boolean> {
    return this.authProfilesManager.hasProviderProfiles(
      agentId,
      this.providerId
    );
  }

  hasSystemKey(): boolean {
    return !!process.env[this.systemEnvVarName];
  }

  getProxyBaseUrlMappings(proxyUrl: string): Record<string, string> {
    if (!this.slug) return {};
    return { [this.baseUrlEnvVarName]: `${proxyUrl}/${this.slug}` };
  }

  injectSystemKeyFallback(
    envVars: Record<string, string>
  ): Record<string, string> {
    if (!envVars[this.envVarName]) {
      const systemKey = process.env[this.systemEnvVarName];
      if (systemKey) {
        envVars[this.envVarName] = systemKey;
      }
    }
    return envVars;
  }

  async buildEnvVars(
    _userId: string,
    agentId: string,
    envVars: Record<string, string>
  ): Promise<Record<string, string>> {
    if (!envVars[this.envVarName]) {
      const profile = await this.authProfilesManager.getBestProfile(
        agentId,
        this.providerId
      );
      if (profile?.credential) {
        logger.info(
          `Injecting ${this.envVarName} for agent ${agentId} (${this.providerId})`
        );
        envVars[this.envVarName] = profile.credential;
      }
    }
    return envVars;
  }

  async getModelOptions(
    agentId: string,
    _userId: string
  ): Promise<ModelOption[]> {
    const key = await this.getCredential(agentId);
    if (!key) return [];

    if (this.providerId === "gemini") {
      return this.fetchGeminiModels(key);
    }

    if (this.providerId === "nvidia") {
      return this.fetchNvidiaModels(key);
    }

    return [];
  }

  getApp(): Hono {
    return this.app;
  }

  private setupRoutes(): void {
    // Save API key
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

        logger.info(
          `${this.providerDisplayName} API key saved for agent ${agentId}`
        );
        return c.json({ success: true });
      } catch (error) {
        logger.error(`Failed to save ${this.providerDisplayName} API key`, {
          error,
        });
        return c.json({ error: "Failed to save API key" }, 500);
      }
    });

    // Remove API key (logout)
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
        logger.info(
          `${this.providerDisplayName} API key removed for agent ${agentId}`
        );

        return c.json({ success: true });
      } catch (error) {
        logger.error(`Failed to remove ${this.providerDisplayName} API key`, {
          error,
        });
        return c.json({ error: "Failed to logout" }, 500);
      }
    });

    logger.info(`${this.providerDisplayName} API key routes configured`);
  }

  registerEndpoints(_app: any): void {
    logger.info(
      `${this.providerDisplayName} API key endpoints registered via module system`
    );
  }

  private async getCredential(agentId: string): Promise<string | null> {
    const profile = await this.authProfilesManager.getBestProfile(
      agentId,
      this.providerId
    );
    if (profile?.credential) {
      return profile.credential;
    }
    return process.env[this.systemEnvVarName] || null;
  }

  private async fetchGeminiModels(apiKey: string): Promise<ModelOption[]> {
    const url = new URL(
      "https://generativelanguage.googleapis.com/v1beta/models"
    );
    url.searchParams.set("key", apiKey);

    const response = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
    }).catch(() => null);
    if (!response || !response.ok) return [];

    const payload = (await response.json().catch(() => ({}))) as {
      models?: Array<{ name?: string; displayName?: string }>;
    };

    return (payload.models || [])
      .map((model) => {
        const raw = model.name?.replace(/^models\//, "").trim();
        if (!raw) return null;
        return {
          value: `openclaw/gemini/${raw}`,
          label: model.displayName || raw,
        } satisfies ModelOption;
      })
      .filter((item): item is ModelOption => Boolean(item));
  }

  private async fetchNvidiaModels(apiKey: string): Promise<ModelOption[]> {
    const response = await fetch("https://integrate.api.nvidia.com/v1/models", {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
    }).catch(() => null);
    if (!response || !response.ok) return [];

    const payload = (await response.json().catch(() => ({}))) as {
      data?: Array<{ id?: string }>;
    };

    return (payload.data || [])
      .map((model) => {
        const id = model.id?.trim();
        if (!id) return null;
        return {
          value: `openclaw/nvidia/${id}`,
          label: id,
        } satisfies ModelOption;
      })
      .filter((item): item is ModelOption => Boolean(item));
  }
}
