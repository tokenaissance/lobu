#!/usr/bin/env bun

import type { InstructionContext, WorkerTokenData } from "@lobu/core";
import { createLogger, verifyWorkerToken } from "@lobu/core";
import type { Context } from "hono";
import { Hono } from "hono";
import { stream } from "hono/streaming";
import type { McpConfigService } from "../auth/mcp/config-service";
import type { McpProxy } from "../auth/mcp/proxy";
import type { McpTool } from "../auth/mcp/tool-cache";
import type { IMessageQueue } from "../infrastructure/queue";
import type { InstructionService } from "../services/instruction-service";
import type { ISessionManager } from "../session";
import { type SSEWriter, WorkerConnectionManager } from "./connection-manager";
import { WorkerJobRouter } from "./job-router";

const logger = createLogger("worker-gateway");

/**
 * Worker Gateway - SSE and HTTP endpoints for worker communication
 * Workers connect via SSE to receive jobs, send responses via HTTP POST
 * Uses encrypted tokens for authentication and routing
 */
export class WorkerGateway {
  private app: Hono;
  private connectionManager: WorkerConnectionManager;
  private jobRouter: WorkerJobRouter;
  private queue: IMessageQueue;
  private mcpConfigService: McpConfigService;
  private instructionService: InstructionService;
  private publicGatewayUrl: string;
  private mcpProxy?: McpProxy;

  constructor(
    queue: IMessageQueue,
    publicGatewayUrl: string,
    sessionManager: ISessionManager,
    mcpConfigService: McpConfigService,
    instructionService: InstructionService,
    mcpProxy?: McpProxy
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
    this.mcpProxy = mcpProxy;

    // Setup Hono app
    this.app = new Hono();
    this.setupRoutes();
  }

  /**
   * Get the Hono app
   */
  getApp(): Hono {
    return this.app;
  }

  /**
   * Setup routes on Hono app
   */
  private setupRoutes() {
    // SSE endpoint for workers to receive jobs
    // Routes are mounted at /worker, so paths here should be relative
    this.app.get("/stream", (c) => this.handleStreamConnection(c));

    // HTTP POST endpoint for workers to send responses
    this.app.post("/response", (c) => this.handleWorkerResponse(c));

    // Unified session context endpoint (includes MCP + instructions)
    this.app.get("/session-context", (c) =>
      this.handleSessionContextRequest(c)
    );

    logger.info("Worker gateway routes registered");
  }

  /**
   * Handle SSE connection from worker
   */
  private async handleStreamConnection(c: Context): Promise<Response> {
    const auth = this.authenticateWorker(c);
    if (!auth) {
      return c.json({ error: "Invalid token" }, 401);
    }

    const { deploymentName, userId, conversationId } = auth.tokenData as any;
    if (!conversationId) {
      return c.json({ error: "Invalid token (missing conversationId)" }, 401);
    }

    // Create an SSE stream
    return stream(c, async (streamWriter) => {
      // Create an SSE writer adapter
      const sseWriter: SSEWriter = {
        write: (data: string): boolean => {
          try {
            streamWriter.write(data);
            return true;
          } catch {
            return false;
          }
        },
        end: () => {
          try {
            streamWriter.close();
          } catch {
            // Already closed
          }
        },
        onClose: (callback: () => void) => {
          // Handle abort signal
          c.req.raw.signal.addEventListener("abort", callback);
        },
      };

      // Set SSE headers
      c.header("Content-Type", "text/event-stream");
      c.header("Cache-Control", "no-cache");
      c.header("Connection", "keep-alive");
      c.header("X-Accel-Buffering", "no");

      // Register connection with connection manager
      this.connectionManager.addConnection(
        deploymentName,
        userId,
        conversationId,
        sseWriter
      );

      // Register BullMQ worker for this deployment
      await this.jobRouter.registerWorker(deploymentName);
      await this.jobRouter.resumeWorker(deploymentName);

      // Handle client disconnect
      sseWriter.onClose(() => {
        this.jobRouter.pauseWorker(deploymentName).catch((err) => {
          logger.error(`Failed to pause worker ${deploymentName}:`, err);
        });
        this.connectionManager.removeConnection(deploymentName);
      });

      // Keep the connection open until client disconnects
      await new Promise<void>((resolve) => {
        c.req.raw.signal.addEventListener("abort", () => resolve());
      });
    });
  }

  /**
   * Handle HTTP response from worker
   */
  private async handleWorkerResponse(c: Context): Promise<Response> {
    const auth = this.authenticateWorker(c);
    if (!auth) {
      return c.json({ error: "Invalid token" }, 401);
    }

    const { deploymentName } = auth.tokenData;

    // Update connection activity
    this.connectionManager.touchConnection(deploymentName);

    try {
      const body = await c.req.json();
      const { jobId, ...responseData } = body;

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

      return c.json({ success: true });
    } catch (error) {
      logger.error(`Error handling worker response: ${error}`);
      return c.json({ error: "Failed to process response" }, 500);
    }
  }

  /**
   * Unified session context endpoint
   */
  private async handleSessionContextRequest(c: Context): Promise<Response> {
    if (!this.mcpConfigService || !this.instructionService) {
      return c.json({ error: "session_context_unavailable" }, 503);
    }

    const auth = this.authenticateWorker(c);
    if (!auth) {
      return c.json({ error: "Invalid token" }, 401);
    }

    try {
      const {
        userId,
        platform,
        sessionKey,
        conversationId,
        agentId,
        deploymentName,
      } = auth.tokenData;
      const baseUrl = this.getRequestBaseUrl(c);
      if (!conversationId) {
        return c.json({ error: "Invalid token (missing conversationId)" }, 401);
      }

      // Build instruction context
      const instructionContext: InstructionContext = {
        userId,
        agentId: agentId || "",
        sessionKey: sessionKey || "",
        workingDirectory: "/workspace",
        availableProjects: [],
      };

      // Fetch MCP config and session context in parallel
      const [mcpConfig, contextData] = await Promise.all([
        this.mcpConfigService.getWorkerConfig({
          baseUrl,
          workerToken: auth.token,
          deploymentName,
        }),
        this.instructionService.getSessionContext(
          platform || "unknown",
          instructionContext
        ),
      ]);

      // Fetch tool lists for authenticated MCPs
      const mcpTools: Record<string, McpTool[]> = {};
      if (this.mcpProxy && contextData.mcpStatus.length > 0) {
        const authenticatedMcps = contextData.mcpStatus.filter(
          (mcp) =>
            (!mcp.requiresAuth || mcp.authenticated) &&
            (!mcp.requiresInput || mcp.configured)
        );

        const toolResults = await Promise.allSettled(
          authenticatedMcps.map(async (mcp) => {
            const tools = await this.mcpProxy!.fetchToolsForMcp(
              mcp.id,
              agentId || userId,
              auth.tokenData
            );
            return { mcpId: mcp.id, tools };
          })
        );

        for (const result of toolResults) {
          if (result.status === "fulfilled" && result.value.tools.length > 0) {
            mcpTools[result.value.mcpId] = result.value.tools;
          }
        }
      }

      const wsFileCount = [
        contextData.workspaceFiles.identityMd,
        contextData.workspaceFiles.soulMd,
        contextData.workspaceFiles.userMd,
      ].filter(Boolean).length;
      logger.info(
        `Session context for ${userId}: ${Object.keys(mcpConfig.mcpServers || {}).length} MCPs, ${contextData.platformInstructions.length} chars platform instructions, ${contextData.networkInstructions.length} chars network instructions, ${wsFileCount} workspace files, ${contextData.enabledSkills.length} enabled skills, ${contextData.skillsInstructions.length} chars skills instructions, ${contextData.mcpStatus.length} MCP status entries, ${Object.keys(mcpTools).length} MCP tool lists`
      );

      return c.json({
        mcpConfig,
        platformInstructions: contextData.platformInstructions,
        networkInstructions: contextData.networkInstructions,
        workspaceFiles: contextData.workspaceFiles,
        enabledSkills: contextData.enabledSkills,
        skillsInstructions: contextData.skillsInstructions,
        mcpStatus: contextData.mcpStatus,
        mcpTools,
      });
    } catch (error) {
      logger.error("Failed to generate session context", { error });
      return c.json({ error: "session_context_error" }, 500);
    }
  }

  private authenticateWorker(
    c: Context
  ): { tokenData: WorkerTokenData; token: string } | null {
    const authHeader = c.req.header("authorization");

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return null;
    }

    const token = authHeader.substring(7);
    const tokenData = verifyWorkerToken(token);

    if (!tokenData) {
      logger.warn("Invalid token");
      return null;
    }

    return { tokenData, token };
  }

  private getRequestBaseUrl(c: Context): string {
    const forwardedProto = c.req.header("x-forwarded-proto");
    const protocolCandidate = Array.isArray(forwardedProto)
      ? forwardedProto[0]
      : forwardedProto?.split(",")[0];
    const protocol = (protocolCandidate || "http").trim();
    const host = c.req.header("host");
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
