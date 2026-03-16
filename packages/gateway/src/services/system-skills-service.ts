import { readFile } from "node:fs/promises";
import type {
  IntegrationConfig,
  ProviderConfigEntry,
  SkillConfig,
  SystemSkillEntry,
  SystemSkillsConfigFile,
} from "@lobu/core";
import { createLogger } from "@lobu/core";

const logger = createLogger("system-skills-service");

export interface RuntimeSystemSkill {
  id: string;
  repo: string;
  name: string;
  description?: string;
  content: string;
}

export class SystemSkillsService {
  private configUrl?: string;
  private loaded?: SystemSkillsConfigFile;
  private rawLoaded?: SystemSkillsConfigFile;

  constructor(configUrl?: string) {
    this.configUrl = configUrl;
  }

  async getSystemSkills(): Promise<SkillConfig[]> {
    const config = await this.loadConfig();
    if (!config) return [];
    return config.skills.map((entry) => this.toSkillConfig(entry));
  }

  /**
   * Returns only skills that are discoverable via SearchSkills.
   * Filters out entries with `hidden: true` (e.g. Owletto which is embedded).
   */
  async getSearchableSkills(): Promise<SkillConfig[]> {
    const config = await this.loadConfig();
    if (!config) return [];
    return config.skills
      .filter((entry) => !entry.hidden)
      .map((entry) => this.toSkillConfig(entry));
  }

  /**
   * Returns skills with original ${env:*} patterns intact (not substituted).
   * Used by the admin env catalog to discover which env vars are referenced.
   */
  async getRawSystemSkills(): Promise<SkillConfig[]> {
    await this.loadConfig();
    if (!this.rawLoaded) return [];
    return this.rawLoaded.skills.map((entry) => this.toSkillConfig(entry));
  }

  async getAllIntegrationConfigs(): Promise<Record<string, IntegrationConfig>> {
    const config = await this.loadConfig();
    if (!config) return {};
    const result: Record<string, IntegrationConfig> = {};
    for (const skill of config.skills) {
      if (!skill.integrations) continue;
      for (const ig of skill.integrations) {
        result[ig.id] = {
          label: ig.label,
          authType: ig.authType || "oauth",
          oauth: ig.oauth,
          scopes: ig.scopesConfig,
          apiDomains: ig.apiDomains || [],
        };
      }
    }
    return result;
  }

  async getProviderConfigs(): Promise<Record<string, ProviderConfigEntry>> {
    const config = await this.loadConfig();
    if (!config) return {};
    const result: Record<string, ProviderConfigEntry> = {};
    for (const skill of config.skills) {
      if (!skill.providers) continue;
      for (const provider of skill.providers) {
        result[skill.id] = provider;
      }
    }
    return result;
  }

  async getRuntimeSystemSkills(): Promise<RuntimeSystemSkill[]> {
    const config = await this.loadConfig();
    if (!config) return [];
    return config.skills.map((entry) => this.toRuntimeSystemSkill(entry));
  }

  private toSkillConfig(entry: SystemSkillEntry): SkillConfig {
    return {
      repo: `system/${entry.id}`,
      name: entry.name,
      description: entry.description,
      enabled: true,
      system: true,
      integrations: entry.integrations?.map((ig) => ({
        id: ig.id,
        label: ig.label,
        authType: ig.authType || "oauth",
        oauth: ig.oauth,
        scopesConfig: ig.scopesConfig,
        scopes: ig.scopes,
        apiDomains: ig.apiDomains,
      })),
      mcpServers: entry.mcpServers,
      nixPackages: entry.nixPackages,
      permissions: entry.permissions,
    };
  }

  private toRuntimeSystemSkill(entry: SystemSkillEntry): RuntimeSystemSkill {
    const repo = `system/${entry.id}`;
    const lines: string[] = [
      `# ${entry.name}`,
      "",
      `System skill ID: \`${repo}\``,
    ];

    if (entry.description?.trim()) {
      lines.push("", entry.description.trim());
    }

    if (entry.integrations?.length) {
      lines.push("", "## Integrations");
      for (const integration of entry.integrations) {
        const scopeInfo = integration.scopesConfig?.available?.length
          ? ` (scopes: ${integration.scopesConfig.available.join(", ")})`
          : "";
        lines.push(
          `- ${integration.label} (\`${integration.id}\`, auth: ${integration.authType || "oauth"})${scopeInfo}`
        );
        if (integration.apiBase) {
          lines.push(`  - API base: \`${integration.apiBase}\``);
        }
        if (integration.apiHints) {
          lines.push(`  - API hints: ${integration.apiHints}`);
        }
      }
    }

    if (entry.mcpServers?.length) {
      lines.push("", "## MCP Servers");
      for (const mcp of entry.mcpServers) {
        const endpoint = mcp.url || mcp.command || "n/a";
        lines.push(`- ${mcp.name || mcp.id} (\`${mcp.id}\`): ${endpoint}`);
      }
    }

    if (entry.permissions?.length) {
      lines.push(
        "",
        "## Network Permissions",
        `- ${entry.permissions.join(", ")}`
      );
    }

    if (entry.nixPackages?.length) {
      lines.push("", "## Nix Packages", `- ${entry.nixPackages.join(", ")}`);
    }

    lines.push(
      "",
      "## Usage",
      "- Use `CallService` for these integrations.",
      "- If auth is needed, use `ConnectService` first."
    );

    return {
      id: entry.id,
      repo,
      name: entry.name,
      description: entry.description,
      content: lines.join("\n"),
    };
  }

  /**
   * Clear cached config and optionally set a new URL.
   * Next call to getSystemSkills() etc. will re-fetch.
   */
  reload(newUrl?: string): void {
    this.loaded = undefined;
    this.rawLoaded = undefined;
    if (newUrl !== undefined) {
      this.configUrl = newUrl;
    }
  }

  private async loadConfig(): Promise<SystemSkillsConfigFile | null> {
    if (this.loaded) return this.loaded;
    if (!this.configUrl) return null;
    try {
      let raw: string;
      if (
        this.configUrl.startsWith("http://") ||
        this.configUrl.startsWith("https://")
      ) {
        const response = await fetch(this.configUrl);
        if (!response.ok) {
          logger.error(
            `Failed to fetch system skills config: ${response.status}`
          );
          return null;
        }
        raw = await response.text();
      } else {
        raw = await readFile(this.configUrl, "utf-8");
      }
      this.rawLoaded = JSON.parse(raw) as SystemSkillsConfigFile;
      const substituted = raw.replace(
        /\$\{env:([^}]+)\}/g,
        (_match, varName) => process.env[varName] || ""
      );
      const parsed = JSON.parse(substituted) as SystemSkillsConfigFile;
      if (!Array.isArray(parsed.skills)) {
        logger.error("Invalid system skills config: missing 'skills' array");
        return null;
      }
      this.loaded = parsed;
      logger.info(`Loaded ${parsed.skills.length} system skill(s)`);

      // Log integrations that need per-agent OAuth credentials
      const needsCreds: string[] = [];
      for (const skill of parsed.skills) {
        for (const ig of skill.integrations || []) {
          if (ig.oauth && (!ig.oauth.clientId || !ig.oauth.clientSecret)) {
            needsCreds.push(ig.id);
          }
        }
      }
      if (needsCreds.length > 0) {
        logger.info(
          `Integrations requiring per-agent OAuth credentials: ${needsCreds.join(", ")}`
        );
      }
      return parsed;
    } catch (error) {
      logger.error("Failed to load system skills config", { error });
      return null;
    }
  }
}
