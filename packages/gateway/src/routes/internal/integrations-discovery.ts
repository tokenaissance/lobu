/**
 * Unified Internal Integrations Discovery Routes
 *
 * Single search endpoint for workers to discover both skills and MCP servers.
 * Resolve endpoint for fetching full manifest of either type by ID.
 * Installed endpoint for listing agent's active capabilities.
 */

import {
  createLogger,
  type SkillIntegration,
  verifyWorkerToken,
} from "@lobu/core";
import { Hono } from "hono";
import type { IntegrationConfigService } from "../../auth/integration/config-service";
import type { IntegrationCredentialStore } from "../../auth/integration/credential-store";
import type { AgentSettingsStore } from "../../auth/settings/agent-settings-store";
import { McpDiscoveryService } from "../../services/mcp-discovery";
import type { SkillRegistryCoordinator } from "../../services/skill-registry";
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
  integrationConfigService?: IntegrationConfigService;
  integrationCredentialStore?: IntegrationCredentialStore;
  systemConfigResolver?: SystemConfigResolver;
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
        integrations?: SkillIntegration[];
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
            integrations: skill.integrations,
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

      // Connected OAuth integrations
      if (
        config.integrationConfigService &&
        config.integrationCredentialStore
      ) {
        const allConfigs = await config.integrationConfigService.getAll();
        for (const [id, integrationConfig] of Object.entries(allConfigs)) {
          const accounts = await config.integrationCredentialStore.listAccounts(
            agentId,
            id
          );
          // Check if OAuth credentials are configured for this agent
          let configured = true;
          if (config.systemConfigResolver) {
            configured = await config.systemConfigResolver.isOAuthConfigured(
              id,
              agentId
            );
          }
          integrations.push({
            id,
            label: integrationConfig.label,
            authType: integrationConfig.authType || "oauth",
            connected: accounts.length > 0,
            configured,
            accounts: accounts.map((a) => ({
              accountId: a.accountId,
              grantedScopes: a.credentials.grantedScopes || [],
            })),
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

  logger.info("Internal integrations discovery routes registered");
  return router;
}
