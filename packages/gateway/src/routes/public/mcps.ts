/**
 * MCP Registry Routes
 *
 * Endpoints for MCP server discovery and configuration.
 */

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { verifySettingsToken } from "../../auth/settings/token-service";
import { McpRegistryService } from "../../services/mcp-registry";

const TAG = "MCPs";
const ErrorResponse = z.object({ error: z.string() });

const registryRoute = createRoute({
  method: "get",
  path: "/registry",
  tags: [TAG],
  summary: "Browse/search MCP registry",
  description:
    "Returns curated MCPs if no query, or searches registry if q provided",
  request: {
    query: z.object({
      token: z.string(),
      q: z
        .string()
        .optional()
        .openapi({ description: "Search query (omit for curated)" }),
      limit: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: "MCP servers",
      content: {
        "application/json": {
          schema: z.object({
            mcps: z.array(
              z.object({
                id: z.string(),
                name: z.string(),
                description: z.string(),
                type: z.enum(["oauth", "command", "api-key", "none"]),
              })
            ),
            source: z.enum(["curated", "search", "all"]),
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

const getByIdRoute = createRoute({
  method: "get",
  path: "/:id",
  tags: [TAG],
  summary: "Get MCP server by ID",
  description:
    "Returns full MCP server configuration including setup instructions",
  request: {
    query: z.object({ token: z.string() }),
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: {
      description: "MCP server details",
      content: {
        "application/json": {
          schema: z.object({
            id: z.string(),
            name: z.string(),
            description: z.string(),
            type: z.enum(["oauth", "command", "api-key", "none"]),
            config: z.record(z.string(), z.unknown()),
            setupInstructions: z.string().optional(),
          }),
        },
      },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: ErrorResponse } },
    },
    404: {
      description: "Not found",
      content: { "application/json": { schema: ErrorResponse } },
    },
  },
});

export function createMcpRoutes(): OpenAPIHono {
  const app = new OpenAPIHono();
  const mcpRegistry = new McpRegistryService();

  const verifyToken = (token: string | undefined) =>
    token ? verifySettingsToken(token) : null;

  app.openapi(registryRoute, async (c): Promise<any> => {
    const { token, q, limit } = c.req.valid("query");
    if (!verifyToken(token)) return c.json({ error: "Unauthorized" }, 401);

    const maxLimit = Math.min(parseInt(limit || "20", 10), 50);

    if (q) {
      const mcps = mcpRegistry.search(q, maxLimit);
      return c.json({
        mcps: mcps.map((m) => ({
          id: m.id,
          name: m.name,
          description: m.description,
          type: m.type,
        })),
        source: "search",
      });
    }

    // Return curated MCPs
    const mcps = mcpRegistry.getCurated();
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

  app.openapi(getByIdRoute, async (c): Promise<any> => {
    const { token } = c.req.valid("query");
    if (!verifyToken(token)) return c.json({ error: "Unauthorized" }, 401);

    const { id } = c.req.valid("param");
    const mcp = mcpRegistry.getById(id);

    if (!mcp) {
      return c.json({ error: "MCP not found" }, 404);
    }

    return c.json({
      id: mcp.id,
      name: mcp.name,
      description: mcp.description,
      type: mcp.type,
      config: mcp.config,
      setupInstructions: mcp.setupInstructions,
    });
  });

  return app;
}
