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

export class SystemSkillsService {
  private configUrl?: string;
  private loaded?: SystemSkillsConfigFile;

  constructor(configUrl?: string) {
    this.configUrl = configUrl;
  }

  async getSystemSkills(): Promise<SkillConfig[]> {
    const config = await this.loadConfig();
    if (!config) return [];
    return config.skills.map((entry) => this.toSkillConfig(entry));
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
      return parsed;
    } catch (error) {
      logger.error("Failed to load system skills config", { error });
      return null;
    }
  }
}
