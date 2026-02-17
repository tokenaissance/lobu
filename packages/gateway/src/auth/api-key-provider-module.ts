import { BaseModule, createLogger, type ModelProviderModule } from "@lobu/core";
import { Hono } from "hono";
import type { AgentSettingsStore } from "./settings/agent-settings-store";

const logger = createLogger("api-key-provider");

export interface ApiKeyProviderConfig {
  providerId: string;
  providerDisplayName: string;
  providerIconUrl: string;
  envVarName: string;
  apiKeyInstructions: string;
  apiKeyPlaceholder: string;
  systemEnvVarName?: string;
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
  private agentSettingsStore: AgentSettingsStore;
  private app: Hono;

  constructor(config: ApiKeyProviderConfig) {
    super();
    this.providerId = config.providerId;
    this.name = `${config.providerId}-api-key`;
    this.providerDisplayName = config.providerDisplayName;
    this.providerIconUrl = config.providerIconUrl;
    this.envVarName = config.envVarName;
    this.systemEnvVarName = config.systemEnvVarName || config.envVarName;
    this.apiKeyInstructions = config.apiKeyInstructions;
    this.apiKeyPlaceholder = config.apiKeyPlaceholder;
    this.agentSettingsStore = config.agentSettingsStore;
    this.app = new Hono();
    this.setupRoutes();
  }

  isEnabled(): boolean {
    return true;
  }

  getSecretEnvVarNames(): string[] {
    return [];
  }

  async hasCredentials(agentId: string): Promise<boolean> {
    const settings = await this.agentSettingsStore.getSettings(agentId);
    return !!settings?.envVars?.[this.envVarName];
  }

  hasSystemKey(): boolean {
    return !!process.env[this.systemEnvVarName];
  }

  getProxyBaseUrlMappings(): Record<string, string> {
    return {};
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
      const settings = await this.agentSettingsStore.getSettings(agentId);
      const key = settings?.envVars?.[this.envVarName];
      if (key) {
        logger.info(
          `Injecting ${this.envVarName} for agent ${agentId} (${this.providerId})`
        );
        envVars[this.envVarName] = key;
      }
    }
    return envVars;
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

        const settings = await this.agentSettingsStore.getSettings(agentId);
        const existingEnvVars = settings?.envVars || {};
        await this.agentSettingsStore.updateSettings(agentId, {
          envVars: {
            ...existingEnvVars,
            [this.envVarName]: apiKey,
          },
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

        const settings = await this.agentSettingsStore.getSettings(agentId);
        if (settings?.envVars?.[this.envVarName]) {
          const { [this.envVarName]: _, ...remainingEnvVars } =
            settings.envVars;
          await this.agentSettingsStore.updateSettings(agentId, {
            envVars: remainingEnvVars,
          });
          logger.info(
            `${this.providerDisplayName} API key removed for agent ${agentId}`
          );
        }

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
}
