import { createLogger } from "@lobu/core";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Load mcp-servers.json from CLI package
const mcpServersPath = join(__dirname, "../../../cli/src/mcp-servers.json");
const mcpServersData = JSON.parse(readFileSync(mcpServersPath, "utf-8")) as {
  servers: Array<{
    id: string;
    name: string;
    description: string;
    type: string;
    config: Record<string, unknown>;
    setupInstructions?: string;
  }>;
};

const logger = createLogger("mcp-registry");

/**
 * MCP server entry from the registry
 */
export interface McpRegistryEntry {
  id: string;
  name: string;
  description: string;
  type: "oauth" | "command" | "api-key" | "none";
  config: Record<string, unknown>;
  setupInstructions?: string;
}

/**
 * Service for accessing the MCP server registry.
 *
 * Responsibilities:
 * - Load MCP server definitions from mcp-servers.json
 * - Provide search and lookup functionality
 * - Return curated list of popular MCPs for quick-add
 */
export class McpRegistryService {
  /**
   * Curated list of popular MCPs for quick-add chips in the settings UI.
   * These are MCPs that are easy to set up or don't require authentication.
   */
  static readonly CURATED_MCP_IDS = [
    "sentry", // No auth required
    "playwright", // Command-based, no auth
    "github", // OAuth - popular
    "notion", // OAuth - popular
    "linear", // OAuth - popular
  ];

  private registry: McpRegistryEntry[];

  constructor() {
    this.registry = this.loadRegistry();
    logger.info(`Loaded ${this.registry.length} MCPs from registry`);
  }

  /**
   * Load MCP server definitions from mcp-servers.json
   */
  private loadRegistry(): McpRegistryEntry[] {
    return mcpServersData.servers.map((server) => ({
      id: server.id,
      name: server.name,
      description: server.description,
      type: server.type as McpRegistryEntry["type"],
      config: server.config as Record<string, unknown>,
      setupInstructions: server.setupInstructions,
    }));
  }

  /**
   * Get curated list of popular MCPs for quick-add
   */
  getCurated(): McpRegistryEntry[] {
    return this.registry.filter((m) =>
      McpRegistryService.CURATED_MCP_IDS.includes(m.id)
    );
  }

  /**
   * Search MCPs by name, description, or ID
   * @param query - Search query (case-insensitive)
   * @param limit - Maximum number of results (default 20)
   */
  search(query: string, limit = 20): McpRegistryEntry[] {
    const q = query.toLowerCase().trim();
    if (!q) return this.registry.slice(0, limit);

    return this.registry
      .filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          m.description.toLowerCase().includes(q) ||
          m.id.toLowerCase().includes(q)
      )
      .slice(0, limit);
  }

  /**
   * Get all MCPs from the registry
   */
  getAll(): McpRegistryEntry[] {
    return this.registry;
  }

  /**
   * Get MCP by ID
   */
  getById(id: string): McpRegistryEntry | null {
    return this.registry.find((m) => m.id === id) || null;
  }
}
