import type { SkillIntegration, SkillMcpServer } from "@lobu/core";
import { createLogger } from "@lobu/core";
import yaml from "yaml";
import type {
  SkillContent,
  SkillRegistry,
  SkillRegistryResult,
} from "./skill-registry";

const logger = createLogger("skills-fetcher");

/**
 * ClawHub list response
 */
interface ClawHubListItem {
  slug: string;
  displayName: string;
  summary?: string | null;
  tags?: Record<string, string>;
  stats?: {
    downloads?: number;
    installsCurrent?: number;
    installsAllTime?: number;
    stars?: number;
  };
  latestVersion?: { version: string } | null;
}

interface ClawHubListResponse {
  items: ClawHubListItem[];
  nextCursor: string | null;
}

/**
 * ClawHub search response
 */
interface ClawHubSearchResult {
  score: number;
  slug: string;
  displayName: string;
  summary?: string | null;
  version?: string | null;
}

interface ClawHubSearchResponse {
  results: ClawHubSearchResult[];
}

/**
 * ClawHub skill registry adapter.
 *
 * Implements the SkillRegistry interface for the ClawHub (OpenClaw) registry.
 * Handles search, fetch, and caching of SKILL.md content.
 */
export class ClawHubRegistry implements SkillRegistry {
  id: string;
  private apiUrl: string;
  private contentCache: Map<string, { data: SkillContent; fetchedAt: number }>;
  private readonly CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

  // Cache for list results
  private listCache: {
    skills: SkillRegistryResult[];
    fetchedAt: number;
  } | null = null;
  private readonly LIST_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

  constructor(apiUrl: string, registryId = "clawhub") {
    this.apiUrl = apiUrl;
    this.id = registryId;
    this.contentCache = new Map();
  }

  /**
   * Search skills from ClawHub registry.
   */
  async search(query: string, limit = 20): Promise<SkillRegistryResult[]> {
    if (!query.trim()) {
      const allSkills = await this.fetchList();
      return allSkills.slice(0, limit);
    }

    logger.info(`Searching ClawHub for: ${query}`);

    try {
      const url = `${this.apiUrl}/search?q=${encodeURIComponent(query)}&limit=${limit}`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`ClawHub search API returned ${response.status}`);
      }

      const data = (await response.json()) as ClawHubSearchResponse;
      logger.info(`Found ${data.results.length} skills for query: ${query}`);

      return data.results.slice(0, limit).map((result) => ({
        id: result.slug,
        name: result.displayName,
        description: result.summary || undefined,
        installs: 0,
        source: this.id,
      }));
    } catch (error) {
      logger.error("Failed to search ClawHub", { error, query });
      // Fall back to client-side filtering
      const allSkills = await this.fetchList();
      const lowerQuery = query.toLowerCase().trim();
      return allSkills
        .filter(
          (skill) =>
            skill.name.toLowerCase().includes(lowerQuery) ||
            skill.id.toLowerCase().includes(lowerQuery)
        )
        .slice(0, limit);
    }
  }

  /**
   * Fetch SKILL.md content from ClawHub and parse frontmatter.
   */
  async fetch(slug: string): Promise<SkillContent> {
    // Check cache
    const cached = this.contentCache.get(slug);
    if (cached && Date.now() - cached.fetchedAt < this.CACHE_TTL_MS) {
      logger.debug(`Returning cached skill: ${slug}`);
      return cached.data;
    }

    logger.info(`Fetching skill from ClawHub: ${slug}`);

    try {
      const url = `${this.apiUrl}/skills/${encodeURIComponent(slug)}/file?path=SKILL.md`;
      const response = await fetch(url, {
        headers: { Accept: "text/plain" },
      });

      if (!response.ok) {
        throw new Error(
          `ClawHub returned ${response.status} for skill ${slug}`
        );
      }

      const content = await response.text();
      const skillContent = this.parseSkillContent(content, slug);

      // Cache result
      this.contentCache.set(slug, {
        data: skillContent,
        fetchedAt: Date.now(),
      });
      logger.info(`Cached skill: ${slug} (${skillContent.name})`);

      return skillContent;
    } catch (error) {
      logger.error(`Failed to fetch skill ${slug} from ClawHub`, { error });
      throw new Error(
        `Failed to fetch skill ${slug}: ${error instanceof Error ? error.message : "unknown error"}`
      );
    }
  }

  /**
   * Clear cached skill content.
   */
  clearCache(slug?: string): void {
    if (slug) {
      this.contentCache.delete(slug);
      logger.debug(`Cleared cache for: ${slug}`);
    } else {
      this.contentCache.clear();
      logger.debug("Cleared all skill cache");
    }
  }

  /**
   * Fetch popular skills list from ClawHub API (with caching).
   */
  private async fetchList(): Promise<SkillRegistryResult[]> {
    if (
      this.listCache &&
      Date.now() - this.listCache.fetchedAt < this.LIST_CACHE_TTL_MS
    ) {
      logger.debug(
        `Returning cached ClawHub data (${this.listCache.skills.length} skills)`
      );
      return this.listCache.skills;
    }

    logger.info("Fetching skills from ClawHub API...");

    try {
      const response = await fetch(
        `${this.apiUrl}/skills?sort=downloads&limit=50`
      );
      if (!response.ok) {
        throw new Error(`ClawHub API returned ${response.status}`);
      }

      const data = (await response.json()) as ClawHubListResponse;
      const skills: SkillRegistryResult[] = data.items.map((item) => ({
        id: item.slug,
        name: item.displayName,
        description: item.summary || undefined,
        installs: item.stats?.downloads || 0,
        source: this.id,
      }));

      logger.info(`Fetched ${skills.length} skills from ClawHub`);

      this.listCache = { skills, fetchedAt: Date.now() };
      return skills;
    } catch (error) {
      logger.error("Failed to fetch skills from ClawHub", { error });
      return [];
    }
  }

  /**
   * Parse SKILL.md content and extract YAML frontmatter using yaml parser.
   */
  private parseSkillContent(content: string, slug: string): SkillContent {
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);

    let name = slug;
    let description = "";
    let integrations: SkillIntegration[] | undefined;
    let mcpServers: SkillMcpServer[] | undefined;
    let nixPackages: string[] | undefined;
    let permissions: string[] | undefined;
    let providers: string[] | undefined;

    if (frontmatterMatch?.[1]) {
      try {
        const fm = yaml.parse(frontmatterMatch[1]) as Record<string, unknown>;

        if (typeof fm.name === "string") name = fm.name;
        if (typeof fm.description === "string") description = fm.description;

        integrations = this.parseIntegrations(fm.integrations);
        mcpServers = this.parseMcpServers(fm.mcpServers);
        nixPackages = this.parseStringList(fm.nixPackages);
        permissions = this.parseStringList(fm.permissions);
        providers = this.parseStringList(fm.providers);
      } catch (error) {
        logger.warn(`Failed to parse YAML frontmatter for ${slug}`, { error });
      }
    }

    return {
      name,
      description,
      content,
      integrations,
      mcpServers,
      nixPackages,
      permissions,
      providers,
    };
  }

  /**
   * Parse integrations field — normalizes string entries to SkillIntegration objects.
   */
  private parseIntegrations(value: unknown): SkillIntegration[] | undefined {
    if (!Array.isArray(value) || value.length === 0) return undefined;
    const result = value
      .map((entry): SkillIntegration | null => {
        if (typeof entry === "string") return { id: entry };
        if (
          typeof entry === "object" &&
          entry !== null &&
          typeof entry.id === "string"
        ) {
          const obj: SkillIntegration = { id: entry.id };
          if (typeof entry.label === "string") obj.label = entry.label;
          if (entry.authType === "oauth" || entry.authType === "api-key")
            obj.authType = entry.authType;
          if (Array.isArray(entry.scopes))
            obj.scopes = entry.scopes.filter(
              (s: unknown) => typeof s === "string"
            );
          if (Array.isArray(entry.apiDomains))
            obj.apiDomains = entry.apiDomains.filter(
              (d: unknown) => typeof d === "string"
            );
          return obj;
        }
        return null;
      })
      .filter((v): v is SkillIntegration => v !== null);
    return result.length > 0 ? result : undefined;
  }

  /**
   * Parse mcpServers field from frontmatter.
   */
  private parseMcpServers(value: unknown): SkillMcpServer[] | undefined {
    if (!Array.isArray(value) || value.length === 0) return undefined;
    return value
      .map((entry) => {
        if (
          typeof entry !== "object" ||
          entry === null ||
          typeof entry.id !== "string"
        )
          return null;
        const server: SkillMcpServer = { id: entry.id };
        if (typeof entry.name === "string") server.name = entry.name;
        if (typeof entry.url === "string") server.url = entry.url;
        if (entry.type === "sse" || entry.type === "stdio")
          server.type = entry.type;
        if (typeof entry.command === "string") server.command = entry.command;
        if (Array.isArray(entry.args))
          server.args = entry.args.filter(
            (a: unknown) => typeof a === "string"
          );
        return server;
      })
      .filter((v): v is SkillMcpServer => v !== null);
  }

  /**
   * Parse a YAML list of strings.
   */
  private parseStringList(value: unknown): string[] | undefined {
    if (!Array.isArray(value) || value.length === 0) return undefined;
    const items = value.filter((v): v is string => typeof v === "string");
    return items.length > 0 ? items : undefined;
  }
}
