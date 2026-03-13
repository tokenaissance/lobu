import * as fs from "node:fs";
import * as path from "node:path";
import {
  createLogger,
  type SkillIntegration,
  type SkillMcpServer,
} from "@lobu/core";

const logger = createLogger("skill-registry");

const DEFAULT_CLAWHUB_API_URL = "https://wry-manatee-359.convex.site/api/v1";

/**
 * Search result returned by a skill registry
 */
export interface SkillRegistryResult {
  id: string;
  name: string;
  description?: string;
  installs?: number;
  source: string;
  integrations?: SkillIntegration[];
}

/**
 * Full skill content fetched from a registry
 */
export interface SkillContent {
  name: string;
  description: string;
  content: string;
  integrations?: SkillIntegration[];
  mcpServers?: SkillMcpServer[];
  nixPackages?: string[];
  permissions?: string[];
  providers?: string[];
}

/**
 * Registry adapter interface. Each registry type (clawhub, etc.) implements this.
 */
export interface SkillRegistry {
  id: string;
  search(query: string, limit: number): Promise<SkillRegistryResult[]>;
  fetch(id: string): Promise<SkillContent>;
}

/**
 * Config entry for a skill registry
 */
export interface RegistryConfig {
  id: string;
  type: string;
  apiUrl: string;
}

interface RegistriesConfig {
  registries: RegistryConfig[];
}

/**
 * Factory for creating registry instances from config
 */
type RegistryFactory = (config: RegistryConfig) => SkillRegistry;

/**
 * Coordinator that aggregates multiple skill registries.
 *
 * - Loads config from `config/skill-registries.json`
 * - Creates registry instances via factory
 * - Searches all registries in parallel
 * - Falls back to default ClawHub if no config
 */
export class SkillRegistryCoordinator {
  private registries: SkillRegistry[];

  constructor(registries?: SkillRegistry[]) {
    if (registries) {
      this.registries = registries;
    } else {
      this.registries = this.loadFromConfig();
    }

    logger.info(
      `Initialized with ${this.registries.length} registry(ies): ${this.registries.map((r) => r.id).join(", ")}`
    );
  }

  private loadFromConfig(): SkillRegistry[] {
    const configPath = path.resolve(
      process.cwd(),
      "config/skill-registries.json"
    );

    try {
      if (fs.existsSync(configPath)) {
        const raw = fs.readFileSync(configPath, "utf-8");
        const config = JSON.parse(raw) as RegistriesConfig;

        if (config.registries?.length) {
          // Filter out "lobu" type entries
          const filtered = config.registries.filter((e) => e.type !== "lobu");
          return filtered
            .map((entry) => this.createRegistry(entry))
            .filter(Boolean) as SkillRegistry[];
        }
      }
    } catch (error) {
      logger.warn("Failed to load skill-registries.json, using defaults", {
        error,
      });
    }

    // Fallback: default ClawHub
    logger.info("No config found, using default ClawHub registry");
    return [this.createDefaultClawHub()];
  }

  private createRegistry(config: RegistryConfig): SkillRegistry | null {
    const factory = registryFactories[config.type];
    if (!factory) {
      logger.warn(`Unknown registry type: ${config.type}, skipping`);
      return null;
    }
    return factory(config);
  }

  private createDefaultClawHub(): SkillRegistry {
    // Lazy import to avoid circular dependency
    const { ClawHubRegistry } = require("./skills-fetcher");
    return new ClawHubRegistry(DEFAULT_CLAWHUB_API_URL);
  }

  private buildExtraRegistries(extras?: RegistryConfig[]): SkillRegistry[] {
    if (!extras?.length) return [];
    return extras
      .filter((e) => e.type !== "lobu")
      .map((entry) => this.createRegistry(entry))
      .filter(Boolean) as SkillRegistry[];
  }

  /**
   * Search all registries in parallel, dedupe by id.
   * Optionally includes extra per-agent registries for this call.
   */
  async search(
    query: string,
    limit: number,
    extraRegistries?: RegistryConfig[]
  ): Promise<SkillRegistryResult[]> {
    const allRegistries = [
      ...this.registries,
      ...this.buildExtraRegistries(extraRegistries),
    ];
    const results = await Promise.all(
      allRegistries.map((r) =>
        r.search(query, limit).catch((error) => {
          logger.error(`Search failed for registry ${r.id}`, { error });
          return [] as SkillRegistryResult[];
        })
      )
    );

    // Flatten and dedupe by id
    const seen = new Set<string>();
    const merged: SkillRegistryResult[] = [];
    for (const batch of results) {
      for (const result of batch) {
        if (!seen.has(result.id)) {
          seen.add(result.id);
          merged.push(result);
        }
      }
    }

    return merged.slice(0, limit);
  }

  /**
   * Fetch skill content, trying each registry until one succeeds.
   * Optionally includes extra per-agent registries for this call.
   */
  async fetch(
    id: string,
    extraRegistries?: RegistryConfig[]
  ): Promise<SkillContent> {
    const allRegistries = [
      ...this.registries,
      ...this.buildExtraRegistries(extraRegistries),
    ];
    for (const registry of allRegistries) {
      try {
        return await registry.fetch(id);
      } catch {
        logger.debug(`Registry ${registry.id} could not fetch skill ${id}`);
      }
    }
    throw new Error(`Skill "${id}" not found in any registry`);
  }
}

/**
 * Registry of factory functions keyed by type
 */
const registryFactories: Record<string, RegistryFactory> = {
  clawhub: (config) => {
    const { ClawHubRegistry } = require("./skills-fetcher");
    return new ClawHubRegistry(config.apiUrl);
  },
};

/**
 * Register a custom registry factory for a given type.
 * Call this before creating a coordinator to add support for new registry types.
 */
export function registerRegistryFactory(
  type: string,
  factory: RegistryFactory
): void {
  registryFactories[type] = factory;
}
