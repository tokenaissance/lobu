#!/usr/bin/env bun

import type {
  ConfigProviderMeta,
  InstructionContext,
  IntegrationAccountInfo,
  IntegrationInfo,
  WorkerTokenData,
} from "@lobu/core";
import { createLogger, verifyWorkerToken } from "@lobu/core";
import type { Context } from "hono";
import { Hono } from "hono";
import { stream } from "hono/streaming";
import type { ApiKeyProviderModule } from "../auth/api-key-provider-module";
import type { IntegrationConfigService } from "../auth/integration/config-service";
import type { IntegrationCredentialStore } from "../auth/integration/credential-store";
import type { McpConfigService } from "../auth/mcp/config-service";
import type { McpProxy } from "../auth/mcp/proxy";
import type { McpTool } from "../auth/mcp/tool-cache";
import type { ProviderCatalogService } from "../auth/provider-catalog";
import type { AgentSettingsStore } from "../auth/settings/agent-settings-store";
import { resolveEffectiveModelRef } from "../auth/settings/model-selection";
import type { IMessageQueue } from "../infrastructure/queue";
import type { InstructionService } from "../services/instruction-service";
import type { SystemSkillsService } from "../services/system-skills-service";
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
  private providerCatalogService?: ProviderCatalogService;
  private agentSettingsStore?: AgentSettingsStore;
  private systemSkillsService?: SystemSkillsService;
  private integrationConfigService?: IntegrationConfigService;
  private integrationCredentialStore?: IntegrationCredentialStore;

  constructor(
    queue: IMessageQueue,
    publicGatewayUrl: string,
    sessionManager: ISessionManager,
    mcpConfigService: McpConfigService,
    instructionService: InstructionService,
    mcpProxy?: McpProxy,
    providerCatalogService?: ProviderCatalogService,
    agentSettingsStore?: AgentSettingsStore,
    systemSkillsService?: SystemSkillsService
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
    this.providerCatalogService = providerCatalogService;
    this.agentSettingsStore = agentSettingsStore;
    this.systemSkillsService = systemSkillsService;

    // Setup Hono app
    this.app = new Hono();
    this.setupRoutes();
  }

  /**
   * Set integration services (called after integration services are initialized)
   */
  setIntegrationServices(
    configService: IntegrationConfigService,
    credentialStore: IntegrationCredentialStore
  ): void {
    this.integrationConfigService = configService;
    this.integrationCredentialStore = credentialStore;
  }

  /**
   * Get the Hono app
   */
  getApp(): Hono {
    return this.app;
  }

  /**
   * Get the connection manager (for sending SSE notifications from external routes)
   */
  getConnectionManager(): WorkerConnectionManager {
    return this.connectionManager;
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

    const { deploymentName, userId, conversationId, agentId } =
      auth.tokenData as any;
    if (!conversationId) {
      return c.json({ error: "Invalid token (missing conversationId)" }, 401);
    }

    // Extract httpPort from query params (worker HTTP server registration)
    const httpPortParam = c.req.query("httpPort");
    const httpPort = httpPortParam ? parseInt(httpPortParam, 10) : undefined;

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

      // Clean up stale state before registering new connection.
      // When a container dies without cleanly closing its TCP socket,
      // the old SSE connection may still appear valid. Pause the BullMQ
      // worker first to prevent it from sending jobs to the dead connection,
      // then remove the stale connection so any in-flight handleJob will
      // fail and trigger a retry against the new connection.
      await this.jobRouter.pauseWorker(deploymentName);
      if (this.connectionManager.isConnected(deploymentName)) {
        logger.info(
          `Cleaning up stale connection for ${deploymentName} before new SSE`
        );
        this.connectionManager.removeConnection(deploymentName);
      }

      // Register new (live) connection
      this.connectionManager.addConnection(
        deploymentName,
        userId,
        conversationId,
        agentId || "",
        sseWriter,
        httpPort
      );

      // Register BullMQ worker (idempotent) and resume job processing
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
      const enrichedResponse =
        auth.tokenData.connectionId &&
        (!responseData.platformMetadata ||
          typeof responseData.platformMetadata === "object")
          ? {
              ...responseData,
              platformMetadata: {
                ...(responseData.platformMetadata || {}),
                connectionId: auth.tokenData.connectionId,
              },
            }
          : responseData;

      // Acknowledge job completion if jobId provided
      if (jobId) {
        this.jobRouter.acknowledgeJob(jobId);
      }

      // Delivery receipts (worker ACKs) have no message payload — just acknowledge and return
      if (enrichedResponse.received) {
        return c.json({ success: true });
      }

      // Log for debugging
      logger.info(
        `[WORKER-GATEWAY] Received response with fields: ${Object.keys(enrichedResponse).join(", ")}`
      );
      if (enrichedResponse.delta) {
        logger.info(
          `[WORKER-GATEWAY] Stream delta: deltaLength=${enrichedResponse.delta.length}`
        );
      }

      // Send response to thread_response queue
      await this.queue.send("thread_response", enrichedResponse);

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

      // Build settings URL for soul-empty fallback
      const settingsUrl = new URL("/settings", baseUrl);
      if (agentId) settingsUrl.searchParams.set("agent", agentId);

      // Fetch MCP config and session context in parallel
      const [mcpConfig, contextData] = await Promise.all([
        this.mcpConfigService.getWorkerConfig({
          baseUrl,
          workerToken: auth.token,
          deploymentName,
        }),
        this.instructionService.getSessionContext(
          platform || "unknown",
          instructionContext,
          { settingsUrl: settingsUrl.toString() }
        ),
      ]);

      // Fetch tool lists and instructions for ALL MCPs (unauthenticated ones
      // will attempt discovery without credentials)
      const mcpTools: Record<string, McpTool[]> = {};
      const mcpInstructions: Record<string, string> = {};
      if (this.mcpProxy && contextData.mcpStatus.length > 0) {
        const toolResults = await Promise.allSettled(
          contextData.mcpStatus.map(async (mcp) => {
            const result = await this.mcpProxy?.fetchToolsForMcp(
              mcp.id,
              agentId || userId,
              auth.tokenData
            );
            return { mcpId: mcp.id, ...(result || { tools: [] }) };
          })
        );

        for (const result of toolResults) {
          if (result.status === "fulfilled") {
            if (result.value.tools && result.value.tools.length > 0) {
              mcpTools[result.value.mcpId] = result.value.tools;
            }
            if (result.value.instructions) {
              mcpInstructions[result.value.mcpId] = result.value.instructions;
            }
          }
        }
      }

      // Downgrade auth status when an authenticated MCP returned no tools
      // (likely stale/expired credentials that the upstream rejected)
      for (const mcp of contextData.mcpStatus) {
        if (mcp.authenticated && mcp.requiresAuth && !mcpTools[mcp.id]) {
          logger.warn(
            `MCP "${mcp.id}" has stored credentials but returned no tools — marking as unauthenticated`
          );
          mcp.authenticated = false;
        }
      }

      // Resolve dynamic provider configuration
      const agentSettings =
        this.agentSettingsStore && agentId
          ? await this.agentSettingsStore.getSettings(agentId)
          : null;
      const providerConfig = await this.resolveProviderConfig(
        agentId || "",
        resolveEffectiveModelRef(agentSettings),
        baseUrl
      );

      // Fetch integration status
      const integrationStatus: IntegrationInfo[] = [];
      if (
        this.integrationConfigService &&
        this.integrationCredentialStore &&
        agentId
      ) {
        try {
          const allConfigs = await this.integrationConfigService.getAll();
          for (const [id, config] of Object.entries(allConfigs)) {
            const authType = config.authType || "oauth";
            const accountList =
              await this.integrationCredentialStore.listAccounts(agentId, id);
            const accounts: IntegrationAccountInfo[] = accountList.map((a) => ({
              accountId: a.accountId,
              grantedScopes: a.credentials.grantedScopes,
            }));
            // Resolve per-agent config to check OAuth credentials
            const resolved = await this.integrationConfigService.getIntegration(
              id,
              agentId
            );
            const isOAuth = authType === "oauth";
            const configured =
              !isOAuth ||
              !!(resolved?.oauth?.clientId && resolved?.oauth?.clientSecret);
            integrationStatus.push({
              id,
              label: config.label,
              authType,
              connected: accounts.length > 0,
              configured,
              accounts,
              availableScopes: config.scopes?.available ?? [],
            });
          }
        } catch (error) {
          logger.error("Failed to fetch integration status", { error });
        }
      }

      // Fetch enabled skills with content for worker filesystem sync
      let skillsConfig: Array<{ name: string; content: string }> = [];
      if (this.agentSettingsStore && agentId) {
        try {
          const settings = await this.agentSettingsStore.getSettings(agentId);
          const skills = settings?.skillsConfig?.skills || [];
          skillsConfig = skills
            .filter((s) => s.enabled && s.content)
            .map((s) => ({ name: s.name, content: s.content! }));
        } catch (error) {
          logger.error("Failed to fetch skills config for worker sync", {
            error,
          });
        }
      }

      let systemSkillsInstructions = "";
      if (this.systemSkillsService) {
        try {
          const runtimeSystemSkills =
            await this.systemSkillsService.getRuntimeSystemSkills();

          if (runtimeSystemSkills.length > 0) {
            const existingSkillNames = new Set(skillsConfig.map((s) => s.name));
            for (const skill of runtimeSystemSkills) {
              const workspaceSkillName = `system-${skill.id}`;
              if (!existingSkillNames.has(workspaceSkillName)) {
                skillsConfig.push({
                  name: workspaceSkillName,
                  content: skill.content,
                });
              }
            }

            const summaryLines = runtimeSystemSkills.map((skill, index) => {
              const description = skill.description
                ? ` - ${skill.description}`
                : "";
              return `${index + 1}. ${skill.name} (\`${skill.repo}\`)${description}`;
            });

            systemSkillsInstructions = [
              "## Built-in System Skills",
              "",
              "These system skills are always available in this workspace:",
              "",
              ...summaryLines,
              "",
              "Read full instructions using `cat .skills/system-*/SKILL.md` when needed.",
            ].join("\n");
          }
        } catch (error) {
          logger.error("Failed to fetch runtime system skills", { error });
        }
      }

      const mergedSkillsInstructions = [
        contextData.skillsInstructions,
        systemSkillsInstructions,
      ]
        .filter(Boolean)
        .join("\n\n");

      logger.info(
        `Session context for ${userId}: ${Object.keys(mcpConfig.mcpServers || {}).length} MCPs, ${contextData.agentInstructions.length} chars agent instructions, ${contextData.platformInstructions.length} chars platform instructions, ${contextData.networkInstructions.length} chars network instructions, ${mergedSkillsInstructions.length} chars skills instructions, ${contextData.mcpStatus.length} MCP status entries, ${Object.keys(mcpTools).length} MCP tool lists, ${Object.keys(mcpInstructions).length} MCP instructions, ${integrationStatus.length} integrations, ${skillsConfig.length} skills, provider: ${providerConfig.defaultProvider || "none"}`
      );

      return c.json({
        mcpConfig,
        agentInstructions: contextData.agentInstructions,
        platformInstructions: contextData.platformInstructions,
        networkInstructions: contextData.networkInstructions,
        skillsInstructions: mergedSkillsInstructions,
        mcpStatus: contextData.mcpStatus,
        mcpTools,
        mcpInstructions,
        providerConfig,
        integrationStatus,
        skillsConfig,
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
   * Resolve dynamic provider configuration for a given agent.
   * Mirrors the provider resolution logic in base-deployment-manager's
   * generateEnvironmentVariables() but returns config values instead of env vars.
   */
  private async resolveProviderConfig(
    agentId: string,
    agentModel?: string,
    requestBaseUrl?: string
  ): Promise<{
    credentialEnvVarName?: string;
    defaultProvider?: string;
    defaultModel?: string;
    cliBackends?: Array<{
      providerId: string;
      name: string;
      command: string;
      args?: string[];
      env?: Record<string, string>;
      modelArg?: string;
      sessionArg?: string;
    }>;
    providerBaseUrlMappings?: Record<string, string>;
    configProviders?: Record<string, ConfigProviderMeta>;
  }> {
    if (!this.providerCatalogService || !agentId) {
      return {};
    }

    const effectiveProviders =
      await this.providerCatalogService.getInstalledModules(agentId);
    if (effectiveProviders.length === 0) {
      return {};
    }

    // Determine primary provider
    let primaryProvider = agentModel
      ? await this.providerCatalogService.findProviderForModel(
          agentModel,
          effectiveProviders
        )
      : undefined;

    if (!primaryProvider) {
      for (const candidate of effectiveProviders) {
        if (
          candidate.hasSystemKey() ||
          (await candidate.hasCredentials(agentId))
        ) {
          primaryProvider = candidate;
          break;
        }
      }
    }

    // Build proxy base URL mappings for all installed providers
    // Use the request base URL (the worker's DISPATCHER_URL) for internal routing
    const proxyBaseUrl = `${requestBaseUrl || this.publicGatewayUrl}/api/proxy`;
    const providerBaseUrlMappings: Record<string, string> = {};
    for (const provider of effectiveProviders) {
      Object.assign(
        providerBaseUrlMappings,
        provider.getProxyBaseUrlMappings(proxyBaseUrl, agentId)
      );
    }

    // Build CLI backend configs
    const cliBackends: Array<{
      providerId: string;
      name: string;
      command: string;
      args?: string[];
      env?: Record<string, string>;
      modelArg?: string;
      sessionArg?: string;
    }> = [];
    for (const provider of effectiveProviders) {
      const config = provider.getCliBackendConfig?.();
      if (config) {
        cliBackends.push({ providerId: provider.providerId, ...config });
      }
    }

    // Collect metadata from config-driven providers for worker model resolution
    const configProviders: Record<string, ConfigProviderMeta> = {};
    for (const provider of effectiveProviders) {
      const meta = (provider as ApiKeyProviderModule).getProviderMetadata?.();
      if (meta) {
        configProviders[provider.providerId] = meta;
      }
    }

    const result: {
      credentialEnvVarName?: string;
      defaultProvider?: string;
      defaultModel?: string;
      cliBackends?: typeof cliBackends;
      providerBaseUrlMappings?: Record<string, string>;
      configProviders?: typeof configProviders;
    } = {};

    if (primaryProvider) {
      result.credentialEnvVarName = primaryProvider.getCredentialEnvVarName();
      const upstream = primaryProvider.getUpstreamConfig?.();
      if (upstream?.slug) {
        result.defaultProvider = upstream.slug;
      }
    }

    if (agentModel) {
      result.defaultModel = agentModel;
    }

    if (Object.keys(providerBaseUrlMappings).length > 0) {
      result.providerBaseUrlMappings = providerBaseUrlMappings;
    }

    if (cliBackends.length > 0) {
      result.cliBackends = cliBackends;
    }

    if (Object.keys(configProviders).length > 0) {
      result.configProviders = configProviders;
    }

    return result;
  }

  /**
   * Shutdown gateway
   */
  shutdown(): void {
    this.connectionManager.shutdown();
    this.jobRouter.shutdown();
  }
}
