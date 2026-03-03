#!/usr/bin/env bun

import type { Server } from "node:http";
import { createServer } from "node:http";
import { getRequestListener } from "@hono/node-server";
import { OpenAPIHono } from "@hono/zod-openapi";
import { createLogger } from "@lobu/core";
import { apiReference } from "@scalar/hono-api-reference";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import type { GatewayConfig } from "../config";
import { getModelProviderModules } from "../modules/module-system";
import { registerAutoOpenApiRoutes } from "../routes/openapi-auto";
import type { SlackConfig } from "../slack";
import { TELEGRAM_WEBHOOK_PATH, type TelegramConfig } from "../telegram/config";
import type { TelegramPlatform } from "../telegram/platform";
import type { WhatsAppConfig } from "../whatsapp/config";

const logger = createLogger("gateway-startup");

let httpServer: Server | null = null;

/**
 * Setup Hono server with all routes on port 8080
 */
function setupServer(
  secretProxy: any,
  workerGateway: any,
  mcpProxy: any,
  interactionService?: any,
  platformRegistry?: any,
  coreServices?: any,
  telegramPlatform?: TelegramPlatform | null,
  slackExpressApp?: any
) {
  if (httpServer) return;

  const app = new OpenAPIHono();

  // Global middleware
  app.use(
    "*",
    secureHeaders({
      xFrameOptions: "DENY",
      xContentTypeOptions: "nosniff",
      referrerPolicy: "strict-origin-when-cross-origin",
      strictTransportSecurity: "max-age=63072000; includeSubDomains",
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          "'unsafe-eval'",
          "https://cdn.jsdelivr.net",
        ],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'", "ws:", "wss:"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
      },
    })
  );
  app.use(
    "*",
    cors({
      origin: process.env.ALLOWED_ORIGINS
        ? process.env.ALLOWED_ORIGINS.split(",")
        : "*",
    })
  );

  // Health endpoints
  app.get("/health", (c) => {
    const mode =
      process.env.LOBU_MODE ||
      (process.env.DEPLOYMENT_MODE === "docker" ? "local" : "cloud");

    return c.json({
      status: "ok",
      mode,
      version: process.env.npm_package_version || "2.3.0",
      timestamp: new Date().toISOString(),
      publicGatewayUrl:
        coreServices?.getPublicGatewayUrl?.() || process.env.PUBLIC_GATEWAY_URL,
      capabilities: {
        agents: ["claude"],
        streaming: true,
        toolApproval: true,
      },
      wsUrl: `ws://localhost:8080/ws`,
      secretProxy: !!secretProxy,
    });
  });

  app.get("/ready", (c) => c.json({ ready: true }));

  // Prometheus metrics endpoint
  app.get("/metrics", async (c) => {
    const metricsAuthToken = process.env.METRICS_AUTH_TOKEN;
    if (metricsAuthToken) {
      const authHeader = c.req.header("Authorization");
      if (authHeader !== `Bearer ${metricsAuthToken}`) {
        return c.text("Unauthorized", 401);
      }
    }
    const { getMetricsText } = await import("../metrics/prometheus");
    c.header("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    return c.text(getMetricsText());
  });

  // Secret injection proxy (Hono)
  if (secretProxy) {
    app.route("/api/proxy", secretProxy.getApp());
    logger.info("Secret proxy enabled at :8080/api/proxy");
  }

  // Worker Gateway routes (Hono)
  if (workerGateway) {
    app.route("/worker", workerGateway.getApp());
    logger.info("Worker gateway routes enabled at :8080/worker/*");
  }

  // Register module endpoints
  const { moduleRegistry: coreModuleRegistry } = require("@lobu/core");
  if (coreModuleRegistry.registerHonoEndpoints) {
    coreModuleRegistry.registerHonoEndpoints(app);
  } else {
    // Create express-like adapter for module registry
    const expressApp = createExpressAdapter(app);
    coreModuleRegistry.registerEndpoints(expressApp);
  }
  logger.info("Module endpoints registered");

  // MCP proxy routes (Hono)
  if (mcpProxy) {
    // Handle root path requests with X-Mcp-Id header
    app.all("/", async (c, next) => {
      if (mcpProxy.isMcpRequest(c)) {
        // Forward to MCP proxy - need to handle directly since it's at root
        return mcpProxy.getApp().fetch(c.req.raw);
      }
      return next();
    });
    // Mount MCP proxy at /mcp/*
    app.route("/mcp", mcpProxy.getApp());
    logger.info("MCP proxy routes enabled at :8080/mcp/*");
  }

  // Telegram webhook route
  const telegramWebhookRoute = telegramPlatform?.getWebhookRoute();
  if (telegramWebhookRoute) {
    app.route(TELEGRAM_WEBHOOK_PATH, telegramWebhookRoute);
    logger.info(
      `Telegram webhook route enabled at :8080${TELEGRAM_WEBHOOK_PATH}`
    );
  }

  // Slack OAuth routes for multi-workspace distribution
  if (platformRegistry) {
    const slackAdapter = platformRegistry.get?.("slack");
    const slackInstallationStore = slackAdapter?.getInstallationStore?.();
    const slackClientId = process.env.SLACK_CLIENT_ID;
    const slackClientSecret = process.env.SLACK_CLIENT_SECRET;
    const publicGatewayUrl = process.env.PUBLIC_GATEWAY_URL;

    if (
      slackInstallationStore &&
      slackClientId &&
      slackClientSecret &&
      publicGatewayUrl
    ) {
      const { createSlackOAuthRoutes } = require("../slack/oauth-routes");
      const redis = coreServices?.getQueue?.()?.getRedisClient?.();
      if (redis) {
        const slackOAuthRouter = createSlackOAuthRoutes({
          clientId: slackClientId,
          clientSecret: slackClientSecret,
          installationStore: slackInstallationStore,
          redis,
          publicGatewayUrl,
        });
        app.route("/slack", slackOAuthRouter);
        logger.info(
          "Slack OAuth routes enabled at :8080/slack/install and :8080/slack/oauth_callback"
        );
      }
    }
  }

  // File routes (already Hono) - uses platform registry for per-platform file handling
  if (platformRegistry) {
    const { createFileRoutes } = require("../routes/internal/files");
    const fileRouter = createFileRoutes(platformRegistry);
    app.route("/internal/files", fileRouter);
    logger.info("File routes enabled at :8080/internal/files/*");
  }

  // History routes (already Hono)
  {
    const { createHistoryRoutes } = require("../routes/internal/history");
    // Pass Slack installation store for multi-workspace token resolution
    const slackAdapter = platformRegistry?.get?.("slack");
    const slackInstallationStore = slackAdapter?.getInstallationStore?.();
    const historyRouter = createHistoryRoutes(slackInstallationStore);
    app.route("/internal", historyRouter);
    logger.info("History routes enabled at :8080/internal/history");
  }

  // Schedule routes (worker scheduling endpoints)
  if (coreServices) {
    const scheduledWakeupService = coreServices.getScheduledWakeupService();
    if (scheduledWakeupService) {
      const { createScheduleRoutes } = require("../routes/internal/schedule");
      const scheduleRouter = createScheduleRoutes(scheduledWakeupService);
      app.route("", scheduleRouter);
      logger.info("Schedule routes enabled at :8080/internal/schedule");
    }
  }

  // Settings link routes (worker can generate settings links for users)
  {
    const {
      createSettingsLinkRoutes,
    } = require("../routes/internal/settings-link");
    const settingsLinkRouter = createSettingsLinkRoutes(
      interactionService,
      coreServices?.getGrantStore()
    );
    app.route("", settingsLinkRouter);
    logger.info("Settings link routes enabled at :8080/internal/settings-link");
  }

  // MCP login routes (worker can trigger MCP OAuth login for users)
  if (coreServices?.getMcpOAuthModule()) {
    const { createMcpLoginRoutes } = require("../routes/internal/mcp-login");
    const mcpLoginRouter = createMcpLoginRoutes(
      coreServices.getMcpOAuthModule(),
      interactionService
    );
    app.route("", mcpLoginRouter);
    logger.info("MCP login routes enabled at :8080/internal/mcp-login");
  }

  // Integrations discovery routes (unified skills + MCP search for workers)
  {
    const {
      createIntegrationsDiscoveryRoutes,
    } = require("../routes/internal/integrations-discovery");
    const { SkillRegistryCoordinator } = require("../services/skill-registry");
    const skillRegistryCoordinator = new SkillRegistryCoordinator();
    const integrationsDiscoveryRouter = createIntegrationsDiscoveryRoutes({
      coordinator: skillRegistryCoordinator,
      agentSettingsStore: coreServices?.getAgentSettingsStore(),
      integrationConfigService: coreServices?.getIntegrationConfigService(),
      integrationCredentialStore: coreServices?.getIntegrationCredentialStore(),
    });
    app.route("", integrationsDiscoveryRouter);
    logger.info(
      "Integrations discovery routes enabled at :8080/internal/integrations/*"
    );
  }

  // Audio routes (TTS synthesis for workers)
  if (coreServices) {
    const transcriptionService = coreServices.getTranscriptionService();
    if (transcriptionService) {
      const { createAudioRoutes } = require("../routes/internal/audio");
      const audioRouter = createAudioRoutes(transcriptionService);
      app.route("", audioRouter);
      logger.info("Audio routes enabled at :8080/internal/audio/*");
    }
  }

  // Interaction routes (already Hono)
  if (interactionService) {
    const {
      createInteractionRoutes,
    } = require("../routes/internal/interactions");
    const internalRouter = createInteractionRoutes(interactionService);
    app.route("", internalRouter);
    logger.info("Internal interaction routes enabled");
  }

  // Messaging routes (already Hono)
  if (platformRegistry) {
    const { createMessagingRoutes } = require("../routes/public/messaging");
    const messagingRouter = createMessagingRoutes(platformRegistry);
    app.route("", messagingRouter);
    logger.info("Messaging routes enabled at :8080/api/v1/messaging/send");
  }

  // Agent API routes (direct API access)
  if (coreServices) {
    const queueProducer = coreServices.getQueueProducer();
    const sessionMgr = coreServices.getSessionManager();
    const interactionSvc = coreServices.getInteractionService();
    const publicUrl = coreServices.getPublicGatewayUrl();

    if (queueProducer && sessionMgr && interactionSvc) {
      // Agent API (Hono with OpenAPI docs)
      const { createAgentApi } = require("../routes/public/agent");
      const agentApi = createAgentApi(queueProducer, sessionMgr, publicUrl);
      app.route("", agentApi);
      logger.info(
        "Agent API enabled at :8080/api/v1/agents/* with docs at :8080/api/docs"
      );
    }
  }

  if (coreServices) {
    // Mount OAuth modules under unified auth router
    const authRouter = new OpenAPIHono();
    const registeredProviders: string[] = [];

    // Dynamically mount model provider auth routes
    const providerModules = getModelProviderModules();

    // Shared save-key + logout handlers (parameterized by :provider)
    const authProfilesManager = coreServices.getAuthProfilesManager();
    if (authProfilesManager) {
      const { verifySettingsToken } = require("../auth/settings/token-service");
      const {
        verifySettingsSession,
      } = require("../routes/public/settings-auth");
      const {
        createAuthProfileLabel,
      } = require("../auth/settings/auth-profiles-manager");
      const agentMetadataStore = coreServices.getAgentMetadataStore();
      const userAgentsStore = coreServices.getUserAgentsStore();

      /** Verify token or session cookie authorizes access to the given agentId */
      const verifyProviderAuth = async (
        c: any,
        agentId: string
      ): Promise<boolean> => {
        // Try explicit token first (query param or body)
        const body = c.__parsedBody;
        const queryToken = c.req.query("token");
        const authToken =
          typeof body?.token === "string" ? body.token : queryToken;
        const payload = authToken
          ? verifySettingsToken(authToken)
          : verifySettingsSession(c);
        if (!payload) return false;

        // Agent-based token: must match exactly
        if (payload.agentId) return payload.agentId === agentId;

        // Channel-based token: check user-agent association or metadata owner
        if (userAgentsStore) {
          const owns = await userAgentsStore.ownsAgent(
            payload.platform,
            payload.userId,
            agentId
          );
          if (owns) return true;
        }
        if (agentMetadataStore) {
          const metadata = await agentMetadataStore.getMetadata(agentId);
          const isOwner =
            metadata?.owner?.platform === payload.platform &&
            metadata?.owner?.userId === payload.userId;
          if (isOwner) {
            // Reconcile missing index
            userAgentsStore
              ?.addAgent(payload.platform, payload.userId, agentId)
              .catch(() => {
                /* best-effort reconciliation */
              });
            return true;
          }
          if (metadata?.isWorkspaceAgent) return true;
        }
        return false;
      };

      authRouter.post("/:provider/save-key", async (c: any) => {
        try {
          const providerId = c.req.param("provider");
          const mod = getModelProviderModules().find(
            (m) => m.providerId === providerId
          );
          if (!mod) return c.json({ error: "Unknown provider" }, 404);

          const body = await c.req.json();
          c.__parsedBody = body;
          const { agentId, apiKey } = body;
          if (!agentId || !apiKey) {
            return c.json({ error: "Missing agentId or apiKey" }, 400);
          }

          if (!(await verifyProviderAuth(c, agentId))) {
            return c.json({ error: "Unauthorized" }, 401);
          }

          await authProfilesManager.upsertProfile({
            agentId,
            provider: providerId,
            credential: apiKey,
            authType: "api-key",
            label: createAuthProfileLabel(mod.providerDisplayName, apiKey),
            makePrimary: true,
          });

          return c.json({ success: true });
        } catch (error) {
          logger.error("Failed to save API key", { error });
          return c.json({ error: "Failed to save API key" }, 500);
        }
      });

      authRouter.post("/:provider/logout", async (c: any) => {
        try {
          const providerId = c.req.param("provider");
          const mod = getModelProviderModules().find(
            (m) => m.providerId === providerId
          );
          if (!mod) return c.json({ error: "Unknown provider" }, 404);

          const body = await c.req.json().catch(() => ({}));
          c.__parsedBody = body;
          const agentId = body.agentId || c.req.query("agentId");

          if (!agentId) {
            return c.json({ error: "Missing agentId" }, 400);
          }

          if (!(await verifyProviderAuth(c, agentId))) {
            return c.json({ error: "Unauthorized" }, 401);
          }

          await authProfilesManager.deleteProviderProfiles(
            agentId,
            providerId,
            body.profileId
          );

          return c.json({ success: true });
        } catch (error) {
          logger.error("Failed to logout", { error });
          return c.json({ error: "Failed to logout" }, 500);
        }
      });
    }

    for (const mod of providerModules) {
      if (mod.getApp) {
        authRouter.route(`/${mod.providerId}`, mod.getApp());
        registeredProviders.push(mod.providerId);
      }
    }

    const mcpOAuthModule = coreServices.getMcpOAuthModule();
    if (mcpOAuthModule) {
      authRouter.route("/mcp", mcpOAuthModule.getApp());
      registeredProviders.push("mcp");
    }

    // Integration OAuth + internal routes
    const integrationConfigService = coreServices.getIntegrationConfigService();
    const integrationCredentialStore =
      coreServices.getIntegrationCredentialStore();
    const integrationOAuthModule = coreServices.getIntegrationOAuthModule();

    if (
      integrationConfigService &&
      integrationCredentialStore &&
      integrationOAuthModule
    ) {
      // Internal routes for workers (list, connect, disconnect)
      const { createIntegrationRoutes } = require("../auth/integration/routes");
      const publicGatewayUrl = coreServices.getPublicGatewayUrl();
      const integrationRouter = createIntegrationRoutes(
        integrationConfigService,
        integrationCredentialStore,
        integrationOAuthModule,
        publicGatewayUrl,
        interactionService,
        coreServices.getAgentSettingsStore()
      );
      app.route("", integrationRouter);

      // API proxy (credential injection + forwarding)
      const {
        createIntegrationApiProxy,
      } = require("../auth/integration/api-proxy");
      const apiProxyRouter = createIntegrationApiProxy(
        integrationConfigService,
        integrationCredentialStore
      );
      app.route("", apiProxyRouter);

      // OAuth routes (public, for user browser redirects)
      authRouter.route("/integration", integrationOAuthModule.getApp());
      registeredProviders.push("integration");

      logger.info(
        "Integration routes enabled at :8080/internal/integrations/*, :8080/api/v1/auth/integration/*"
      );
    }

    // Get shared dependencies (needed before mounting auth router)
    const agentSettingsStore = coreServices.getAgentSettingsStore();
    const claudeOAuthStateStore = coreServices.getClaudeOAuthStateStore();
    const scheduledWakeupService = coreServices.getScheduledWakeupService();

    // Build provider stores and overrides dynamically from registered modules
    const providerStores: Record<
      string,
      { hasCredentials(agentId: string): Promise<boolean> }
    > = {};
    const providerConnectedOverrides: Record<string, boolean> = {};
    for (const mod of providerModules) {
      providerStores[mod.providerId] = mod;
      providerConnectedOverrides[mod.providerId] = mod.hasSystemKey();
    }

    // Settings HTML page
    if (agentSettingsStore) {
      const { createSettingsPageRoutes } = require("../routes/public/settings");
      const settingsPageRouter = createSettingsPageRoutes({
        agentSettingsStore,
        userAgentsStore: coreServices.getUserAgentsStore(),
        agentMetadataStore: coreServices.getAgentMetadataStore(),
        channelBindingService: coreServices.getChannelBindingService(),
        integrationConfigService: coreServices.getIntegrationConfigService(),
        integrationCredentialStore:
          coreServices.getIntegrationCredentialStore(),
        connectionManager: coreServices
          .getWorkerGateway()
          ?.getConnectionManager(),
        systemSkillsService: coreServices.getSystemSkillsService(),
      });
      app.route("", settingsPageRouter);
      logger.info("Settings HTML page enabled at :8080/settings");
    }

    // Landing page (docs + integrations)
    {
      const { createLandingRoutes } = require("../routes/public/landing");
      const landingRouter = createLandingRoutes({
        publicGatewayUrl: coreServices.getPublicGatewayUrl(),
        githubUrl: "https://github.com/lobu-ai/lobu",
      });
      app.route("", landingRouter);
      logger.info("Landing page enabled at :8080/");
    }

    // Agent history routes (proxy to worker HTTP server)
    {
      const connectionManager = coreServices
        .getWorkerGateway()
        ?.getConnectionManager();
      if (connectionManager) {
        const {
          createAgentHistoryRoutes,
        } = require("../routes/public/agent-history");
        const agentHistoryRouter = createAgentHistoryRoutes({
          connectionManager,
        });
        app.route("/api/v1/agents/:agentId/history", agentHistoryRouter);
        logger.info(
          "Agent history routes enabled at :8080/api/v1/agents/{agentId}/history/*"
        );

        // History HTML page
        const { renderHistoryPage } = require("../routes/public/history-page");
        const {
          verifySettingsSession,
        } = require("../routes/public/settings-auth");
        app.get("/agent/:agentId/history", (c: any) => {
          const session = verifySettingsSession(c);
          if (!session) {
            return c.redirect("/settings");
          }
          const agentId = c.req.param("agentId");
          return c.html(renderHistoryPage(agentId));
        });
        logger.info("History page enabled at :8080/agent/{agentId}/history");
      }
    }

    // Agent config routes (/api/v1/agents/{id}/config)
    if (agentSettingsStore) {
      const {
        createAgentConfigRoutes,
      } = require("../routes/public/agent-config");

      const agentConfigRouter = createAgentConfigRoutes({
        agentSettingsStore,
        userAgentsStore: coreServices.getUserAgentsStore(),
        agentMetadataStore: coreServices.getAgentMetadataStore(),
        queue: coreServices.getQueue(),
        providerStores:
          Object.keys(providerStores).length > 0 ? providerStores : undefined,
        providerConnectedOverrides,
        providerCatalogService: coreServices.getProviderCatalogService(),
        authProfilesManager: coreServices.getAuthProfilesManager(),
        connectionManager: coreServices
          .getWorkerGateway()
          ?.getConnectionManager(),
        grantStore: coreServices.getGrantStore(),
      });
      app.route("/api/v1/agents/:agentId/config", agentConfigRouter);
      logger.info(
        "Agent config routes enabled at :8080/api/v1/agents/{id}/config"
      );
    }

    // Agent schedules routes (/api/v1/agents/{id}/schedules)
    {
      const {
        createAgentSchedulesRoutes,
      } = require("../routes/public/agent-schedules");
      const agentSchedulesRouter = createAgentSchedulesRoutes({
        scheduledWakeupService,
        userAgentsStore: coreServices.getUserAgentsStore(),
        agentMetadataStore: coreServices.getAgentMetadataStore(),
      });
      app.route("/api/v1/agents/:agentId/schedules", agentSchedulesRouter);
      logger.info(
        "Agent schedules routes enabled at :8080/api/v1/agents/{id}/schedules"
      );
    }

    // Integrations routes (unified skills + MCP registry)
    {
      const {
        createIntegrationsRoutes,
      } = require("../routes/public/integrations");
      const integrationsRouter = createIntegrationsRoutes();
      app.route("/api/v1/integrations", integrationsRouter);
      logger.info("Integrations routes enabled at :8080/api/v1/integrations/*");
    }

    // OAuth routes (mounted under unified auth router)
    if (agentSettingsStore) {
      const { createOAuthRoutes } = require("../routes/public/oauth");
      const { ClaudeOAuthClient } = require("../auth/oauth/claude-client");
      const claudeOAuthClient = new ClaudeOAuthClient();
      const oauthRouter = createOAuthRoutes({
        providerStores:
          Object.keys(providerStores).length > 0 ? providerStores : undefined,
        oauthClients: { claude: claudeOAuthClient },
        oauthStateStore: claudeOAuthStateStore,
      });
      authRouter.route("", oauthRouter);
      registeredProviders.push("oauth");
    }

    // Mount unified auth router (includes provider modules + OAuth)
    if (registeredProviders.length > 0) {
      app.route("/api/v1/auth", authRouter);
      logger.info(
        `Auth routes enabled at :8080/api/v1/auth/* for: ${registeredProviders.join(", ")}`
      );
    }

    // Channel binding routes (mount under agent API)
    const channelBindingService = coreServices.getChannelBindingService();
    if (channelBindingService) {
      const {
        createChannelBindingRoutes,
      } = require("../routes/public/channels");
      const channelBindingRouter = createChannelBindingRoutes({
        channelBindingService,
        userAgentsStore: coreServices.getUserAgentsStore(),
        agentMetadataStore: coreServices.getAgentMetadataStore(),
      });
      // Mount as a sub-router under /api/v1/agents/:agentId/channels
      app.route("/api/v1/agents/:agentId/channels", channelBindingRouter);
      logger.info(
        "Channel binding routes enabled at :8080/api/v1/agents/{agentId}/channels/*"
      );
    }

    // Agent management routes (separate from Agent API's /api/v1/agents)
    {
      const userAgentsStore = coreServices.getUserAgentsStore();
      const agentMetadataStore = coreServices.getAgentMetadataStore();
      const { createAgentRoutes } = require("../routes/public/agents");
      const agentManagementRouter = createAgentRoutes({
        userAgentsStore,
        agentMetadataStore,
        agentSettingsStore,
        channelBindingService,
      });
      app.route("/api/v1/manage/agents", agentManagementRouter);
      logger.info(
        "Agent management routes enabled at :8080/api/v1/manage/agents/*"
      );
    }

    // Agent selector is now handled by the unified settings page (/settings)
  }

  // Auto-register any non-openapi routes so everything shows up in the schema
  registerAutoOpenApiRoutes(app);

  // OpenAPI Documentation
  app.doc("/api/docs/openapi.json", {
    openapi: "3.0.0",
    info: {
      title: "Lobu API",
      version: "1.0.0",
      description: `
## Overview

The Lobu API allows you to create and interact with AI agents programmatically.

## Authentication

1. Create an agent with \`POST /api/v1/agents\` to get a token
2. Use the token as a Bearer token for all subsequent requests

## Quick Start

\`\`\`bash
# 1. Create an agent
curl -X POST http://localhost:8080/api/v1/agents \\
  -H "Content-Type: application/json" \\
  -d '{"provider": "claude"}'

# 2. Send a message (use token from step 1)
curl -X POST http://localhost:8080/api/v1/agents/{agentId}/messages \\
  -H "Authorization: Bearer {token}" \\
  -H "Content-Type: application/json" \\
  -d '{"content": "Hello!"}'
\`\`\`

## MCP Servers

Agents can be configured with custom MCP (Model Context Protocol) servers:

\`\`\`json
{
  "mcpServers": {
    "my-http-mcp": { "url": "https://my-mcp.com/sse" },
    "my-stdio-mcp": { "command": "npx", "args": ["-y", "@org/mcp"] }
  }
}
\`\`\`
      `,
    },
    tags: [
      {
        name: "Agents",
        description:
          "Create, manage, and configure AI agents. Includes config (model, network, env vars) and schedules (wakeups, reminders).",
      },
      {
        name: "Agent Messages",
        description:
          "Send messages to agents and handle pending tool interactions.",
      },
      {
        name: "Channels",
        description:
          "Bind agents to platform channels (Slack, Telegram). Messages from bound channels are routed to the agent.",
      },
      {
        name: "Messaging",
        description:
          "Send messages through platform adapters (Slack, Telegram, API).",
      },
      {
        name: "Auth",
        description:
          "Authentication flows — API key, OAuth code exchange, device code for Claude and other providers.",
      },
      {
        name: "Webhooks",
        description: "Platform webhook endpoints (Telegram, Slack OAuth).",
      },
      {
        name: "Integrations",
        description:
          "Browse and manage skills, MCP servers, and other integrations.",
      },
      {
        name: "Settings",
        description: "Settings page session management.",
      },
      {
        name: "System",
        description: "Health checks, metrics, and system status.",
      },
    ],
    servers: [
      { url: "http://localhost:8080", description: "Local development" },
    ],
  });

  app.get(
    "/api/docs",
    apiReference({
      url: "/api/docs/openapi.json",
      theme: "kepler",
      layout: "modern",
      defaultHttpClient: { targetKey: "js", clientKey: "fetch" },
    })
  );
  logger.info("API docs enabled at :8080/api/docs");

  // Start the server — single port for everything
  const port = 8080;
  const honoListener = getRequestListener(app.fetch);

  httpServer = createServer((incoming, outgoing) => {
    // Route Slack event webhooks to the Bolt Express receiver
    if (slackExpressApp && incoming.url?.startsWith("/slack/events")) {
      slackExpressApp(incoming, outgoing);
      return;
    }
    // Everything else goes through Hono
    honoListener(incoming, outgoing);
  });

  httpServer.listen(port);
  logger.info(`Server listening on port ${port}`);
}

/**
 * Handle Express-style handler with Hono context
 */
async function handleExpressHandler(c: any, handler: any): Promise<Response> {
  const { req, res, responsePromise } = createExpressCompatObjects(c);
  await handler(req, res);
  return responsePromise;
}

/**
 * Create Express-compatible request/response objects from Hono context
 */
function createExpressCompatObjects(c: any, overridePath?: string) {
  let resolveResponse: (response: Response) => void;
  const responsePromise = new Promise<Response>((resolve) => {
    resolveResponse = resolve;
  });

  const url = new URL(c.req.url);
  const headers: Record<string, string> = {};
  c.req.raw.headers.forEach((value: string, key: string) => {
    headers[key] = value;
  });

  // Express-compatible request object
  const req: any = {
    method: c.req.method,
    url: c.req.url,
    path: overridePath || url.pathname,
    headers,
    query: Object.fromEntries(url.searchParams),
    params: c.req.param() || {},
    body: null,
    get: (name: string) => headers[name.toLowerCase()],
    on: () => {
      // Express event listener stub - not used in Hono compat layer
    },
  };

  // Response state
  let statusCode = 200;
  const responseHeaders = new Headers();
  let isStreaming = false;
  let streamController: ReadableStreamDefaultController<Uint8Array> | null =
    null;

  // Express-compatible response object
  const res: any = {
    statusCode: 200,
    destroyed: false,
    writableEnded: false,

    status(code: number) {
      statusCode = code;
      this.statusCode = code;
      return this;
    },

    setHeader(name: string, value: string) {
      responseHeaders.set(name, value);
      return this;
    },

    set(name: string, value: string) {
      responseHeaders.set(name, value);
      return this;
    },

    json(data: any) {
      responseHeaders.set("Content-Type", "application/json");
      resolveResponse?.(
        new Response(JSON.stringify(data), {
          status: statusCode,
          headers: responseHeaders,
        })
      );
    },

    send(data: any) {
      resolveResponse?.(
        new Response(data, {
          status: statusCode,
          headers: responseHeaders,
        })
      );
    },

    text(data: string) {
      resolveResponse?.(
        new Response(data, {
          status: statusCode,
          headers: responseHeaders,
        })
      );
    },

    end(data?: any) {
      this.writableEnded = true;
      if (isStreaming && streamController) {
        if (data) {
          streamController.enqueue(
            typeof data === "string" ? new TextEncoder().encode(data) : data
          );
        }
        streamController.close();
      } else {
        resolveResponse?.(
          new Response(data || null, {
            status: statusCode,
            headers: responseHeaders,
          })
        );
      }
    },

    write(chunk: any) {
      if (!isStreaming) {
        isStreaming = true;
        const stream = new ReadableStream({
          start(controller) {
            streamController = controller;
            if (chunk) {
              controller.enqueue(
                typeof chunk === "string"
                  ? new TextEncoder().encode(chunk)
                  : chunk
              );
            }
          },
        });
        resolveResponse?.(
          new Response(stream, {
            status: statusCode,
            headers: responseHeaders,
          })
        );
      } else if (streamController) {
        streamController.enqueue(
          typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk
        );
      }
      return true;
    },

    flushHeaders() {
      // No-op for compatibility
    },
  };

  // Parse body for POST/PUT/PATCH
  if (["POST", "PUT", "PATCH"].includes(c.req.method)) {
    const contentType = c.req.header("content-type") || "";
    c.req.raw
      .clone()
      .arrayBuffer()
      .then((buffer: ArrayBuffer) => {
        if (contentType.includes("application/json")) {
          try {
            req.body = JSON.parse(new TextDecoder().decode(buffer));
          } catch {
            req.body = buffer;
          }
        } else {
          req.body = buffer;
        }
      });
  }

  return { req, res, responsePromise };
}

/**
 * Create Express-like adapter for compatibility with module registry
 */
function createExpressAdapter(honoApp: any) {
  return {
    get: (path: string, ...handlers: any[]) => {
      const handler = handlers[handlers.length - 1];
      honoApp.get(path, (c: any) => handleExpressHandler(c, handler));
    },
    post: (path: string, ...handlers: any[]) => {
      const handler = handlers[handlers.length - 1];
      honoApp.post(path, (c: any) => handleExpressHandler(c, handler));
    },
    put: (path: string, ...handlers: any[]) => {
      const handler = handlers[handlers.length - 1];
      honoApp.put(path, (c: any) => handleExpressHandler(c, handler));
    },
    delete: (path: string, ...handlers: any[]) => {
      const handler = handlers[handlers.length - 1];
      honoApp.delete(path, (c: any) => handleExpressHandler(c, handler));
    },
    use: (pathOrHandler: any, handler?: any) => {
      if (typeof pathOrHandler === "function") {
        // Global middleware - skip for now
      } else if (handler) {
        honoApp.all(`${pathOrHandler}/*`, (c: any) =>
          handleExpressHandler(c, handler)
        );
      }
    },
  };
}

/**
 * Start the gateway with the provided configuration
 */
export async function startGateway(
  config: GatewayConfig,
  slackConfig: SlackConfig | null,
  whatsappConfig?: WhatsAppConfig | null,
  telegramConfig?: TelegramConfig | null
): Promise<void> {
  logger.info("Starting Lobu Gateway");

  // Start filtering proxy for worker network isolation (if enabled)
  const { startFilteringProxy } = await import("../proxy/proxy-manager");
  await startFilteringProxy();

  // Import dependencies
  const { Orchestrator } = await import("../orchestration");
  const { Gateway } = await import("../gateway-main");

  // Create and start orchestrator
  logger.debug("Creating orchestrator", { mode: process.env.DEPLOYMENT_MODE });
  const orchestrator = new Orchestrator(config.orchestration);
  await orchestrator.start();
  logger.info("Orchestrator started");

  // Create Gateway
  const gateway = new Gateway(config);

  const agentOptions = {
    allowedTools: config.agentDefaults.allowedTools,
    disallowedTools: config.agentDefaults.disallowedTools,
    runtime: config.agentDefaults.runtime,
    model: config.agentDefaults.model,
    timeoutMinutes: config.agentDefaults.timeoutMinutes,
    pluginsConfig: config.agentDefaults.pluginsConfig,
  };

  // Register Slack platform if configured
  let slackPlatform: any = null;
  if (slackConfig) {
    const { SlackPlatform } = await import("../slack");

    const slackPlatformConfig = {
      slack: slackConfig,
      logLevel: config.logLevel as any,
      health: config.health,
    };

    slackPlatform = new SlackPlatform(
      slackPlatformConfig,
      agentOptions,
      config.sessionTimeoutMinutes
    );
    gateway.registerPlatform(slackPlatform);
    logger.info("Slack platform registered");
  }

  // Register WhatsApp platform if enabled
  let whatsappPlatform: any = null;
  logger.debug("WhatsApp config", { enabled: whatsappConfig?.enabled });
  if (whatsappConfig?.enabled) {
    const { WhatsAppPlatform } = await import("../whatsapp");

    const whatsappPlatformConfig = {
      whatsapp: whatsappConfig,
    };

    whatsappPlatform = new WhatsAppPlatform(
      whatsappPlatformConfig,
      agentOptions,
      config.sessionTimeoutMinutes
    );
    gateway.registerPlatform(whatsappPlatform);
    logger.info("WhatsApp platform registered");
  }

  // Register Telegram platform if enabled
  let telegramPlatform: any = null;
  logger.debug("Telegram config", { enabled: telegramConfig?.enabled });
  if (telegramConfig?.enabled) {
    const { TelegramPlatform } = await import("../telegram");

    const telegramPlatformConfig = {
      telegram: telegramConfig,
    };

    telegramPlatform = new TelegramPlatform(
      telegramPlatformConfig,
      agentOptions,
      config.sessionTimeoutMinutes
    );
    gateway.registerPlatform(telegramPlatform);
    logger.info("Telegram platform registered");
  }

  // Register API platform (always enabled)
  const { ApiPlatform } = await import("../api");
  const apiPlatform = new ApiPlatform();
  gateway.registerPlatform(apiPlatform);
  logger.info("API platform registered");

  // Start gateway
  await gateway.start();
  logger.info("Gateway started");

  // Get core services
  const coreServices = gateway.getCoreServices();

  // Wire grant store to HTTP proxy for domain grant checks
  const grantStore = coreServices.getGrantStore();
  if (grantStore) {
    const { setProxyGrantStore } = await import("../proxy/http-proxy");
    setProxyGrantStore(grantStore);
    logger.info("Grant store connected to HTTP proxy");
  }

  // Inject core services into orchestrator (provider modules carry their own credential stores)
  await orchestrator.injectCoreServices(
    coreServices.getQueue().getRedisClient(),
    coreServices.getProviderCatalogService(),
    coreServices.getGrantStore() ?? undefined
  );
  logger.info("Orchestrator configured with core services");

  // Setup server on port 8080 (single port for all HTTP traffic)
  setupServer(
    coreServices.getSecretProxy(),
    coreServices.getWorkerGateway(),
    coreServices.getMcpProxy(),
    coreServices.getInteractionService(),
    gateway.getPlatformRegistry(),
    coreServices,
    telegramPlatform,
    slackPlatform?.getExpressApp()
  );

  logger.info("Lobu Gateway is running!");

  // Setup graceful shutdown
  const cleanup = async () => {
    logger.info("Shutting down gateway...");

    // Hard deadline: force exit after 30s if graceful shutdown stalls
    const hardDeadline = setTimeout(() => {
      logger.error("Graceful shutdown timed out after 30s, forcing exit");
      process.exit(1);
    }, 30_000);
    hardDeadline.unref();

    await orchestrator.stop();
    await gateway.stop();
    if (httpServer) {
      httpServer.close();
    }
    logger.info("Gateway shutdown complete");
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  process.on("SIGUSR1", () => {
    const status = gateway.getStatus();
    logger.info("Health check:", JSON.stringify(status, null, 2));
  });
}
