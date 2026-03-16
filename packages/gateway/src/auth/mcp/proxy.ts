import { createLogger, verifyWorkerToken } from "@lobu/core";
import type { Context } from "hono";
import { Hono } from "hono";
import type { IMessageQueue } from "../../infrastructure/queue";
import { requiresToolApproval } from "../../permissions/approval-policy";
import type { GrantStore } from "../../permissions/grant-store";
import { GenericOAuth2Client } from "../oauth/generic-client";
import type { McpConfigService } from "./config-service";
import type { McpCredentialStore } from "./credential-store";
import type { McpInputStore } from "./input-store";
import { substituteObject, substituteString } from "./string-substitution";
import type { CachedMcpServer, McpTool, McpToolCache } from "./tool-cache";

const logger = createLogger("mcp-proxy");

interface JsonRpcResponse {
  jsonrpc: string;
  id: unknown;
  result?: {
    tools?: McpTool[];
    content?: unknown[];
    isError?: boolean;
  };
  error?: { code: number; message: string };
}

interface ResolvedMcp {
  httpServer: any;
  credentials: { accessToken: string; tokenType?: string } | null;
  inputValues: Record<string, string>;
  agentId: string;
}

const oauth2Client = new GenericOAuth2Client();

function authenticateRequest(
  c: Context
): { tokenData: any; token: string } | null {
  const sessionToken = extractSessionToken(c);
  if (!sessionToken) return null;

  const tokenData = verifyWorkerToken(sessionToken);
  if (!tokenData) return null;

  return { tokenData, token: sessionToken };
}

function extractSessionToken(c: Context): string | null {
  const authHeader = c.req.header("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.substring(7);
  }

  const tokenFromQuery = c.req.query("workerToken");
  if (typeof tokenFromQuery === "string") {
    return tokenFromQuery;
  }

  return null;
}

export class McpProxy {
  private readonly SESSION_TTL_SECONDS = 30 * 60; // 30 minutes
  private readonly redisClient: any;
  private app: Hono;
  private toolCache?: McpToolCache;
  private readonly refreshLocks: Map<string, Promise<any>> = new Map();

  constructor(
    private readonly configService: McpConfigService,
    private readonly credentialStore: McpCredentialStore,
    private readonly inputStore: McpInputStore,
    queue: IMessageQueue,
    toolCache?: McpToolCache,
    private readonly grantStore?: GrantStore
  ) {
    this.redisClient = queue.getRedisClient();
    this.toolCache = toolCache;
    this.app = new Hono();
    this.setupRoutes();
    logger.info("MCP proxy initialized with Redis session storage", {
      ttlMinutes: this.SESSION_TTL_SECONDS / 60,
    });
  }

  getApp(): Hono {
    return this.app;
  }

  /**
   * Check if this request is an MCP proxy request (has X-Mcp-Id header)
   * Used by gateway to determine if root path requests should be handled by MCP proxy
   */
  isMcpRequest(c: Context): boolean {
    return !!c.req.header("x-mcp-id");
  }

  /**
   * Fetch tools and instructions for a specific MCP server.
   * Performs MCP initialize handshake first to capture server instructions,
   * then fetches tool list.
   */
  async fetchToolsForMcp(
    mcpId: string,
    agentId: string,
    tokenData: any
  ): Promise<{ tools: McpTool[]; instructions?: string }> {
    if (this.toolCache) {
      const cached = await this.toolCache.getServerInfo(mcpId, agentId);
      if (cached) return cached;
    }

    let resolved = await this.resolveMcpServer(mcpId, tokenData);
    if (!resolved) {
      // Retry with discoveryOnly to attempt unauthenticated tool listing
      resolved = await this.resolveMcpServer(mcpId, tokenData, {
        discoveryOnly: true,
      });
      if (!resolved) return { tools: [] };
    }

    try {
      // Step 1: Send initialize to capture server instructions
      let instructions: string | undefined;
      try {
        const initBody = JSON.stringify({
          jsonrpc: "2.0",
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "lobu-gateway", version: "1.0.0" },
          },
          id: 0,
        });

        const initResponse = await this.sendUpstreamRequest(
          resolved.httpServer,
          resolved.credentials,
          resolved.inputValues,
          resolved.agentId,
          mcpId,
          "POST",
          initBody
        );

        const initData = (await initResponse.json()) as {
          result?: { instructions?: string };
          error?: { code: number; message: string };
        };

        if (initData?.result?.instructions) {
          instructions = initData.result.instructions;
          logger.info("Captured MCP server instructions", {
            mcpId,
            length: instructions.length,
          });
        }

        // Step 2: Send initialized notification (required by MCP spec)
        const notifyBody = JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/initialized",
        });
        await this.sendUpstreamRequest(
          resolved.httpServer,
          resolved.credentials,
          resolved.inputValues,
          resolved.agentId,
          mcpId,
          "POST",
          notifyBody
        ).catch(() => {
          // notifications can fail silently
        });
      } catch (initError) {
        logger.warn("MCP initialize failed (continuing with tools/list)", {
          mcpId,
          error:
            initError instanceof Error ? initError.message : String(initError),
        });
      }

      // Step 3: Fetch tools list
      const jsonRpcBody = JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/list",
        params: {},
        id: 1,
      });

      const response = await this.sendUpstreamRequest(
        resolved.httpServer,
        resolved.credentials,
        resolved.inputValues,
        resolved.agentId,
        mcpId,
        "POST",
        jsonRpcBody
      );

      const data = (await response.json()) as JsonRpcResponse;
      const tools: McpTool[] = data?.result?.tools || [];

      const serverInfo: CachedMcpServer = { tools, instructions };
      if (this.toolCache && tools.length > 0) {
        await this.toolCache.setServerInfo(mcpId, serverInfo, agentId);
      }

      return serverInfo;
    } catch (error) {
      logger.error("Failed to fetch tools for MCP", { mcpId, error });
      return { tools: [] };
    }
  }

  private setupRoutes() {
    // REST API endpoints for curl-based tool access (registered BEFORE catch-all)
    this.app.get("/tools", (c) => this.handleListAllTools(c));
    this.app.get("/:mcpId/tools", (c) => this.handleListTools(c));
    this.app.post("/:mcpId/tools/:toolName", (c) => this.handleCallTool(c));

    // Legacy endpoints (if needed for other MCP transports)
    this.app.all("/register", (c) => this.handleProxyRequest(c));
    this.app.all("/message", (c) => this.handleProxyRequest(c));

    // Path-based routes (for SSE or other transports)
    this.app.all("/:mcpId", (c) => this.handleProxyRequest(c));
    this.app.all("/:mcpId/*", (c) => this.handleProxyRequest(c));
  }

  private async handleListTools(c: Context): Promise<Response> {
    const mcpId = c.req.param("mcpId");
    const auth = authenticateRequest(c);
    if (!auth) return c.json({ error: "Invalid authentication token" }, 401);

    const resolved = await this.resolveMcpServer(mcpId, auth.tokenData);
    if (!resolved) {
      return c.json({ error: `MCP server '${mcpId}' not found` }, 404);
    }

    // Check cache
    if (this.toolCache) {
      const cached = await this.toolCache.get(mcpId, resolved.agentId);
      if (cached) return c.json({ tools: cached });
    }

    try {
      const jsonRpcBody = JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/list",
        params: {},
        id: 1,
      });

      const response = await this.sendUpstreamRequest(
        resolved.httpServer,
        resolved.credentials,
        resolved.inputValues,
        resolved.agentId,
        mcpId,
        "POST",
        jsonRpcBody
      );

      const data = (await response.json()) as JsonRpcResponse;
      if (data?.error) {
        logger.error("Upstream returned JSON-RPC error", {
          mcpId,
          error: data.error,
        });
        return c.json({ error: data.error.message || "Upstream error" }, 502);
      }

      const tools: McpTool[] = data?.result?.tools || [];

      // Cache result
      if (this.toolCache && tools.length > 0) {
        await this.toolCache.set(mcpId, tools, resolved.agentId);
      }

      return c.json({ tools });
    } catch (error) {
      logger.error("Failed to list tools", { mcpId, error });
      return c.json(
        {
          error: `Failed to connect to MCP '${mcpId}': ${error instanceof Error ? error.message : "Unknown error"}`,
        },
        502
      );
    }
  }

  private async handleCallTool(c: Context): Promise<Response> {
    const mcpId = c.req.param("mcpId");
    const toolName = c.req.param("toolName");
    const auth = authenticateRequest(c);
    if (!auth) return c.json({ error: "Invalid authentication token" }, 401);

    const resolved = await this.resolveMcpServer(mcpId, auth.tokenData);
    if (!resolved) {
      return c.json({ error: `MCP server '${mcpId}' not found` }, 404);
    }

    // Check tool approval based on annotations and grants.
    // Skip when tool list couldn't be fetched (e.g. auth failure) — let
    // the upstream return the proper error instead of blocking here.
    if (this.grantStore) {
      const { found, annotations } = await this.getToolAnnotations(
        mcpId,
        toolName,
        resolved.agentId,
        auth.tokenData
      );
      if (found && requiresToolApproval(annotations)) {
        const pattern = `/mcp/${mcpId}/tools/${toolName}`;
        const hasGrant = await this.grantStore.hasGrant(
          resolved.agentId,
          pattern
        );
        if (!hasGrant) {
          logger.info("Tool call blocked: requires approval", {
            agentId: resolved.agentId,
            mcpId,
            toolName,
            pattern,
          });
          return c.json(
            {
              content: [
                {
                  type: "text",
                  text: `Tool call requires approval. Grant access via settings page for: ${mcpId} → ${toolName}`,
                },
              ],
              isError: true,
            },
            403
          );
        }
      }
    }

    let toolArguments: Record<string, unknown> = {};
    try {
      const body = await c.req.text();
      if (body) {
        toolArguments = JSON.parse(body);
      }
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    try {
      const jsonRpcBody = JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: toolName, arguments: toolArguments },
        id: 1,
      });

      const response = await this.sendUpstreamRequest(
        resolved.httpServer,
        resolved.credentials,
        resolved.inputValues,
        resolved.agentId,
        mcpId,
        "POST",
        jsonRpcBody
      );

      const data = (await response.json()) as JsonRpcResponse;
      if (data?.error) {
        const errorMsg =
          data.error.message ||
          (typeof data.error === "string" ? data.error : "Upstream error");
        logger.error("Upstream returned JSON-RPC error on tool call", {
          mcpId,
          toolName,
          error: data.error,
        });

        // Clear stale credentials on auth-related upstream errors
        if (
          /invalid.token|expired|unauthorized|unauthenticated/i.test(errorMsg)
        ) {
          await this.credentialStore.deleteCredentials(resolved.agentId, mcpId);
          logger.info(
            `Cleared stale credentials for ${mcpId} after upstream auth error`
          );
        }

        return c.json(
          {
            content: [],
            isError: true,
            error: errorMsg,
          },
          502
        );
      }

      const result = data?.result || {};
      return c.json({
        content: result.content || [],
        isError: result.isError || false,
      });
    } catch (error) {
      logger.error("Failed to call tool", { mcpId, toolName, error });
      return c.json(
        {
          content: [],
          isError: true,
          error: `Failed to connect to MCP '${mcpId}': ${error instanceof Error ? error.message : "Unknown error"}`,
        },
        502
      );
    }
  }

  private async handleListAllTools(c: Context): Promise<Response> {
    const auth = authenticateRequest(c);
    if (!auth) return c.json({ error: "Invalid authentication token" }, 401);

    const agentId = auth.tokenData.agentId || auth.tokenData.userId;

    const allHttpServers = await this.configService.getAllHttpServers(agentId);
    const allMcpIds = Array.from(allHttpServers.keys());

    const mcpServers: Record<string, { tools: McpTool[] }> = {};

    // Fetch tools in parallel, tolerate failures
    const results = await Promise.allSettled(
      allMcpIds.map(async (mcpId) => {
        const { tools } = await this.fetchToolsForMcp(
          mcpId,
          agentId,
          auth.tokenData
        );
        return { mcpId, tools };
      })
    );

    for (const result of results) {
      if (result.status === "fulfilled" && result.value.tools.length > 0) {
        mcpServers[result.value.mcpId] = { tools: result.value.tools };
      }
    }

    return c.json({ mcpServers });
  }

  private async handleProxyRequest(c: Context): Promise<Response> {
    const mcpId = c.req.param("mcpId") || c.req.header("x-mcp-id");
    const sessionToken = extractSessionToken(c);

    logger.info("Handling MCP proxy request", {
      method: c.req.method,
      path: c.req.path,
      mcpId,
      hasSessionToken: !!sessionToken,
    });

    if (!mcpId) {
      return this.sendJsonRpcError(c, -32600, "Missing MCP ID");
    }

    if (!sessionToken) {
      return this.sendJsonRpcError(c, -32600, "Missing authentication token");
    }

    const tokenData = verifyWorkerToken(sessionToken);
    if (!tokenData) {
      return this.sendJsonRpcError(c, -32600, "Invalid authentication token");
    }

    const agentId = tokenData.agentId || tokenData.userId;
    const httpServer = await this.configService.getHttpServer(mcpId!, agentId);

    if (!httpServer) {
      return this.sendJsonRpcError(
        c,
        -32601,
        `MCP server '${mcpId}' not found`
      );
    }

    // Check authentication - OAuth or inputs
    let credentials = null;
    let inputValues = null;
    const hasOAuth = !!httpServer.oauth;
    const discoveredOAuth = await this.configService.getDiscoveredOAuth(mcpId!);
    const hasDiscoveredOAuth = !!discoveredOAuth;

    if (hasOAuth || hasDiscoveredOAuth) {
      credentials = await this.credentialStore.getCredentials(agentId, mcpId!);

      if (!credentials || !credentials.accessToken) {
        logger.info("MCP OAuth credentials missing", { agentId, mcpId });
        return this.sendJsonRpcError(
          c,
          -32002,
          `MCP '${mcpId}' requires authentication. Use ConnectService(id="${mcpId}") to authenticate.`
        );
      }

      if (credentials.expiresAt && credentials.expiresAt <= Date.now()) {
        logger.info("MCP access token expired, attempting refresh", {
          agentId,
          mcpId,
          hasRefreshToken: !!credentials.refreshToken,
        });

        if (credentials.refreshToken) {
          try {
            credentials = await this.refreshCredentials(
              httpServer,
              discoveredOAuth,
              credentials.refreshToken,
              agentId,
              mcpId!
            );
          } catch (error) {
            logger.error("Failed to refresh MCP access token", {
              error,
              errorMessage:
                error instanceof Error ? error.message : String(error),
              errorStack: error instanceof Error ? error.stack : undefined,
              agentId,
              mcpId,
            });
            return this.sendJsonRpcError(
              c,
              -32002,
              `MCP '${mcpId}' authentication expired. Use ConnectService(id="${mcpId}") to re-authenticate.`
            );
          }
        } else {
          logger.warn("MCP credentials expired with no refresh token", {
            agentId,
            mcpId,
          });
          return this.sendJsonRpcError(
            c,
            -32002,
            `MCP '${mcpId}' authentication expired. Use ConnectService(id="${mcpId}") to re-authenticate.`
          );
        }
      }
    }

    // Load input values if MCP uses inputs
    if (httpServer.inputs && httpServer.inputs.length > 0) {
      inputValues = await this.inputStore.getInputs(agentId, mcpId!);

      if (!inputValues) {
        logger.info("MCP input values missing", { agentId, mcpId });
        return this.sendJsonRpcError(
          c,
          -32002,
          `MCP '${mcpId}' requires configuration. Please configure it in the settings page.`
        );
      }
    }

    try {
      return await this.forwardRequestWithProtocolTranslation(
        c,
        httpServer,
        credentials,
        inputValues || {},
        agentId,
        mcpId!
      );
    } catch (error) {
      logger.error("Failed to proxy MCP request", { error, mcpId });
      return this.sendJsonRpcError(
        c,
        -32603,
        `Failed to connect to MCP '${mcpId}': ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  private async getToolAnnotations(
    mcpId: string,
    toolName: string,
    agentId: string,
    tokenData: any
  ): Promise<{ found: boolean; annotations?: McpTool["annotations"] }> {
    let tools: McpTool[] | null = null;
    if (this.toolCache) {
      tools = await this.toolCache.get(mcpId, agentId);
    }

    if (!tools) {
      const result = await this.fetchToolsForMcp(mcpId, agentId, tokenData);
      tools = result.tools;
    }

    // If tool list is empty (e.g. auth failure), we can't determine annotations
    if (tools.length === 0) {
      return { found: false };
    }

    const tool = tools.find((t) => t.name === toolName);
    return { found: true, annotations: tool?.annotations };
  }

  private async resolveMcpServer(
    mcpId: string,
    tokenData: any,
    options?: { discoveryOnly?: boolean }
  ): Promise<ResolvedMcp | null> {
    const agentId = tokenData.agentId || tokenData.userId;
    const httpServer = await this.configService.getHttpServer(mcpId, agentId);
    if (!httpServer) return null;

    let credentials = null;
    let inputValues: Record<string, string> = {};

    // Check OAuth (static or discovered)
    const hasOAuth = !!httpServer.oauth;
    const discoveredOAuth = await this.configService.getDiscoveredOAuth(mcpId);
    const hasDiscoveredOAuth = !!discoveredOAuth;

    if (hasOAuth || hasDiscoveredOAuth) {
      credentials = await this.credentialStore.getCredentials(agentId, mcpId);
      if (!credentials?.accessToken) {
        if (options?.discoveryOnly) {
          // Return server with null credentials for unauthenticated tool discovery
          return { httpServer, credentials: null, inputValues, agentId };
        }
        return null;
      }

      // Refresh expired token
      if (credentials.expiresAt && credentials.expiresAt <= Date.now()) {
        if (!credentials.refreshToken) {
          if (options?.discoveryOnly) {
            return { httpServer, credentials: null, inputValues, agentId };
          }
          return null;
        }

        try {
          credentials = await this.refreshCredentials(
            httpServer,
            discoveredOAuth,
            credentials.refreshToken,
            agentId,
            mcpId
          );
        } catch {
          if (options?.discoveryOnly) {
            return { httpServer, credentials: null, inputValues, agentId };
          }
          return null;
        }
      }
    }

    // Load input values
    if (httpServer.inputs && httpServer.inputs.length > 0) {
      const inputs = await this.inputStore.getInputs(agentId, mcpId);
      if (!inputs) {
        if (options?.discoveryOnly) {
          return { httpServer, credentials: null, inputValues, agentId };
        }
        return null;
      }
      inputValues = inputs;
    }

    return { httpServer, credentials, inputValues, agentId };
  }

  private async refreshCredentials(
    httpServer: any,
    discoveredOAuth: any,
    refreshToken: string,
    agentId: string,
    mcpId: string
  ): Promise<{ accessToken: string; tokenType?: string }> {
    const lockKey = `${agentId}:${mcpId}`;
    const existing = this.refreshLocks.get(lockKey);
    if (existing) {
      logger.info("Waiting for in-flight token refresh", { agentId, mcpId });
      return existing;
    }

    const refreshPromise = this.doRefreshCredentials(
      httpServer,
      discoveredOAuth,
      refreshToken,
      agentId,
      mcpId
    ).finally(() => {
      this.refreshLocks.delete(lockKey);
    });

    this.refreshLocks.set(lockKey, refreshPromise);
    return refreshPromise;
  }

  private async doRefreshCredentials(
    httpServer: any,
    discoveredOAuth: any,
    refreshToken: string,
    agentId: string,
    mcpId: string
  ): Promise<{ accessToken: string; tokenType?: string }> {
    let oauthConfig = httpServer.oauth;

    if (!oauthConfig && discoveredOAuth?.metadata) {
      const discoveryService = this.configService.getDiscoveryService();
      if (!discoveryService)
        throw new Error("OAuth discovery service not available");

      const clientCredentials =
        await discoveryService.getOrCreateClientCredentials(
          mcpId,
          discoveredOAuth.metadata
        );
      if (!clientCredentials?.client_id) {
        throw new Error("Failed to get client credentials for refresh");
      }

      oauthConfig = {
        authUrl: discoveredOAuth.metadata.authorization_endpoint,
        tokenUrl: discoveredOAuth.metadata.token_endpoint,
        clientId: clientCredentials.client_id,
        clientSecret: clientCredentials.client_secret || "",
        scopes: discoveredOAuth.metadata.scopes_supported || [],
        grantType: "authorization_code",
        responseType: "code",
        tokenEndpointAuthMethod: clientCredentials.token_endpoint_auth_method,
      };
    }

    if (!oauthConfig) throw new Error("No OAuth config available for refresh");

    try {
      const refreshedCredentials = await oauth2Client.refreshToken(
        refreshToken,
        oauthConfig
      );

      await this.credentialStore.setCredentials(
        agentId,
        mcpId,
        refreshedCredentials
      );
      logger.info("Successfully refreshed MCP access token", {
        agentId,
        mcpId,
      });
      return refreshedCredentials;
    } catch (error) {
      // Clear stale credentials so getMcpStatuses correctly shows
      // unauthenticated and the user can re-authenticate via the settings page.
      await this.credentialStore.deleteCredentials(agentId, mcpId);
      logger.warn(
        "Cleared stale MCP credentials after refresh failure — user must re-authenticate",
        { agentId, mcpId }
      );
      throw error;
    }
  }

  private buildUpstreamHeaders(
    credentials: { accessToken: string; tokenType?: string } | null,
    inputValues: Record<string, string>,
    sessionId: string | null
  ): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };

    if (sessionId) {
      headers["Mcp-Session-Id"] = sessionId;
    }

    if (credentials?.accessToken) {
      headers.Authorization = `Bearer ${credentials.accessToken}`;
    }

    // Apply input substitution to headers
    if (Object.keys(inputValues).length > 0) {
      for (const [key, value] of Object.entries(headers)) {
        headers[key] = substituteString(value, inputValues);
      }
    }

    return headers;
  }

  private async sendUpstreamRequest(
    httpServer: any,
    credentials: { accessToken: string; tokenType?: string } | null,
    inputValues: Record<string, string>,
    agentId: string,
    mcpId: string,
    method: string,
    body?: string
  ): Promise<Response> {
    const sessionKey = `mcp:session:${agentId}:${mcpId}`;
    const sessionId = await this.getSession(sessionKey);

    const headers = this.buildUpstreamHeaders(
      credentials,
      inputValues,
      sessionId
    );

    // Apply input substitution to body
    let finalBody = body;
    if (finalBody && Object.keys(inputValues).length > 0) {
      try {
        const bodyJson = JSON.parse(finalBody);
        const substitutedBody = substituteObject(bodyJson, inputValues);
        finalBody = JSON.stringify(substitutedBody);
      } catch {
        finalBody = substituteString(finalBody, inputValues);
      }
    }

    const response = await fetch(httpServer.upstreamUrl, {
      method,
      headers,
      body: finalBody || undefined,
    });

    // Track session
    const newSessionId = response.headers.get("Mcp-Session-Id");
    if (newSessionId) {
      await this.setSession(sessionKey, newSessionId);
    }

    return response;
  }

  private async forwardRequestWithProtocolTranslation(
    c: Context,
    httpServer: any,
    credentials: { accessToken: string; tokenType?: string } | null,
    inputValues: Record<string, string>,
    agentId: string,
    mcpId: string
  ): Promise<Response> {
    const sessionKey = `mcp:session:${agentId}:${mcpId}`;
    const sessionId = await this.getSession(sessionKey);

    let bodyText = await this.getRequestBodyAsText(c);

    logger.info("Proxying MCP request", {
      mcpId,
      agentId,
      method: c.req.method,
      hasSession: !!sessionId,
      bodyLength: bodyText.length,
      hasInputValues: Object.keys(inputValues).length > 0,
    });

    const headers = this.buildUpstreamHeaders(
      credentials,
      inputValues,
      sessionId
    );

    // Apply input substitution to body
    if (Object.keys(inputValues).length > 0 && bodyText) {
      try {
        const bodyJson = JSON.parse(bodyText);
        const substitutedBody = substituteObject(bodyJson, inputValues);
        bodyText = JSON.stringify(substitutedBody);
        logger.debug("Applied input substitution to request body", {
          mcpId,
          agentId,
        });
      } catch {
        bodyText = substituteString(bodyText, inputValues);
      }
    }

    const response = await fetch(httpServer.upstreamUrl, {
      method: c.req.method,
      headers,
      body: bodyText || undefined,
    });

    const newSessionId = response.headers.get("Mcp-Session-Id");
    if (newSessionId) {
      await this.setSession(sessionKey, newSessionId);
      logger.debug("Stored MCP session ID", {
        mcpId,
        agentId,
        sessionId: newSessionId,
      });
    }

    const responseHeaders = new Headers();
    const contentType = response.headers.get("content-type");
    if (contentType) {
      responseHeaders.set("Content-Type", contentType);
    }
    if (newSessionId) {
      responseHeaders.set("Mcp-Session-Id", newSessionId);
    }

    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders,
    });
  }

  private async getRequestBodyAsText(c: Context): Promise<string> {
    if (c.req.method === "GET" || c.req.method === "HEAD") {
      return "";
    }

    try {
      return await c.req.text();
    } catch {
      return "";
    }
  }

  private async getSession(key: string): Promise<string | null> {
    try {
      const sessionId = await this.redisClient.get(key);
      if (sessionId) {
        await this.redisClient.expire(key, this.SESSION_TTL_SECONDS);
      }
      return sessionId;
    } catch (error) {
      logger.error("Failed to get MCP session from Redis", { key, error });
      return null;
    }
  }

  private async setSession(key: string, sessionId: string): Promise<void> {
    try {
      await this.redisClient.set(
        key,
        sessionId,
        "EX",
        this.SESSION_TTL_SECONDS
      );
    } catch (error) {
      logger.error("Failed to store MCP session in Redis", { key, error });
    }
  }

  private sendJsonRpcError(
    c: Context,
    code: number,
    message: string,
    id: any = null
  ): Response {
    return c.json(
      {
        jsonrpc: "2.0",
        id,
        error: { code, message },
      },
      200
    );
  }
}
