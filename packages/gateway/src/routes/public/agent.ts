import { randomUUID } from "node:crypto";
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import {
  createLogger,
  createRootSpan,
  generateWorkerToken,
  type InstalledProvider,
  type McpServerConfig,
  type NetworkConfig,
} from "@lobu/core";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import {
  createApiAuthMiddleware,
  TOKEN_EXPIRATION_MS,
} from "../../auth/api-auth-middleware";
import type { CliTokenService } from "../../auth/cli/token-service";
import type { ExternalAuthClient } from "../../auth/external/client";
import type { AgentSettingsStore } from "../../auth/settings/agent-settings-store";
import type { QueueProducer } from "../../infrastructure/queue/queue-producer";
import { getModelProviderModules } from "../../modules/module-system";
import { resolveAgentOptions } from "../../services/platform-helpers";
import type { ISessionManager, ThreadSession } from "../../session";

const logger = createLogger("agent-api");

// =============================================================================
// Constants
// =============================================================================

const MAX_CONNECTIONS_PER_AGENT = 5;
const MAX_TOTAL_CONNECTIONS = 1000;

// SSE connection tracking
const sseConnections = new Map<string, Set<any>>();

// =============================================================================
// Zod Schemas
// =============================================================================

const NetworkConfigSchema = z.object({
  allowedDomains: z.array(z.string()).optional(),
  deniedDomains: z.array(z.string()).optional(),
});

const McpServerConfigSchema = z.object({
  url: z.string().optional(),
  type: z.enum(["sse", "stdio"]).optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  description: z.string().optional(),
});

const NixConfigSchema = z.object({
  flakeUrl: z.string().optional(),
  packages: z.array(z.string()).optional(),
});

const CreateAgentRequestSchema = z.object({
  provider: z.string().default("claude").optional(),
  model: z.string().optional(),
  agentId: z.string().min(1).optional(),
  networkConfig: NetworkConfigSchema.optional(),
  mcpServers: z.record(z.string(), McpServerConfigSchema).optional(),
  nix: NixConfigSchema.optional(),
});

const CreateAgentResponseSchema = z.object({
  success: z.boolean(),
  agentId: z.string(),
  token: z.string(),
  expiresAt: z.number(),
  sseUrl: z.string(),
  messagesUrl: z.string(),
});

const SendMessageRequestSchema = z.object({
  content: z.string(),
  messageId: z.string().optional(),
});

const SendMessageResponseSchema = z.object({
  success: z.boolean(),
  messageId: z.string(),
  jobId: z.string(),
  queued: z.boolean(),
  traceparent: z.string().optional(),
});

const AgentStatusResponseSchema = z.object({
  success: z.boolean(),
  agent: z.object({
    agentId: z.string(),
    userId: z.string(),
    status: z.string(),
    createdAt: z.number(),
    lastActivity: z.number(),
    hasActiveConnection: z.boolean(),
  }),
});

const ErrorResponseSchema = z.object({
  success: z.boolean(),
  error: z.string(),
  details: z.string().optional(),
});

const SuccessResponseSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
  agentId: z.string().optional(),
});

// Path parameters
const AgentIdParamSchema = z.object({
  agentId: z.string(),
});

// =============================================================================
// Validation Helpers
// =============================================================================

function validateDomainPattern(pattern: string): string | null {
  if (!pattern || typeof pattern !== "string") {
    return "Domain pattern must be a non-empty string";
  }
  const trimmed = pattern.trim().toLowerCase();
  if (trimmed === "*") return "Bare wildcard '*' is not allowed";
  if (trimmed.includes("://"))
    return `Domain pattern cannot contain protocol: ${pattern}`;
  if (trimmed.includes("/"))
    return `Domain pattern cannot contain path: ${pattern}`;
  if (trimmed.includes(":") && !trimmed.includes("[")) {
    return `Domain pattern cannot contain port: ${pattern}`;
  }
  if (trimmed.startsWith("*.") || trimmed.startsWith(".")) {
    const domain = trimmed.startsWith("*.")
      ? trimmed.substring(2)
      : trimmed.substring(1);
    if (!domain.includes(".")) {
      return `Wildcard pattern too broad: ${pattern}`;
    }
  } else if (!trimmed.includes(".")) {
    return `Invalid domain pattern: ${pattern}`;
  }
  return null;
}

function validateNetworkConfig(config: NetworkConfig): string | null {
  for (const domains of [config.allowedDomains, config.deniedDomains]) {
    if (domains) {
      for (const domain of domains) {
        const error = validateDomainPattern(domain);
        if (error) return error;
      }
    }
  }
  return null;
}

function validateMcpServerConfig(
  id: string,
  config: McpServerConfig
): string | null {
  if (!config.url && !config.command) {
    return `MCP ${id}: must specify either 'url' or 'command'`;
  }
  if (
    config.url &&
    !config.url.startsWith("http://") &&
    !config.url.startsWith("https://")
  ) {
    return `MCP ${id}: url must be http:// or https://`;
  }
  if (config.command) {
    const dangerousCommands = [
      "rm",
      "sudo",
      "curl",
      "wget",
      "sh",
      "bash",
      "zsh",
      "kill",
    ];
    const baseCommand = config.command.split("/").pop()?.split(" ")[0] || "";
    if (dangerousCommands.includes(baseCommand)) {
      return `MCP ${id}: command '${baseCommand}' is not allowed`;
    }
  }
  return null;
}

function validateMcpConfig(
  mcpServers: Record<string, McpServerConfig>
): string | null {
  for (const [id, config] of Object.entries(mcpServers)) {
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
      return `MCP ID '${id}' is invalid`;
    }
    const error = validateMcpServerConfig(id, config);
    if (error) return error;
  }
  return null;
}

// =============================================================================
// Broadcast Functions (exported for use by other modules)
// =============================================================================

export function broadcastToAgent(
  agentId: string,
  event: string,
  data: unknown
): void {
  const connections = sseConnections.get(agentId);
  if (!connections || connections.size === 0) return;

  const deadConnections = new Set<any>();

  for (const res of connections) {
    try {
      if (res.closed || res.destroyed || res.writableEnded) {
        deadConnections.add(res);
        continue;
      }
      if (typeof res.writeSSE === "function") {
        res.writeSSE({ event, data: JSON.stringify(data) });
      } else if (typeof res.write === "function") {
        const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        res.write(message);
      }
    } catch {
      deadConnections.add(res);
    }
  }

  for (const deadRes of deadConnections) {
    connections.delete(deadRes);
  }
  if (connections.size === 0) {
    sseConnections.delete(agentId);
  }
}

// =============================================================================
// OpenAPI Route Definitions
// =============================================================================

const createAgentRoute = createRoute({
  method: "post",
  path: "/api/v1/agents",
  tags: ["Agents"],
  summary: "Create a new agent",
  security: [{ bearerAuth: [] }],
  description:
    "Creates a new agent session and returns authentication credentials",
  request: {
    body: {
      content: { "application/json": { schema: CreateAgentRequestSchema } },
    },
  },
  responses: {
    201: {
      description: "Agent created",
      content: { "application/json": { schema: CreateAgentResponseSchema } },
    },
    400: {
      description: "Invalid request",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

const getAgentRoute = createRoute({
  method: "get",
  path: "/api/v1/agents/{agentId}",
  tags: ["Agents"],
  summary: "Get agent status",
  security: [{ bearerAuth: [] }],
  request: { params: AgentIdParamSchema },
  responses: {
    200: {
      description: "Agent status",
      content: { "application/json": { schema: AgentStatusResponseSchema } },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    404: {
      description: "Not found",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

const deleteAgentRoute = createRoute({
  method: "delete",
  path: "/api/v1/agents/{agentId}",
  tags: ["Agents"],
  summary: "Delete an agent",
  security: [{ bearerAuth: [] }],
  request: { params: AgentIdParamSchema },
  responses: {
    200: {
      description: "Agent deleted",
      content: { "application/json": { schema: SuccessResponseSchema } },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    404: {
      description: "Not found",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

const getAgentEventsRoute = createRoute({
  method: "get",
  path: "/api/v1/agents/{agentId}/events",
  tags: ["Messages"],
  summary: "Subscribe to agent events (SSE)",
  description: "Server-Sent Events stream for real-time agent updates",
  security: [{ bearerAuth: [] }],
  request: { params: AgentIdParamSchema },
  responses: {
    200: {
      description: "SSE stream",
      content: { "text/event-stream": { schema: z.string() } },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    429: {
      description: "Too many connections",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

const sendMessageRoute = createRoute({
  method: "post",
  path: "/api/v1/agents/{agentId}/messages",
  tags: ["Messages"],
  summary: "Send a message to the agent",
  security: [{ bearerAuth: [] }],
  request: {
    params: AgentIdParamSchema,
    body: {
      content: { "application/json": { schema: SendMessageRequestSchema } },
    },
  },
  responses: {
    200: {
      description: "Message queued",
      content: { "application/json": { schema: SendMessageResponseSchema } },
    },
    400: {
      description: "Invalid request",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    404: {
      description: "Agent not found",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

// =============================================================================
// Create OpenAPI Hono App
// =============================================================================

export interface AgentApiConfig {
  queueProducer: QueueProducer;
  sessionManager: ISessionManager;
  publicGatewayUrl: string;
  adminPassword?: string;
  cliTokenService?: CliTokenService;
  externalAuthClient?: ExternalAuthClient;
  agentSettingsStore?: AgentSettingsStore;
}

export function createAgentApi(config: AgentApiConfig): OpenAPIHono;
export function createAgentApi(
  queueProducer: QueueProducer,
  sessionManager: ISessionManager,
  publicGatewayUrl: string
): OpenAPIHono;
export function createAgentApi(
  configOrQueue: AgentApiConfig | QueueProducer,
  sessionManager?: ISessionManager,
  publicGatewayUrl?: string
): OpenAPIHono {
  const config: AgentApiConfig =
    configOrQueue instanceof Object && "queueProducer" in configOrQueue
      ? configOrQueue
      : {
          queueProducer: configOrQueue as QueueProducer,
          sessionManager: sessionManager!,
          publicGatewayUrl: publicGatewayUrl!,
        };

  const { queueProducer, adminPassword, cliTokenService, agentSettingsStore } =
    config;
  const sessMgr = config.sessionManager;
  const pubUrl = config.publicGatewayUrl;
  const app = new OpenAPIHono();

  // Unified auth middleware for all agent API routes
  app.use(
    "/api/v1/agents/*",
    createApiAuthMiddleware({
      adminPassword,
      cliTokenService,
      externalAuthClient: config.externalAuthClient,
      allowSettingsSession: true,
    })
  );

  // =============================================================================
  // Route Handlers
  // =============================================================================

  // POST /api/v1/agents - Create agent
  app.openapi(createAgentRoute, async (c): Promise<any> => {
    const body = c.req.valid("json");
    const {
      provider = "claude",
      model,
      agentId: requestedAgentId,
      networkConfig,
      mcpServers,
      nix: nixConfig,
    } = body;

    // Validate provider
    if (provider && !["claude"].includes(provider)) {
      return c.json(
        { success: false, error: "Invalid provider. Supported: claude" },
        400
      );
    }

    // Validate network config
    if (networkConfig) {
      const error = validateNetworkConfig(networkConfig as NetworkConfig);
      if (error) return c.json({ success: false, error }, 400);
    }

    // Validate MCP config
    if (mcpServers) {
      const error = validateMcpConfig(
        mcpServers as Record<string, McpServerConfig>
      );
      if (error) return c.json({ success: false, error }, 400);
    }

    const isEphemeral = !requestedAgentId?.trim();
    const agentId = requestedAgentId?.trim() || randomUUID();

    // For ephemeral agents, auto-provision settings so the worker gets provider config
    if (isEphemeral && agentSettingsStore) {
      // Try system-key providers first (env var based API keys)
      const providerModules = getModelProviderModules();
      const systemProviders: InstalledProvider[] = providerModules
        .filter((m) => m.hasSystemKey())
        .map((m) => ({
          providerId: m.providerId,
          installedAt: Date.now(),
        }));

      if (systemProviders.length > 0) {
        // Also inherit pluginsConfig from template agent if available
        const templateId = await agentSettingsStore.findTemplateAgentId();
        const templateSettings = templateId
          ? await agentSettingsStore.getSettings(templateId)
          : null;
        await agentSettingsStore.saveSettings(agentId, {
          installedProviders: systemProviders,
          pluginsConfig: templateSettings?.pluginsConfig,
        });
        logger.info(
          `Ephemeral agent ${agentId}: provisioned system providers [${systemProviders.map((p) => p.providerId).join(", ")}]`
        );
      } else {
        // Fall back to using an existing agent as template (inherits its providers)
        const templateId = await agentSettingsStore.findTemplateAgentId();
        if (templateId) {
          const templateSettings =
            await agentSettingsStore.getSettings(templateId);
          await agentSettingsStore.saveSettings(agentId, {
            templateAgentId: templateId,
            pluginsConfig: templateSettings?.pluginsConfig,
          });
          logger.info(
            `Ephemeral agent ${agentId}: using template ${templateId}`
          );
        }
      }
    }

    const conversationId = agentId;
    const channelId = `api-${agentId.slice(0, 8)}`;
    const deploymentName = `api-${agentId.slice(0, 8)}`;

    const token = generateWorkerToken(agentId, conversationId, deploymentName, {
      channelId,
      agentId,
      platform: "api",
      sessionKey: agentId,
    });

    const expiresAt = Date.now() + TOKEN_EXPIRATION_MS;

    const session: ThreadSession = {
      conversationId,
      channelId,
      userId: agentId,
      threadCreator: agentId,
      lastActivity: Date.now(),
      createdAt: Date.now(),
      status: "created",
      provider,
      model,
      networkConfig: networkConfig as NetworkConfig | undefined,
      mcpConfig: mcpServers
        ? { mcpServers: mcpServers as Record<string, McpServerConfig> }
        : undefined,
      nixConfig,
    };
    await sessMgr.setSession(session);

    logger.info(`Created API agent: ${agentId}`);

    const baseUrl = pubUrl || "http://localhost:8080";
    return c.json(
      {
        success: true,
        agentId,
        token,
        expiresAt,
        sseUrl: `${baseUrl}/api/v1/agents/${agentId}/events`,
        messagesUrl: `${baseUrl}/api/v1/agents/${agentId}/messages`,
      },
      201
    );
  });

  // GET /api/v1/agents/:agentId - Get status
  app.openapi(getAgentRoute, async (c): Promise<any> => {
    const { agentId } = c.req.valid("param");

    const session = await sessMgr.getSession(agentId);
    if (!session) {
      return c.json({ success: false, error: "Agent not found" }, 404);
    }

    const hasActiveConnection =
      sseConnections.has(agentId) &&
      (sseConnections.get(agentId)?.size ?? 0) > 0;

    return c.json({
      success: true,
      agent: {
        agentId: session.conversationId,
        userId: session.userId,
        status: session.status || "active",
        createdAt: session.createdAt,
        lastActivity: session.lastActivity,
        hasActiveConnection,
      },
    });
  });

  // DELETE /api/v1/agents/:agentId
  app.openapi(deleteAgentRoute, async (c): Promise<any> => {
    const { agentId } = c.req.valid("param");

    const connections = sseConnections.get(agentId);
    if (connections) {
      for (const connection of connections) {
        try {
          if (typeof connection.writeSSE === "function") {
            connection.writeSSE({
              event: "closed",
              data: JSON.stringify({ reason: "agent_deleted" }),
            });
          } else if (typeof connection.write === "function") {
            connection.write(
              `event: closed\ndata: ${JSON.stringify({ reason: "agent_deleted" })}\n\n`
            );
          }
          connection.close?.();
          connection.end?.();
        } catch {
          // Ignore
        }
      }
      sseConnections.delete(agentId);
    }

    await sessMgr.deleteSession(agentId);
    // Clean up ephemeral agent settings
    if (agentSettingsStore) {
      await agentSettingsStore.deleteSettings(agentId).catch(() => {
        /* best-effort cleanup */
      });
    }
    logger.info(`Deleted agent ${agentId}`);

    return c.json({ success: true, message: "Agent deleted", agentId });
  });

  // GET /api/v1/agents/:agentId/events - SSE stream
  app.openapi(getAgentEventsRoute, async (c): Promise<any> => {
    const { agentId } = c.req.valid("param");

    const session = await sessMgr.getSession(agentId);
    if (!session) {
      return c.json({ success: false, error: "Agent not found" }, 404);
    }

    // Check connection limits
    const totalConnections = Array.from(sseConnections.values()).reduce(
      (acc, set) => acc + set.size,
      0
    );
    if (totalConnections >= MAX_TOTAL_CONNECTIONS) {
      return c.json(
        { success: false, error: "Server connection limit reached" },
        429
      );
    }

    if (!sseConnections.has(agentId)) {
      sseConnections.set(agentId, new Set());
    }
    const agentConnections = sseConnections.get(agentId)!;
    if (agentConnections.size >= MAX_CONNECTIONS_PER_AGENT) {
      return c.json(
        {
          success: false,
          error: `Maximum ${MAX_CONNECTIONS_PER_AGENT} connections`,
        },
        429
      );
    }

    // Return SSE stream
    return streamSSE(c, async (stream) => {
      agentConnections.add(stream);

      await stream.writeSSE({
        event: "connected",
        data: JSON.stringify({ agentId, timestamp: Date.now() }),
      });

      const heartbeatInterval = setInterval(async () => {
        try {
          await stream.writeSSE({
            event: "ping",
            data: JSON.stringify({ timestamp: Date.now() }),
          });
        } catch {
          clearInterval(heartbeatInterval);
        }
      }, 30000);

      stream.onAbort(() => {
        clearInterval(heartbeatInterval);
        agentConnections.delete(stream);
        if (agentConnections.size === 0) {
          sseConnections.delete(agentId);
        }
        logger.info(`SSE connection closed for agent ${agentId}`);
      });

      while (true) {
        await stream.sleep(1000);
      }
    });
  });

  // POST /api/v1/agents/:agentId/messages - Send message
  app.openapi(sendMessageRoute, async (c): Promise<any> => {
    const { agentId } = c.req.valid("param");

    const body = c.req.valid("json");
    const { content, messageId = randomUUID() } = body;

    if (!content || typeof content !== "string") {
      return c.json({ success: false, error: "content is required" }, 400);
    }

    const session = await sessMgr.getSession(agentId);
    if (!session) {
      return c.json({ success: false, error: "Agent not found" }, 404);
    }

    await sessMgr.touchSession(agentId);

    const { span: rootSpan, traceparent } = createRootSpan("message_received", {
      "lobu.agent_id": agentId,
      "lobu.message_id": messageId,
    });

    try {
      const channelId = session.channelId || `api-${agentId.slice(0, 8)}`;

      // Merge agent settings (pluginsConfig, toolsConfig, etc.) like platform handlers do
      const baseOptions: Record<string, any> = {
        provider: session.provider || "claude",
        model: session.model,
      };
      const agentOptions = await resolveAgentOptions(
        agentId,
        baseOptions,
        agentSettingsStore
      );

      // Extract settings-level overrides that resolveAgentOptions may have added
      const {
        networkConfig: settingsNetwork,
        mcpServers: settingsMcpServers,
        ...remainingOptions
      } = agentOptions;

      const jobId = await queueProducer.enqueueMessage({
        userId: session.userId,
        conversationId: session.conversationId || agentId,
        messageId,
        channelId,
        teamId: "api",
        agentId: agentId,
        botId: "lobu-api",
        platform: "api",
        messageText: content,
        platformMetadata: {
          agentId,
          source: "direct-api",
          traceparent: traceparent || undefined,
        },
        agentOptions: remainingOptions,
        networkConfig: session.networkConfig || settingsNetwork,
        mcpConfig:
          session.mcpConfig ||
          (settingsMcpServers ? { mcpServers: settingsMcpServers } : undefined),
      });

      rootSpan?.end();

      return c.json({
        success: true,
        messageId,
        jobId,
        queued: true,
        traceparent: traceparent || undefined,
      });
    } catch (error) {
      rootSpan?.end();
      throw error;
    }
  });

  logger.debug("Hono Agent API routes registered");

  return app;
}
