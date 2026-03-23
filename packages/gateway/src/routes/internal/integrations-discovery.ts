/**
 * Internal Integrations Discovery Routes
 *
 * Single search endpoint for workers to discover both skills and MCP servers.
 * Resolve endpoint for fetching full manifest of either type by ID.
 * Installed endpoint for listing agent's active capabilities.
 * Install endpoint for auto-enabling system skills.
 *
 * NOTE: OAuth integration configs have moved to Owletto. Skills no longer
 * declare `integrations` with OAuth/scopes/apiDomains. Auth for third-party
 * APIs is handled by Owletto MCP tools at use time.
 */

import { createLogger, type SkillConfig, verifyWorkerToken } from "@lobu/core";
import { Hono } from "hono";
import type { AgentSettingsStore } from "../../auth/settings/agent-settings-store";
import type { GrantStore } from "../../permissions/grant-store";
import { McpDiscoveryService } from "../../services/mcp-discovery";
import type {
  SkillContent,
  SkillRegistryCoordinator,
} from "../../services/skill-registry";
import type { SystemConfigResolver } from "../../services/system-config-resolver";

const logger = createLogger("internal-integrations-discovery");

type WorkerContext = {
  Variables: {
    worker: {
      userId: string;
      agentId?: string;
      deploymentName: string;
    };
  };
};

export interface IntegrationsDiscoveryConfig {
  coordinator: SkillRegistryCoordinator;
  mcpDiscovery?: McpDiscoveryService;
  agentSettingsStore?: AgentSettingsStore;
  systemConfigResolver?: SystemConfigResolver;
  grantStore?: GrantStore;
}

export function createIntegrationsDiscoveryRoutes(
  coordinatorOrConfig: SkillRegistryCoordinator | IntegrationsDiscoveryConfig,
  mcpDiscoveryArg?: McpDiscoveryService
): Hono<WorkerContext> {
  // Support both old signature (coordinator, mcpDiscovery) and new config object
  const config: IntegrationsDiscoveryConfig =
    "coordinator" in coordinatorOrConfig
      ? coordinatorOrConfig
      : { coordinator: coordinatorOrConfig, mcpDiscovery: mcpDiscoveryArg };

  const coordinator = config.coordinator;
  const mcpDiscovery =
    config.mcpDiscovery ?? mcpDiscoveryArg ?? new McpDiscoveryService();

  const router = new Hono<WorkerContext>();

  const authenticateWorker = async (
    c: any,
    next: () => Promise<void>
  ): Promise<Response | undefined> => {
    const authHeader = c.req.header("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return c.json({ error: "Missing or invalid authorization" }, 401);
    }
    const workerToken = authHeader.substring(7);
    const tokenData = verifyWorkerToken(workerToken);
    if (!tokenData) {
      return c.json({ error: "Invalid worker token" }, 401);
    }
    c.set("worker", tokenData);
    await next();
  };

  // Unified search: returns both skills and MCPs
  router.get("/internal/integrations/search", authenticateWorker, async (c) => {
    const query = (c.req.query("q") || "").trim();
    if (!query) {
      return c.json({ skills: [], mcps: [] });
    }

    const requestedLimit = parseInt(c.req.query("limit") || "5", 10);
    const limit = Number.isFinite(requestedLimit)
      ? Math.max(1, Math.min(requestedLimit, 10))
      : 5;

    // Get per-agent registries if available
    const worker = c.get("worker");
    const searchAgentId = worker.agentId || worker.userId;
    let extraRegistries;
    if (config.agentSettingsStore) {
      const settings =
        await config.agentSettingsStore.getSettings(searchAgentId);
      extraRegistries = settings?.skillRegistries;
    }

    const [searchResults, mcps] = await Promise.all([
      coordinator.search(query, limit, extraRegistries),
      mcpDiscovery.search(query, limit),
    ]);

    // Fetch full content for each skill in parallel (cached by registry)
    const skills = await Promise.all(
      searchResults.map(async (result) => {
        try {
          const content = await coordinator.fetch(result.id);
          return {
            id: result.id,
            name: content.name,
            description: content.description,
            source: result.source,
            score: result.score,
            uri: result.uri,
            installs: result.installs,
            integrations: content.integrations,
            mcpServers: content.mcpServers,
            nixPackages: content.nixPackages,
            permissions: content.permissions,
            providers: content.providers,
          };
        } catch {
          return {
            id: result.id,
            name: result.name,
            description: result.description,
            source: result.source,
            score: result.score,
            uri: result.uri,
            installs: result.installs,
          };
        }
      })
    );

    logger.info("Integrations discovery search", {
      query,
      limit,
      skillCount: skills.length,
      mcpCount: mcps.length,
    });

    return c.json({ skills, mcps, limit });
  });

  // Resolve a skill or MCP by ID — tries skill registries first, then MCP discovery
  router.get(
    "/internal/integrations/resolve/:id",
    authenticateWorker,
    async (c) => {
      const id = c.req.param("id");

      // Get per-agent registries if available
      const worker = c.get("worker");
      const resolveAgentId = worker.agentId || worker.userId;
      let extraRegistries;
      if (config.agentSettingsStore) {
        const settings =
          await config.agentSettingsStore.getSettings(resolveAgentId);
        extraRegistries = settings?.skillRegistries;
      }

      // Try skill registries first
      try {
        const content = await coordinator.fetch(id, extraRegistries);
        return c.json({
          type: "skill",
          id,
          name: content.name,
          description: content.description,
          integrations: content.integrations,
          mcpServers: content.mcpServers,
          nixPackages: content.nixPackages,
          permissions: content.permissions,
          providers: content.providers,
        });
      } catch {
        // Not a skill, try MCP
      }

      // Try MCP discovery
      const mcp = await mcpDiscovery.getById(id);
      if (mcp) {
        return c.json({
          type: "mcp",
          id: mcp.id,
          name: mcp.name,
          description: mcp.description,
          prefillMcpServer: mcp.prefillMcpServer,
        });
      }

      return c.json({ error: `"${id}" not found in any registry` }, 404);
    }
  );

  // Installed capabilities for an agent (skills, integrations, MCP servers)
  router.get(
    "/internal/integrations/installed",
    authenticateWorker,
    async (c) => {
      const worker = c.get("worker");
      const agentId = worker.agentId || worker.userId;

      const skills: Array<{
        id: string;
        name: string;
        enabled: boolean;
      }> = [];
      const integrations: Array<{
        id: string;
        label: string;
        authType: string;
        connected: boolean;
        configured: boolean;
        accounts: Array<{ accountId: string; grantedScopes: string[] }>;
      }> = [];
      const mcpServers: Array<{
        id: string;
        enabled: boolean;
        type?: string;
      }> = [];

      if (config.agentSettingsStore) {
        const settings = await config.agentSettingsStore.getSettings(agentId);

        // Installed skills
        for (const skill of settings?.skillsConfig?.skills || []) {
          skills.push({
            id: skill.repo,
            name: skill.name,
            enabled: skill.enabled,
          });
        }

        // Configured MCP servers
        for (const [id, mcpConfig] of Object.entries(
          settings?.mcpServers || {}
        )) {
          const cfg = mcpConfig as Record<string, unknown>;
          mcpServers.push({
            id,
            enabled: cfg.enabled !== false,
            type: typeof cfg.url === "string" ? "sse" : "stdio",
          });
        }
      }

      logger.info("Installed capabilities query", {
        agentId,
        skillCount: skills.length,
        integrationCount: integrations.length,
        mcpCount: mcpServers.length,
      });

      return c.json({ skills, integrations, mcpServers });
    }
  );

  // Install a skill or MCP — auto-enables system skills with satisfied deps
  router.post(
    "/internal/integrations/install",
    authenticateWorker,
    async (c) => {
      const body = await c.req.json<{ id: string; upgrade?: boolean }>();
      const { id, upgrade } = body;
      if (!id?.trim()) {
        return c.json({ error: "Missing required field: id" }, 400);
      }

      const worker = c.get("worker");
      const agentId = worker.agentId || worker.userId;

      // Get per-agent registries
      let extraRegistries;
      if (config.agentSettingsStore) {
        const settings = await config.agentSettingsStore.getSettings(agentId);
        extraRegistries = settings?.skillRegistries;
      }

      // Determine source by searching for the skill ID
      let source = "clawhub";
      try {
        const searchResults = await coordinator.search(id, 5, extraRegistries);
        const exactMatch = searchResults.find((r) => r.id === id);
        if (exactMatch) {
          source = exactMatch.source;
        }
      } catch {
        // Search failed, default to clawhub
      }

      // Try skill registries first
      let content: SkillContent | null = null;
      try {
        content = await coordinator.fetch(id, extraRegistries);
      } catch {
        // Not a skill, try MCP
      }

      if (content) {
        // System skill with all deps satisfied → auto-install
        if (source === "system" && config.agentSettingsStore) {
          const settings = await config.agentSettingsStore.getSettings(agentId);
          const missing = checkRequirements(content, settings);

          if (missing.length === 0) {
            await applySkillToSettings(
              config.agentSettingsStore,
              agentId,
              id,
              content,
              !!upgrade
            );

            logger.info("Auto-installed system skill", { id, agentId });
            return c.json({
              type: "auto_installed",
              name: content.name,
              uri: null,
              message: `${content.name} has been enabled. All dependencies were already configured.`,
            });
          }

          // System skill but missing deps
          return c.json({
            type: "needs_setup",
            id,
            name: content.name,
            source,
            uri: null,
            description: content.description,
            integrations: content.integrations || [],
            mcpServers: content.mcpServers || [],
            nixPackages: content.nixPackages || [],
            permissions: content.permissions || [],
            providers: content.providers || [],
            missing,
          });
        }

        // Non-system skill or missing stores → return manifest
        return c.json({
          type: "manifest",
          id,
          name: content.name,
          source,
          uri: null,
          description: content.description,
          integrations: content.integrations || [],
          mcpServers: content.mcpServers || [],
          nixPackages: content.nixPackages || [],
          permissions: content.permissions || [],
          providers: content.providers || [],
        });
      }

      // Try MCP discovery
      const mcp = await mcpDiscovery.getById(id);
      if (mcp) {
        return c.json({
          type: "manifest",
          id: mcp.id,
          name: mcp.name,
          source: "mcp-registry",
          uri: null,
          description: mcp.description,
          integrations: [],
          mcpServers: [],
          nixPackages: [],
          permissions: [],
          providers: [],
          prefillMcpServer: mcp.prefillMcpServer,
        });
      }

      return c.json({ error: `"${id}" not found in any registry` }, 404);
    }
  );

  logger.debug("Internal integrations discovery routes registered");
  return router;
}

// ---------------------------------------------------------------------------
// Helpers for install endpoint
// ---------------------------------------------------------------------------

/** Check skill requirements and return list of unsatisfied dependencies. */
function checkRequirements(
  content: SkillContent,
  settings: {
    mcpServers?: Record<string, unknown>;
    installedProviders?: Array<{ providerId: string }>;
  } | null
): string[] {
  const missing: string[] = [];

  // Integration dependencies are handled by Owletto at use time.
  // Skills install freely; auth errors surface when tools are called.

  // Check providers
  if (content.providers?.length) {
    const installedProviderIds = new Set(
      (settings?.installedProviders || []).map((p) => p.providerId)
    );
    for (const provider of content.providers) {
      if (!installedProviderIds.has(provider)) {
        missing.push(`provider:${provider} (not configured)`);
      }
    }
  }

  // Check MCP servers
  if (content.mcpServers?.length) {
    const configuredMcps = settings?.mcpServers || {};
    for (const mcp of content.mcpServers) {
      if (!configuredMcps[mcp.id]) {
        missing.push(`mcp:${mcp.id} (not configured)`);
      }
    }
  }

  return missing;
}

/** Enable a skill in agent settings (add or update). */
async function applySkillToSettings(
  store: AgentSettingsStore,
  agentId: string,
  skillId: string,
  content: SkillContent,
  upgrade: boolean
): Promise<void> {
  const settings = await store.getSettings(agentId);
  const skills = settings?.skillsConfig?.skills || [];

  const existingIdx = skills.findIndex((s) => s.repo === skillId);
  const skillEntry: SkillConfig = {
    repo: skillId,
    name: content.name,
    description: content.description,
    enabled: true,
    mcpServers: content.mcpServers,
    nixPackages: content.nixPackages,
    permissions: content.permissions,
    providers: content.providers,
  };

  if (existingIdx >= 0 && skills[existingIdx]) {
    if (upgrade) {
      skills[existingIdx] = {
        ...skills[existingIdx],
        ...skillEntry,
        enabled: true,
      };
    } else {
      skills[existingIdx].enabled = true;
    }
  } else {
    skills.push(skillEntry);
  }

  // Also add MCP servers from skill manifest to agent's mcpServers config
  const mcpServers = { ...(settings?.mcpServers || {}) } as Record<
    string,
    Record<string, unknown>
  >;
  if (content.mcpServers?.length) {
    for (const mcp of content.mcpServers) {
      if (!mcpServers[mcp.id]) {
        const mcpEntry: Record<string, unknown> = { enabled: true };
        if (mcp.url) mcpEntry.url = mcp.url;
        if (mcp.type) mcpEntry.type = mcp.type;
        if (mcp.command) mcpEntry.command = mcp.command;
        if (mcp.args) mcpEntry.args = mcp.args;
        if (mcp.name) mcpEntry.name = mcp.name;
        mcpServers[mcp.id] = mcpEntry;
      }
    }
  }

  await store.updateSettings(agentId, {
    skillsConfig: { skills },
    mcpServers,
  });
}
