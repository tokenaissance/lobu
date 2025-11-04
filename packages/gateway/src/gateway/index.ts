#!/usr/bin/env bun

import type { InstructionContext, WorkerTokenData } from "@peerbot/core";
import { createLogger, verifyWorkerToken } from "@peerbot/core";
import type { Request, Response } from "express";
import type { McpConfigService } from "../auth/mcp/config-service";
import type { IMessageQueue } from "../infrastructure/queue";
import type { InteractionService } from "../interactions";
import { generateDeploymentName } from "../orchestration/base-deployment-manager";
import type { InstructionService } from "../services/instruction-service";
import type { ISessionManager } from "../session";
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
  // TODO: why are they all optional? If possible we should use required fields everywhere. Remember that in AGENTS.md as well.
  private mcpConfigService?: McpConfigService;
  private instructionService?: InstructionService;
  private interactionService?: InteractionService;
  private publicGatewayUrl: string;

  constructor(
    queue: IMessageQueue,
    publicGatewayUrl: string,
    sessionManager: ISessionManager,
    mcpConfigService?: McpConfigService,
    instructionService?: InstructionService,
    interactionService?: InteractionService
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
    this.interactionService = interactionService;

    // Listen for interaction responses and forward to workers via SSE
    if (this.interactionService) {
      this.interactionService.on("interaction:responded", (interaction) => {
        this.handleInteractionResponse(interaction).catch((error) => {
          logger.error("Error handling interaction response:", error);
        });
      });
    }
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
    res.setHeader("X-Accel-Buffering", "no"); // Disable nginx/proxy buffering
    res.flushHeaders();

    // Disable socket buffering for immediate delivery
    const socket = (res as any).socket || (res as any).connection;
    if (socket) {
      socket.setNoDelay(true); // Disable Nagle's algorithm
    }

    // Register connection with connection manager
    this.connectionManager.addConnection(deploymentName, userId, threadId, res);

    // Register job router for this worker (idempotent - safe to call multiple times)
    await this.jobRouter.registerWorker(deploymentName);

    // Send any pending interaction responses (for reconnection recovery)
    await this.sendPendingInteractionResponses(threadId, deploymentName);

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
      if (responseData.delta) {
        logger.info(
          `[WORKER-GATEWAY] Stream delta: deltaLength=${responseData.delta.length}`
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
      const { userId, platform, sessionKey, threadId } = auth.tokenData;
      const baseUrl = this.getRequestBaseUrl(req);

      // Build instruction context
      const instructionContext: InstructionContext = {
        userId,
        sessionKey: sessionKey || "", // Use empty string if sessionKey is undefined
        workingDirectory: "/workspace",
        availableProjects: [],
      };

      // Fetch MCP config, session context, and pending interactions in parallel
      const [mcpConfig, contextData, unansweredInteractions] =
        await Promise.all([
          this.mcpConfigService.getWorkerConfig({
            baseUrl,
            workerToken: auth.token,
          }),
          this.instructionService.getSessionContext(
            platform || "unknown",
            instructionContext
          ),
          this.interactionService?.getPendingUnansweredInteractions(threadId) ||
            Promise.resolve([]),
        ]);

      logger.info(
        `Session context for ${userId}: ${Object.keys(mcpConfig.mcpServers || {}).length} MCPs, ${contextData.platformInstructions.length} chars platform instructions, ${contextData.mcpStatus.length} MCP status entries, ${unansweredInteractions.length} unanswered interactions`
      );

      res.json({
        mcpConfig,
        platformInstructions: contextData.platformInstructions,
        mcpStatus: contextData.mcpStatus,
        unansweredInteractions,
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
   * Handle interaction response and send to worker via SSE
   * If worker is not connected, store response in Redis for later retrieval
   */
  private async handleInteractionResponse(interaction: any): Promise<void> {
    // Find the worker connection for this thread
    // Use the same deployment name generation as orchestrator
    const deploymentName = generateDeploymentName(
      interaction.userId,
      interaction.threadId
    );
    const connection = this.connectionManager.getConnection(deploymentName);

    if (!connection) {
      logger.warn(
        `No worker connection found for interaction ${interaction.id} (deployment: ${deploymentName}), storing in Redis`
      );
      await this.storeInteractionResponse(interaction);
      return;
    }

    // Send interaction response via SSE
    const success = this.connectionManager.sendSSE(
      connection.res,
      "interaction",
      {
        interactionId: interaction.id,
        interactionType: interaction.interactionType,
        response: interaction.response,
      }
    );

    if (success) {
      logger.info(
        `✅ Sent interaction response ${interaction.id} to worker ${deploymentName}`
      );
    } else {
      logger.error(
        `❌ Failed to send interaction response ${interaction.id} to worker ${deploymentName} - storing in Redis`
      );
      await this.storeInteractionResponse(interaction);
    }
  }

  /**
   * Store interaction response in Redis for later retrieval
   */
  private async storeInteractionResponse(interaction: any): Promise<void> {
    if (!this.interactionService) return;

    const key = `interaction:response:${interaction.threadId}:${interaction.id}`;
    const response = {
      interactionId: interaction.id,
      response: interaction.response,
    };

    // Store with 1 hour TTL
    const redis = (this.interactionService as any).redis;
    await redis.set(key, JSON.stringify(response), "EX", 3600);

    logger.info(
      `Stored interaction response ${interaction.id} in Redis for later delivery`
    );
  }

  /**
   * Send any pending interaction responses on reconnect
   */
  private async sendPendingInteractionResponses(
    threadId: string,
    deploymentName: string
  ): Promise<void> {
    if (!this.interactionService) return;

    const redis = (this.interactionService as any).redis;
    const pattern = `interaction:response:${threadId}:*`;
    const keys = await redis.keys(pattern);

    if (keys.length === 0) return;

    logger.info(
      `Found ${keys.length} pending interaction responses for thread ${threadId}`
    );

    const connection = this.connectionManager.getConnection(deploymentName);
    if (!connection) {
      logger.warn(
        `No connection found for ${deploymentName} to send pending responses`
      );
      return;
    }

    for (const key of keys) {
      const data = await redis.get(key);
      if (!data) continue;

      try {
        const responseData = JSON.parse(data);

        // Send via SSE
        const success = this.connectionManager.sendSSE(
          connection.res,
          "interaction",
          responseData
        );

        if (success) {
          logger.info(
            `✅ Sent pending interaction response ${responseData.interactionId}`
          );
          // Delete after successful delivery
          await redis.del(key);
        } else {
          logger.warn(
            `Failed to send pending response ${responseData.interactionId}, will retry on next reconnect`
          );
        }
      } catch (error) {
        logger.error(`Error sending pending interaction response:`, error);
      }
    }
  }

  /**
   * Shutdown gateway
   */
  shutdown(): void {
    this.connectionManager.shutdown();
    this.jobRouter.shutdown();
  }
}
