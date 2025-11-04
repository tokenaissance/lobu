#!/usr/bin/env bun

import http from "node:http";
import { createLogger } from "@peerbot/core";
import express from "express";
import type { GatewayConfig } from "../config";
import type { SlackConfig } from "../slack";

const logger = createLogger("gateway-startup");

let healthServer: http.Server | null = null;

/**
 * Setup health endpoints, proxy, and worker gateway on port 8080
 */
function setupHealthEndpoints(
  anthropicProxy: any,
  workerGateway: any,
  mcpProxy: any,
  fileHandler?: any,
  sessionManager?: any,
  interactionService?: any,
  platformRegistry?: any
) {
  if (healthServer) return;

  // Create Express app for proxy and health endpoints
  const proxyApp = express();

  // Add body parsing middleware for JSON and raw data
  proxyApp.use(express.json({ limit: "50mb" }));
  proxyApp.use(express.raw({ type: "application/json", limit: "50mb" }));

  // Health endpoints
  proxyApp.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      anthropicProxy: !!anthropicProxy,
    });
  });

  proxyApp.get("/ready", (_req, res) => {
    res.json({ ready: true });
  });

  // Add Anthropic proxy if provided
  if (anthropicProxy) {
    proxyApp.use("/api/anthropic", anthropicProxy.getRouter());
    logger.info("✅ Anthropic proxy enabled at :8080/api/anthropic");
  }

  // Add Worker Gateway routes if provided
  if (workerGateway) {
    workerGateway.setupRoutes(proxyApp);
    logger.info("✅ Worker gateway routes enabled at :8080/worker/*");
  }

  // Register module endpoints (must be before MCP proxy for OAuth routes)
  const { moduleRegistry } = require("@peerbot/core");
  moduleRegistry.registerEndpoints(proxyApp);
  logger.info("✅ Module endpoints registered");

  if (mcpProxy) {
    mcpProxy.setupRoutes(proxyApp);
    logger.info("✅ MCP proxy routes enabled at :8080/mcp/*");
  }

  // Setup file routes if file handler is provided
  if (fileHandler && sessionManager) {
    const { createFileRoutes } = require("../api/file-routes");
    const fileRoutes = createFileRoutes(fileHandler, sessionManager);
    proxyApp.use("/internal/files", fileRoutes);
    logger.info("✅ File routes enabled at :8080/internal/files/*");
  }

  // Setup interaction routes
  if (interactionService) {
    const { Router } = require("express");
    const interactionRouter = Router();
    const { registerInteractionRoutes } = require("../routes/interactions");
    const { verifyWorkerToken } = require("@peerbot/core");
    const authenticateWorker = (req: any, res: any, next: any) => {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res
          .status(401)
          .json({ error: "Missing or invalid authorization" });
      }
      const workerToken = authHeader.substring(7);
      const tokenData = verifyWorkerToken(workerToken);
      if (!tokenData) {
        return res.status(401).json({ error: "Invalid worker token" });
      }
      req.worker = tokenData;
      next();
    };
    registerInteractionRoutes(
      interactionRouter,
      interactionService,
      authenticateWorker
    );
    proxyApp.use(interactionRouter);
    logger.info(
      "✅ Interaction routes enabled at :8080/internal/interactions/* and /internal/suggestions/*"
    );
  }

  // Setup messaging routes
  if (platformRegistry) {
    const { Router } = require("express");
    const messagingRouter = Router();
    const { registerMessagingRoutes } = require("../routes/messaging");
    registerMessagingRoutes(messagingRouter, platformRegistry);
    proxyApp.use(messagingRouter);
    logger.info("✅ Messaging routes enabled at :8080/api/messaging/send");
  }

  // Create HTTP server with Express app
  healthServer = http.createServer(proxyApp);

  // Listen on port 8080 for health checks and proxy
  const healthPort = 8080;
  healthServer.listen(healthPort, () => {
    logger.info(
      `Health check and proxy server listening on port ${healthPort}`
    );
  });
}

/**
 * Start the gateway with the provided configuration
 */
export async function startGateway(
  config: GatewayConfig,
  slackConfig: SlackConfig
): Promise<void> {
  logger.info("🚀 Starting Peerbot Gateway");

  // Import dependencies (after config is loaded)
  const { Orchestrator } = await import("../orchestration");
  const { Gateway } = await import("../gateway-main");
  const { SlackPlatform } = await import("../slack");

  // Create and start orchestrator
  const orchestrator = new Orchestrator(config.orchestration);
  await orchestrator.start();
  logger.info("✅ Orchestrator started");

  // Create Gateway with Slack platform
  const gateway = new Gateway(config);

  // Construct Slack platform config
  const slackPlatformConfig = {
    slack: slackConfig,
    logLevel: config.logLevel as any, // Core LogLevel is compatible with Slack LogLevel
    health: config.health,
  };

  const agentOptions = {
    allowedTools: config.claude.allowedTools,
    disallowedTools: config.claude.disallowedTools,
    model: config.claude.model,
    timeoutMinutes: config.claude.timeoutMinutes,
  };

  const slackPlatform = new SlackPlatform(
    slackPlatformConfig,
    agentOptions,
    config.sessionTimeoutMinutes
  );
  gateway.registerPlatform(slackPlatform);

  // Start gateway (initializes core services + platforms)
  await gateway.start();
  logger.info("✅ Gateway started");

  // Get core services for health endpoints
  const coreServices = gateway.getCoreServices();

  // Inject core services into orchestrator for authentication checks
  await orchestrator.injectCoreServices(
    coreServices.getClaudeCredentialStore(),
    config.anthropicProxy.anthropicApiKey
  );
  logger.info("✅ Orchestrator configured with core services");

  // Get file handler from Slack platform (if available)
  const fileHandler = slackPlatform.getFileHandler();
  const sessionManager = coreServices.getSessionManager();

  // Setup health endpoints on port 8080
  setupHealthEndpoints(
    coreServices.getAnthropicProxy(),
    coreServices.getWorkerGateway(),
    coreServices.getMcpProxy(),
    fileHandler,
    sessionManager,
    coreServices.getInteractionService(),
    gateway.getPlatformRegistry()
  );

  logger.info("✅ Peerbot Gateway is running!");
  // Setup graceful shutdown
  const cleanup = async () => {
    logger.info("Shutting down gateway...");
    await orchestrator.stop();
    await gateway.stop();
    if (healthServer) {
      healthServer.close();
    }
    logger.info("Gateway shutdown complete");
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  // Handle health checks
  process.on("SIGUSR1", () => {
    const status = gateway.getStatus();
    logger.info("Health check:", JSON.stringify(status, null, 2));
  });
}
