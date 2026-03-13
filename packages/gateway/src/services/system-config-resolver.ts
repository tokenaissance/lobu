import type { IntegrationConfig, ProviderConfigEntry } from "@lobu/core";
import { normalizeSkillIntegration } from "@lobu/core";
import type { AgentSettingsStore } from "../auth/settings/agent-settings-store";
import type { SystemSkillsService } from "./system-skills-service";

export interface ResolvedMcpRegistryServer {
  id: string;
  name: string;
  description: string;
  type: "oauth" | "command" | "api-key" | "none";
  config: Record<string, unknown>;
}

export class SystemConfigResolver {
  constructor(
    private readonly systemSkillsService: SystemSkillsService,
    private readonly agentSettingsStore?: AgentSettingsStore
  ) {}

  async getIntegrationConfigs(): Promise<Record<string, IntegrationConfig>> {
    const configs = await this.systemSkillsService.getAllIntegrationConfigs();
    const resolved: Record<string, IntegrationConfig> = {};

    for (const [id, config] of Object.entries(configs)) {
      resolved[id] = {
        ...config,
        authType: config.authType || "oauth",
        scopes: config.scopes
          ? {
              default: [...(config.scopes.default || [])],
              available: [...(config.scopes.available || [])],
            }
          : undefined,
        apiDomains: [...(config.apiDomains || [])],
      };
    }

    return resolved;
  }

  async getIntegrationConfig(
    id: string,
    agentId?: string
  ): Promise<IntegrationConfig | null> {
    const all = await this.getIntegrationConfigs();
    let config = all[id] ?? null;
    if (!config || !agentId) return config;

    // Overlay per-agent OAuth app credentials
    config = await this.overlayAgentOAuthCredentials(config, id, agentId);

    const skillScopes = await this.getSkillScopesForIntegration(agentId, id);
    if (
      skillScopes.scopes.length === 0 &&
      skillScopes.apiDomains.length === 0
    ) {
      return config;
    }

    return this.mergeIntegrationWithSkillScopes(config, skillScopes);
  }

  /**
   * Check if an OAuth integration has credentials configured for the given agent.
   */
  async isOAuthConfigured(id: string, agentId: string): Promise<boolean> {
    const config = await this.getIntegrationConfig(id, agentId);
    if (!config?.oauth) return true; // Non-OAuth integrations are always "configured"
    return !!config.oauth.clientId && !!config.oauth.clientSecret;
  }

  private async overlayAgentOAuthCredentials(
    config: IntegrationConfig,
    integrationId: string,
    agentId: string
  ): Promise<IntegrationConfig> {
    if (!config.oauth || !this.agentSettingsStore) return config;
    // If the template already has credentials (e.g. from env substitution), use them
    if (config.oauth.clientId && config.oauth.clientSecret) return config;

    const settings = await this.agentSettingsStore.getSettings(agentId);
    const agentCreds = settings?.oauthAppCredentials?.[integrationId];
    if (!agentCreds) return config;

    return {
      ...config,
      oauth: {
        ...config.oauth,
        clientId: agentCreds.clientId,
        clientSecret: agentCreds.clientSecret,
      },
    };
  }

  async getSkillScopesForIntegration(
    agentId: string,
    integrationId: string
  ): Promise<{ scopes: string[]; apiDomains: string[] }> {
    if (!this.agentSettingsStore) return { scopes: [], apiDomains: [] };

    const settings = await this.agentSettingsStore.getSettings(agentId);
    if (!settings?.skillsConfig?.skills) return { scopes: [], apiDomains: [] };

    const allScopes = new Set<string>();
    const allDomains = new Set<string>();

    for (const skill of settings.skillsConfig.skills) {
      if (!skill.enabled || !skill.integrations) continue;
      for (const raw of skill.integrations) {
        const integration = normalizeSkillIntegration(raw);
        if (integration.id !== integrationId) continue;
        for (const scope of integration.scopes || []) {
          allScopes.add(scope);
        }
        for (const domain of integration.apiDomains || []) {
          allDomains.add(domain);
        }
      }
    }

    return {
      scopes: [...allScopes],
      apiDomains: [...allDomains],
    };
  }

  async getProviderConfigs(): Promise<Record<string, ProviderConfigEntry>> {
    return this.systemSkillsService.getProviderConfigs();
  }

  async getGlobalMcpServers(): Promise<
    Record<string, Record<string, unknown>>
  > {
    const systemSkills = await this.systemSkillsService.getSystemSkills();
    const mcpServers: Record<string, Record<string, unknown>> = {};

    for (const skill of systemSkills) {
      for (const mcp of skill.mcpServers || []) {
        if (!mcp?.id || mcpServers[mcp.id]) continue;

        const type = mcp.type || (mcp.command ? "stdio" : "sse");
        const config: Record<string, unknown> = { type };

        if (mcp.url) config.url = mcp.url;
        if (mcp.command) config.command = mcp.command;
        if (Array.isArray(mcp.args) && mcp.args.length > 0) {
          config.args = [...mcp.args];
        }

        mcpServers[mcp.id] = config;
      }
    }

    return mcpServers;
  }

  async getMcpRegistryServers(): Promise<ResolvedMcpRegistryServer[]> {
    const systemSkills = await this.systemSkillsService.getSystemSkills();
    const entries: ResolvedMcpRegistryServer[] = [];
    const seenIds = new Set<string>();

    for (const skill of systemSkills) {
      for (const mcp of skill.mcpServers || []) {
        if (!mcp?.id || seenIds.has(mcp.id)) continue;
        seenIds.add(mcp.id);

        const type = mcp.command ? "command" : "none";
        const config: Record<string, unknown> = {
          type: mcp.type || (mcp.command ? "stdio" : "sse"),
        };

        if (mcp.url) config.url = mcp.url;
        if (mcp.command) config.command = mcp.command;
        if (Array.isArray(mcp.args) && mcp.args.length > 0) {
          config.args = [...mcp.args];
        }

        entries.push({
          id: mcp.id,
          name: mcp.name || mcp.id,
          description: skill.description || `${skill.name} MCP server`,
          type,
          config,
        });
      }
    }

    return entries;
  }

  private mergeIntegrationWithSkillScopes(
    config: IntegrationConfig,
    skillScopes: { scopes: string[]; apiDomains: string[] }
  ): IntegrationConfig {
    const merged: IntegrationConfig = {
      ...config,
      scopes: config.scopes
        ? {
            default: [...(config.scopes.default || [])],
            available: [...(config.scopes.available || [])],
          }
        : undefined,
      apiDomains: [...(config.apiDomains || [])],
    };

    if (skillScopes.scopes.length > 0 && merged.scopes) {
      const existingScopes = new Set(merged.scopes.default || []);
      const addedScopes = skillScopes.scopes.filter(
        (scope) => !existingScopes.has(scope)
      );
      if (addedScopes.length > 0) {
        merged.scopes = {
          ...merged.scopes,
          default: [...merged.scopes.default, ...addedScopes],
        };
      }
    } else if (skillScopes.scopes.length > 0) {
      merged.scopes = {
        default: skillScopes.scopes,
        available: skillScopes.scopes,
      };
    }

    if (skillScopes.apiDomains.length > 0) {
      const existingDomains = new Set(merged.apiDomains || []);
      const addedDomains = skillScopes.apiDomains.filter(
        (domain) => !existingDomains.has(domain)
      );
      if (addedDomains.length > 0) {
        merged.apiDomains = [...(merged.apiDomains || []), ...addedDomains];
      }
    }

    return merged;
  }
}
