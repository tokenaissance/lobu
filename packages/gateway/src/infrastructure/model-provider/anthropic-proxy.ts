import { createLogger } from "@peerbot/core";
import { type Request, type Response, Router } from "express";
import fetch from "node-fetch";
import type { ClaudeCredentialStore } from "../../auth/claude/credential-store";
import { ClaudeOAuthClient } from "../../auth/oauth/claude-client";

const logger = createLogger("dispatcher");

export interface AnthropicProxyConfig {
  enabled: boolean;
  anthropicApiKey?: string; // Now optional - may not be set if using OAuth
  anthropicBaseUrl?: string;
}

export class AnthropicProxy {
  private router: Router;
  private config: AnthropicProxyConfig;
  private credentialStore?: ClaudeCredentialStore;
  private oauthClient: ClaudeOAuthClient;
  private refreshLocks: Map<string, Promise<string | null>>; // userId -> refresh promise

  constructor(
    config: AnthropicProxyConfig,
    credentialStore?: ClaudeCredentialStore
  ) {
    this.config = config;
    this.credentialStore = credentialStore;
    this.oauthClient = new ClaudeOAuthClient();
    this.refreshLocks = new Map();
    this.router = Router();
    this.setupRoutes();
  }

  getRouter(): Router {
    return this.router;
  }

  /**
   * Refresh an expired OAuth token for a user
   * Uses locking to prevent concurrent refresh attempts for the same user
   * Returns the new access token or null if refresh failed
   */
  private async refreshUserToken(userId: string): Promise<string | null> {
    // Check if there's already a refresh in progress for this user
    const existingRefresh = this.refreshLocks.get(userId);
    if (existingRefresh) {
      logger.info(`Waiting for existing token refresh for user ${userId}`);
      return existingRefresh;
    }

    // Create a new refresh promise and store it
    const refreshPromise = this.performTokenRefresh(userId);
    this.refreshLocks.set(userId, refreshPromise);

    try {
      const result = await refreshPromise;
      return result;
    } finally {
      // Clean up the lock after refresh completes (success or failure)
      this.refreshLocks.delete(userId);
    }
  }

  /**
   * Perform the actual token refresh
   */
  private async performTokenRefresh(userId: string): Promise<string | null> {
    if (!this.credentialStore) {
      logger.error("Cannot refresh token: credential store not available");
      return null;
    }

    try {
      // Get current credentials to access refresh token
      const credentials = await this.credentialStore.getCredentials(userId);
      if (!credentials || !credentials.refreshToken) {
        logger.warn(`No refresh token available for user ${userId}`);
        return null;
      }

      logger.info(`Refreshing expired token for user ${userId}`);

      // Use ClaudeOAuthClient to refresh the token
      const newCredentials = await this.oauthClient.refreshToken(
        credentials.refreshToken
      );

      // Store the new credentials
      await this.credentialStore.setCredentials(userId, newCredentials);

      logger.info(`Successfully refreshed token for user ${userId}`);
      return newCredentials.accessToken;
    } catch (error) {
      logger.error(`Failed to refresh token for user ${userId}`, { error });

      // If refresh failed, delete the invalid credentials
      try {
        await this.credentialStore.deleteCredentials(userId);
        logger.info(`Deleted invalid credentials for user ${userId}`);
      } catch (deleteError) {
        logger.error(`Failed to delete invalid credentials`, { deleteError });
      }

      return null;
    }
  }

  private setupRoutes(): void {
    // Health check for proxy
    this.router.get("/health", (_req: Request, res: Response) => {
      res.json({
        service: "anthropic-proxy",
        status: this.config.enabled ? "enabled" : "disabled",
        timestamp: new Date().toISOString(),
      });
    });

    // Proxy all requests that aren't health
    this.router.use((req, res, next) => {
      if (req.path === "/health") {
        next();
      } else {
        this.handleProxyRequest(req, res);
      }
    });
  }

  private async handleProxyRequest(req: Request, res: Response): Promise<void> {
    if (!this.config.enabled) {
      res.status(503).json({ error: "Anthropic proxy is disabled" });
      return;
    }

    try {
      // Forward request to Anthropic API
      await this.forwardToAnthropic(req, res);
    } catch (error) {
      logger.error("Anthropic proxy error:", error);
      res.status(500).json({ error: "Internal proxy error" });
    }
  }

  private async forwardToAnthropic(req: Request, res: Response): Promise<void> {
    // Authentication flow:
    // 1. Worker sends encrypted worker token via Claude SDK in x-api-key header
    // 2. Validate token and extract userId
    // 3. Use userId to get user's OAuth token (if available) or fall back to system API key
    // 4. Forward request to Anthropic with real credentials
    const workerToken = req.headers["x-api-key"] as string | undefined;

    // Validate worker token and extract userId
    let userId: string | undefined;
    if (workerToken && !workerToken.startsWith("sk-ant-")) {
      // This is a worker token, not an Anthropic API key
      const { verifyWorkerToken } = await import("@peerbot/core");
      const tokenData = verifyWorkerToken(workerToken);

      if (!tokenData) {
        logger.warn("Invalid worker token received");
        res.status(401).json({
          error: {
            type: "authentication_error",
            message: "Invalid worker authentication token",
          },
        });
        return;
      }

      userId = tokenData.userId;
      logger.info(`Authenticated worker request for user: ${userId}`);
    }

    // Resolve API key/token: user token > system token > error
    let apiKey: string | undefined;
    let tokenSource: "user" | "system" | "none" = "none";

    // Check for user credentials first
    if (userId && this.credentialStore) {
      const credentials = await this.credentialStore.getCredentials(userId);
      if (credentials) {
        // Check if token is expired (with 5 minute buffer)
        const expiryBuffer = 5 * 60 * 1000; // 5 minutes in milliseconds
        const isExpired = credentials.expiresAt <= Date.now() + expiryBuffer;

        if (isExpired) {
          logger.info(`Token expired for user ${userId}, attempting refresh`, {
            expiresAt: new Date(credentials.expiresAt).toISOString(),
            now: new Date().toISOString(),
          });

          // Attempt to refresh the token
          const refreshedToken = await this.refreshUserToken(userId);
          if (refreshedToken) {
            apiKey = refreshedToken;
            tokenSource = "user";
            logger.info(`Using refreshed OAuth token for ${userId}`);
          } else {
            // Refresh failed - will fall back to system token or return error
            logger.warn(`Token refresh failed for ${userId}, falling back`);
          }
        } else {
          // Token is still valid
          apiKey = credentials.accessToken;
          tokenSource = "user";
          logger.info(`Using user OAuth token for ${userId}`);
        }
      }
    }

    // Fall back to system token if no user token
    if (!apiKey && this.config.anthropicApiKey) {
      apiKey = this.config.anthropicApiKey;
      tokenSource = "system";
      logger.info(`Using system API key`);
    }

    // No credentials available - return error
    if (!apiKey) {
      logger.warn(`No API key available for request`, { userId });
      res.status(401).json({
        error: {
          type: "authentication_error",
          message:
            "No Claude authentication configured. Please login via Slack home tab or configure ANTHROPIC_API_KEY environment variable.",
        },
      });
      return;
    }

    // Check if we're using OAuth token (sk-ant-oat01-) vs API key (sk-ant-api03-)
    const isOAuthToken = apiKey.startsWith("sk-ant-oat");

    const anthropicUrl = `${this.config.anthropicBaseUrl || "https://api.anthropic.com"}${req.path}`;

    // Add ?beta=true for OAuth tokens on /v1/messages
    let finalUrl = anthropicUrl;
    if (
      isOAuthToken &&
      req.path === "/v1/messages" &&
      !anthropicUrl.includes("beta=")
    ) {
      finalUrl += `${anthropicUrl.includes("?") ? "&" : "?"}beta=true`;
    }

    const headers: Record<string, string> = {};
    let body =
      req.method !== "GET" && req.method !== "HEAD" ? req.body : undefined;

    logger.info(
      `🔧 Original body type: ${typeof body}, length: ${body ? (typeof body === "string" ? body.length : JSON.stringify(body).length) : 0}`
    );

    if (isOAuthToken) {
      logger.info(
        `🔧 OAuth token detected - passthrough body (no tool override)`
      );

      // Passthrough: do not modify request body or tools
      body = body
        ? typeof body === "string"
          ? body
          : JSON.stringify(body)
        : undefined;

      // OAuth headers (Bearer, not x-api-key)
      headers.Authorization = `Bearer ${apiKey}`;
      headers["Content-Type"] = "application/json";
      headers.Accept = "application/json";
      headers["User-Agent"] = "claude-cli/1.0.98 (external, sdk-cli)";
      headers["anthropic-version"] = "2023-06-01";
      headers["anthropic-dangerous-direct-browser-access"] = "true";
      headers["x-app"] = "cli";
      headers["x-stainless-arch"] = "arm64";
      headers["x-stainless-lang"] = "js";
      headers["x-stainless-os"] = "MacOS";
      headers["x-stainless-package-version"] = "0.60.0";
      headers["x-stainless-retry-count"] = "0";
      headers["x-stainless-runtime"] = "node";
      headers["x-stainless-runtime-version"] = "v23.10.0";
      headers["x-stainless-timeout"] = "600";
      // Keep a stable beta header without mutating tools/body
      headers["anthropic-beta"] =
        "oauth-2025-04-20,fine-grained-tool-streaming-2025-05-14";

      logger.info(
        `🔧 Using OAuth token with passthrough body (${tokenSource})`
      );
    } else {
      logger.info(
        `🔧 Using regular API key routing for public Anthropic API (${tokenSource})`
      );

      // Standard API headers for regular API keys
      headers["x-api-key"] = apiKey;
      headers["Content-Type"] =
        req.headers["content-type"] || "application/json";
      headers["User-Agent"] = req.headers["user-agent"] || "peerbot-proxy/1.0";

      // Forward additional headers that Anthropic might need
      if (req.headers["anthropic-version"]) {
        headers["anthropic-version"] = req.headers[
          "anthropic-version"
        ] as string;
      }
    }

    // Extract request metadata for logging
    let requestModel = "unknown";
    let requestMaxTokens = "unknown";
    let messageCount = 0;
    try {
      const parsedBody = typeof body === "string" ? JSON.parse(body) : body;
      requestModel = parsedBody?.model || "unknown";
      requestMaxTokens =
        parsedBody?.max_tokens || parsedBody?.maxTokens || "default";
      messageCount = Array.isArray(parsedBody?.messages)
        ? parsedBody.messages.length
        : 0;
    } catch {
      // Ignore parsing errors for metadata
    }

    logger.info(
      `🔧 Forwarding to Anthropic API: ${finalUrl} - model: ${requestModel}, maxTokens: ${requestMaxTokens}, messages: ${messageCount}, tokenSource: ${tokenSource}`
    );
    const fetchStartTime = Date.now();

    try {
      const response = await fetch(finalUrl, {
        method: req.method,
        headers,
        body: body,
      });

      const fetchDuration = Date.now() - fetchStartTime;
      logger.info(
        `✅ Anthropic API response received (${fetchDuration}ms) - status: ${response.status}, model: ${requestModel}, isStream: ${response.headers.get("content-type")?.includes("text/event-stream") ? "yes" : "no"}`
      );

      // Temporary rate-limit bypass for local testing
      if (response.status === 429) {
        logger.warn(
          "Anthropic rate limited the request – surfacing error to user as assistant message"
        );

        const rawBody =
          typeof body === "string"
            ? body
            : body
              ? JSON.stringify(body)
              : undefined;
        let requestedModel: string | undefined;
        if (rawBody) {
          try {
            requestedModel = JSON.parse(rawBody)?.model;
          } catch {
            requestedModel = undefined;
          }
        }

        const errorPayloadText = await response.text();
        let anthropicMessage =
          "The model provider returned a rate limit error. Please try again shortly.";
        try {
          const parsedError = JSON.parse(errorPayloadText);
          anthropicMessage =
            parsedError?.error?.message ||
            parsedError?.message ||
            anthropicMessage;
        } catch {
          if (errorPayloadText) {
            anthropicMessage = errorPayloadText;
          }
        }

        const userFacingText = `⚠️ *Rate limit*\n\n${anthropicMessage}`;

        const rateLimitResponse = {
          id: `msg_rate_limit_${Date.now()}`,
          type: "message",
          role: "assistant" as const,
          content: [
            {
              type: "text" as const,
              text: userFacingText,
            },
          ],
          model: requestedModel ?? "claude-3-5-sonnet-20241022",
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: {
            input_tokens: 0,
            output_tokens: 0,
          },
          rate_limited: true,
        };

        res
          .status(200)
          .setHeader("Content-Type", "application/json")
          .json(rateLimitResponse);
        return;
      }

      // Forward status code
      res.status(response.status);

      // Forward response headers
      response.headers.forEach((value: string, key: string) => {
        // Skip certain headers that shouldn't be forwarded
        // Also skip content-encoding since we're decompressing the response
        if (
          ![
            "transfer-encoding",
            "connection",
            "upgrade",
            "content-encoding",
          ].includes(key.toLowerCase())
        ) {
          res.setHeader(key, value);
        }
      });

      // Handle streaming responses
      if (
        response.headers.get("content-type")?.includes("text/event-stream") ||
        response.headers.get("transfer-encoding") === "chunked"
      ) {
        logger.info(
          `📡 Starting stream pipe to client - model: ${requestModel}`
        );
        // Set up streaming
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");

        // Pipe the response stream with error handling
        if (response.body) {
          let firstChunkReceived = false;
          let chunkCount = 0;
          const streamStartTime = Date.now();

          response.body.on("data", (chunk: Buffer) => {
            chunkCount++;

            if (!firstChunkReceived) {
              firstChunkReceived = true;
              const timeToFirstChunk = Date.now() - streamStartTime;
              logger.info(
                `📨 First stream chunk received from Anthropic after ${timeToFirstChunk}ms - chunkSize: ${chunk.length} bytes, model: ${requestModel}`
              );
            }

            // Log every 10th chunk to track stream progress without spam
            if (chunkCount % 10 === 0) {
              logger.debug(
                `📊 Stream progress: ${chunkCount} chunks received, latest size: ${chunk.length} bytes`
              );
            }
          });

          response.body.on("error", (error: Error) => {
            logger.error(`❌ Stream error from Anthropic:`, error);
          });

          response.body.on("end", () => {
            const streamDuration = Date.now() - streamStartTime;
            logger.info(
              `✅ Stream completed from Anthropic - duration: ${streamDuration}ms, totalChunks: ${chunkCount}, model: ${requestModel}`
            );
          });

          response.body.pipe(res);
        } else {
          logger.error(`❌ No response body to stream`);
          res.status(502).json({ error: "No response body from Anthropic" });
        }
      } else {
        // Handle regular responses
        const responseText = await response.text();
        res.send(responseText);
      }
    } catch (error) {
      logger.error("Error forwarding to Anthropic API:", error);
      res
        .status(502)
        .json({ error: "Bad gateway - failed to reach Anthropic API" });
    }
  }
}
