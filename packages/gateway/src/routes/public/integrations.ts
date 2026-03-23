/**
 * Integrations Routes (MCP registry + skill fetch)
 *
 * Registry endpoint returns MCPs from the MCP registry.
 * Skill fetch endpoint is kept for the settings page prefill flow.
 */

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { AgentSettingsStore } from "../../auth/settings/agent-settings-store";
import { McpRegistryService } from "../../services/mcp-registry";
import { SkillRegistryCoordinator } from "../../services/skill-registry";
import type { SystemConfigResolver } from "../../services/system-config-resolver";
import { verifySettingsSession } from "./settings-auth";

const TAG = "Integrations";
const ErrorResponse = z.object({ error: z.string() });

const registryRoute = createRoute({
  method: "get",
  path: "/registry",
  tags: [TAG],
  summary: "Browse/search integrations registry (MCPs only)",
  description:
    "Returns curated MCPs if no query, or searches MCP registry if q provided",
  request: {
    query: z.object({
      token: z.string().optional(),
      q: z
        .string()
        .optional()
        .openapi({ description: "Search query (omit for curated)" }),
      limit: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: "Integrations",
      content: {
        "application/json": {
          schema: z.object({
            mcps: z.array(
              z.object({
                id: z.string(),
                name: z.string(),
                description: z.string(),
                type: z.string().optional(),
              })
            ),
            source: z.enum(["curated", "search"]),
          }),
        },
      },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: ErrorResponse } },
    },
  },
});

const skillFetchRoute = createRoute({
  method: "post",
  path: "/skills/fetch",
  tags: [TAG],
  summary: "Fetch skill metadata from registry",
  description: "Fetches skill name, description, and content by slug",
  request: {
    query: z.object({ token: z.string().optional() }),
    body: {
      content: {
        "application/json": {
          schema: z.object({
            repo: z
              .string()
              .openapi({ description: "Skill slug (e.g., 'pdf')" }),
            refresh: z
              .boolean()
              .optional()
              .openapi({ description: "Force refresh" }),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Skill metadata",
      content: {
        "application/json": {
          schema: z.object({
            repo: z.string(),
            name: z.string(),
            description: z.string(),
            content: z.string(),
            fetchedAt: z.number(),
            integrations: z
              .array(
                z.object({
                  id: z.string(),
                  label: z.string().optional(),
                  authType: z.enum(["oauth", "api-key"]).optional(),
                  scopes: z.array(z.string()).optional(),
                  apiDomains: z.array(z.string()).optional(),
                })
              )
              .optional(),
            mcpServers: z
              .array(
                z.object({
                  id: z.string(),
                  name: z.string().optional(),
                  url: z.string().optional(),
                  type: z.enum(["sse", "stdio"]).optional(),
                  command: z.string().optional(),
                  args: z.array(z.string()).optional(),
                })
              )
              .optional(),
            nixPackages: z.array(z.string()).optional(),
            permissions: z.array(z.string()).optional(),
            providers: z.array(z.string()).optional(),
          }),
        },
      },
    },
    400: {
      description: "Invalid",
      content: { "application/json": { schema: ErrorResponse } },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: ErrorResponse } },
    },
  },
});

export interface IntegrationsRoutesConfig {
  configResolver?: SystemConfigResolver;
  agentSettingsStore?: AgentSettingsStore;
}

export function createIntegrationsRoutes(
  config: IntegrationsRoutesConfig = {}
): OpenAPIHono {
  const app = new OpenAPIHono();
  const coordinator = new SkillRegistryCoordinator();
  const mcpRegistry = new McpRegistryService(config.configResolver);

  app.openapi(registryRoute, async (c): Promise<any> => {
    const { q, limit } = c.req.valid("query");
    if (!verifySettingsSession(c))
      return c.json({ error: "Unauthorized" }, 401);

    const maxLimit = Math.min(parseInt(limit || "20", 10), 50);

    if (q) {
      const mcpResults = await mcpRegistry.search(q, maxLimit);
      return c.json({
        mcps: mcpResults.map((m) => ({
          id: m.id,
          name: m.name,
          description: m.description,
          type: m.type,
        })),
        source: "search",
      });
    }

    const mcps = await mcpRegistry.getCurated();
    return c.json({
      mcps: mcps.map((m) => ({
        id: m.id,
        name: m.name,
        description: m.description,
        type: m.type,
      })),
      source: "curated",
    });
  });

  app.openapi(skillFetchRoute, async (c): Promise<any> => {
    if (!verifySettingsSession(c))
      return c.json({ error: "Unauthorized" }, 401);

    const { repo } = c.req.valid("json");
    if (!repo?.trim()) return c.json({ error: "Missing skill slug" }, 400);

    // Get per-agent registries if agentId is available in session
    const session = verifySettingsSession(c);
    let extraRegistries;
    if (session?.agentId && config.agentSettingsStore) {
      const settings = await config.agentSettingsStore.getSettings(
        session.agentId
      );
      extraRegistries = settings?.skillRegistries;
    }

    try {
      const skillContent = await coordinator.fetch(repo, extraRegistries);
      return c.json({
        repo,
        name: skillContent.name,
        description: skillContent.description,
        content: skillContent.content,
        fetchedAt: Date.now(),
        integrations: skillContent.integrations,
        mcpServers: skillContent.mcpServers,
        nixPackages: skillContent.nixPackages,
        permissions: skillContent.permissions,
        providers: skillContent.providers,
      });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "Failed" }, 400);
    }
  });

  return app;
}
