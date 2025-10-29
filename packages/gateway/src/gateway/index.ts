#!/usr/bin/env bun

import type { InstructionContext, WorkerTokenData } from "@peerbot/core";
import { createLogger, verifyWorkerToken } from "@peerbot/core";
import type { Request, Response } from "express";
import type { McpConfigService } from "../auth/mcp/config-service";
import type { IMessageQueue } from "../infrastructure/queue";
import type { ISessionManager } from "../session";
import type { InstructionService } from "../services/instruction-service";
import { WorkerConnectionManager } from "./connection-manager";
import { WorkerJobRouter } from "./job-router";

const logger = createLogger("worker-gateway");

/**
 * Worker Gateway - SSE and HTTP endpoints for worker communication
 * Workers connect via SSE to receive jobs, send responses via HTTP POST
 * Uses encrypted tokens for authentication and routing
 */
export class WorkerGateway {
  private connectionManager: WorkerConnectionManager;
  private jobRouter: WorkerJobRouter;
  private queue: IMessageQueue;
  private mcpConfigService?: McpConfigService;
  private instructionService?: InstructionService;
  private publicGatewayUrl: string;

  constructor(
    queue: IMessageQueue,
    publicGatewayUrl: string,
    sessionManager: ISessionManager,
    mcpConfigService?: McpConfigService,
    instructionService?: InstructionService
  ) {
    this.queue = queue;
    this.publicGatewayUrl = publicGatewayUrl;
    this.connectionManager = new WorkerConnectionManager();
    this.jobRouter = new WorkerJobRouter(
      queue,
      this.connectionManager,
      sessionManager
    );
    this.mcpConfigService = mcpConfigService;
    this.instructionService = instructionService;
  }

  /**
   * Setup routes on Express app
   */
  setupRoutes(app: any) {
    // SSE endpoint for workers to receive jobs
    app.get("/worker/stream", (req: Request, res: Response) =>
      this.handleStreamConnection(req, res)
    );

    // HTTP POST endpoint for workers to send responses
    app.post("/worker/response", (req: Request, res: Response) =>
      this.handleWorkerResponse(req, res)
    );

    // Unified session context endpoint (includes MCP + instructions)
    app.get("/worker/session-context", (req: Request, res: Response) =>
      this.handleSessionContextRequest(req, res)
    );

    logger.info("Worker gateway routes registered");
  }

  /**
   * Handle SSE connection from worker
   */
  private async handleStreamConnection(req: Request, res: Response) {
    const auth = this.authenticateWorker(req, res);
    if (!auth) {
      return;
    }

    const { deploymentName, userId, threadId } = auth.tokenData;

    // Setup SSE
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    // Register connection with connection manager
    this.connectionManager.addConnection(deploymentName, userId, threadId, res);

    // Register job router for this worker (idempotent - safe to call multiple times)
    await this.jobRouter.registerWorker(deploymentName);

    // Handle client disconnect
    req.on("close", () => {
      this.connectionManager.removeConnection(deploymentName);
      // BullMQ worker remains registered - will resume when worker reconnects
    });
  }

  /**
   * Handle HTTP response from worker
   */
  private async handleWorkerResponse(req: Request, res: Response) {
    const auth = this.authenticateWorker(req, res);
    if (!auth) {
      return;
    }

    const { deploymentName } = auth.tokenData;

    // Update connection activity
    this.connectionManager.touchConnection(deploymentName);

    try {
      const { jobId, ...responseData } = req.body;

      // Acknowledge job completion if jobId provided
      if (jobId) {
        this.jobRouter.acknowledgeJob(jobId);
      }

      // Log for debugging
      logger.info(
        `[WORKER-GATEWAY] Received response with fields: ${Object.keys(responseData).join(", ")}`
      );
      if (responseData.isStreamDelta) {
        logger.info(
          `[WORKER-GATEWAY] Stream delta: deltaLength=${responseData.delta?.length}`
        );
      }

      // Send response to thread_response queue
      await this.queue.send("thread_response", responseData);

      res.json({ success: true });
    } catch (error) {
      logger.error(`Error handling worker response: ${error}`);
      res.status(500).json({ error: "Failed to process response" });
    }
  }

  /**
   * Unified session context endpoint
   * Returns MCP config, platform instructions, and MCP status data
   * Worker builds final instructions from this data
   */
  private async handleSessionContextRequest(req: Request, res: Response) {
    if (!this.mcpConfigService || !this.instructionService) {
      res.status(503).json({ error: "session_context_unavailable" });
      return;
    }

    const auth = this.authenticateWorker(req, res);
    if (!auth) {
      return;
    }

    try {
      const { userId, platform, sessionKey } = auth.tokenData;
      const baseUrl = this.getRequestBaseUrl(req);

      // Build instruction context
      const instructionContext: InstructionContext = {
        userId,
        sessionKey: sessionKey || "", // Use empty string if sessionKey is undefined
        workingDirectory: "/workspace",
        availableProjects: [],
      };

      // Fetch MCP config and session context data in parallel
      const [mcpConfig, contextData] = await Promise.all([
        this.mcpConfigService.getWorkerConfig({
          baseUrl,
          workerToken: auth.token,
        }),
        this.instructionService.getSessionContext(
          platform || "unknown",
          instructionContext
        ),
      ]);

      logger.info(
        `Session context for ${userId}: ${Object.keys(mcpConfig.mcpServers || {}).length} MCPs, ${contextData.platformInstructions.length} chars platform instructions, ${contextData.mcpStatus.length} MCP status entries`
      );

      res.json({
        mcpConfig,
        platformInstructions: contextData.platformInstructions,
        mcpStatus: contextData.mcpStatus,
      });
    } catch (error) {
      logger.error("Failed to generate session context", { error });
      res.status(500).json({ error: "session_context_error" });
    }
  }

  private authenticateWorker(
    req: Request,
    res: Response
  ): { tokenData: WorkerTokenData; token: string } | null {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res
        .status(401)
        .json({ error: "Missing or invalid authorization header" });
      return null;
    }

    const token = authHeader.substring(7);
    const tokenData = verifyWorkerToken(token);

    if (!tokenData) {
      logger.warn("Invalid token");
      res.status(401).json({ error: "Invalid token" });
      return null;
    }

    return { tokenData, token };
  }

  private getRequestBaseUrl(req: Request): string {
    const forwardedProto = req.headers["x-forwarded-proto"];
    const protocolCandidate = Array.isArray(forwardedProto)
      ? forwardedProto[0]
      : forwardedProto?.split(",")[0];
    const protocol = (protocolCandidate || req.protocol || "http").trim();
    const host = req.get("host");
    if (host) {
      return `${protocol}://${host}`;
    }
    return this.publicGatewayUrl;
  }

  /**
   * Get active worker connections
   */
  getActiveConnections(): string[] {
    return this.connectionManager.getActiveConnections();
  }

  /**
   * Shutdown gateway
   */
  shutdown(): void {
    this.connectionManager.shutdown();
    this.jobRouter.shutdown();
  }
}
