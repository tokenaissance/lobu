/**
 * Resolves system config from system-skills.json.
 * Handles provider configs and MCP server resolution.
 *
 * NOTE: Integration OAuth config resolution (getIntegrationConfig, isOAuthConfigured,
 * overlayAgentOAuthCredentials, getSkillScopesForIntegration) has been removed.
 * OAuth for third-party APIs is now handled by Owletto.
 */
import type { ProviderConfigEntry } from "@lobu/core";
import type { SystemSkillsService } from "./system-skills-service";

export interface ResolvedMcpRegistryServer {
  id: string;
  name: string;
  description: string;
  type: "oauth" | "command" | "api-key" | "none";
  config: Record<string, unknown>;
}

export class SystemConfigResolver {
  constructor(private readonly systemSkillsService: SystemSkillsService) {}

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
        if (mcp.oauth) config.oauth = mcp.oauth;
        if (mcp.resource) config.resource = mcp.resource;
        if (mcp.inputs) config.inputs = mcp.inputs;
        if (mcp.headers) config.headers = mcp.headers;

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
}
