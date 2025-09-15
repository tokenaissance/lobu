import { type Request, type Response, Router } from "express";
import fetch from "node-fetch";
import { Client as PgClient } from "pg";
import logger from "../logger";

export interface AnthropicProxyConfig {
  enabled: boolean;
  anthropicApiKey: string;
  postgresConnectionString: string;
  anthropicBaseUrl?: string;
}

export class AnthropicProxy {
  private router: Router;
  private config: AnthropicProxyConfig;

  constructor(config: AnthropicProxyConfig) {
    this.config = config;
    this.router = Router();
    this.setupRoutes();
  }

  getRouter(): Router {
    return this.router;
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
      // Extract PostgreSQL credentials from Authorization header or x-api-key header
      const authHeader = req.headers.authorization;
      const xApiKeyHeader = req.headers["x-api-key"] as string;

      let credentials = "";
      if (authHeader?.startsWith("Bearer ")) {
        credentials = authHeader.slice(7); // Remove "Bearer "
      } else if (xApiKeyHeader) {
        credentials = xApiKeyHeader;
      } else {
        res
          .status(401)
          .json({ error: "Missing or invalid authorization header" });
        return;
      }
      const [username, password] = credentials.split(":");

      if (!username || !password) {
        res.status(401).json({
          error: "Invalid credentials format. Expected 'username:password'",
        });
        return;
      }

      // Validate PostgreSQL credentials
      const isValidUser = await this.validatePostgresCredentials(
        username,
        password,
      );
      if (!isValidUser) {
        res.status(401).json({ error: "Invalid PostgreSQL credentials" });
        return;
      }

      // Forward request to Anthropic API
      await this.forwardToAnthropic(req, res);
    } catch (error) {
      logger.error("Anthropic proxy error:", error);
      res.status(500).json({ error: "Internal proxy error" });
    }
  }

  private async validatePostgresCredentials(
    username: string,
    password: string,
  ): Promise<boolean> {
    // Parse the base connection string and replace credentials
    const baseUrl = new URL(this.config.postgresConnectionString);
    const testConnectionString = `postgres://${username}:${password}@${baseUrl.host}${baseUrl.pathname}${baseUrl.search}`;

    const client = new PgClient({
      connectionString: testConnectionString,
      connectionTimeoutMillis: 5000,
      query_timeout: 5000,
    });

    try {
      await client.connect();
      // Simple query to verify connection works
      await client.query("SELECT 1");
      return true;
    } catch (error) {
      logger.debug(
        `PostgreSQL auth failed for user ${username}:`,
        (error as Error).message,
      );
      return false;
    } finally {
      try {
        await client.end();
      } catch (closeError) {
        logger.debug("Error closing PostgreSQL client:", closeError);
      }
    }
  }

  // No caching needed for OAuth tokens - they're used directly

  private async forwardToAnthropic(req: Request, res: Response): Promise<void> {
    // Check if we're using OAuth token (sk-ant-oat01-) vs API key (sk-ant-api03-)
    const isOAuthToken = this.config.anthropicApiKey.startsWith("sk-ant-oat");

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
      `🔧 Original body type: ${typeof body}, length: ${body ? (typeof body === "string" ? body.length : JSON.stringify(body).length) : 0}`,
    );

    if (isOAuthToken) {
      logger.info(`🔧 OAuth token detected - using Claude Code CLI pattern`);

      // Parse request body to check model
      let requestData: any = {};
      try {
        if (body) {
          requestData = typeof body === "string" ? JSON.parse(body) : body;
          logger.info(`🔧 Parsed request data:`, {
            model: requestData.model,
            hasMessages: !!requestData.messages,
          });
        }
      } catch (e) {
        logger.error(`🔧 Error parsing body:`, e);
        requestData = {};
      }

      const model = requestData.model || "";
      const isExpensiveModel = ["sonnet", "opus"].some((tier) =>
        model.toLowerCase().includes(tier),
      );

      if (isExpensiveModel) {
        logger.info(
          `🎯 Expensive model detected (${model}) - enhancing request for Claude Code CLI compatibility`,
        );

        // Transform request to look like Claude Code CLI
        const enhancedBody = { ...requestData };

        // Add Claude Code system prompt
        enhancedBody.system = [
          {
            type: "text",
            text: "You are Claude Code, Anthropic's official CLI for Claude.",
            cache_control: { type: "ephemeral" },
          },
        ];

        // Enhance messages with cache_control
        if (enhancedBody.messages?.[0]) {
          const msg = enhancedBody.messages[0];
          if (typeof msg.content === "string") {
            msg.content = [
              {
                type: "text",
                text: msg.content,
                cache_control: { type: "ephemeral" },
              },
            ];
          }
        }

        // Add tools array
        enhancedBody.tools = [
          {
            name: "Task",
            description:
              "Launch a new agent to handle complex, multi-step tasks autonomously.",
            input_schema: {
              type: "object",
              properties: {
                description: { type: "string" },
                prompt: { type: "string" },
                subagent_type: { type: "string" },
              },
              required: ["description", "prompt", "subagent_type"],
            },
          },
        ];

        // Add metadata
        enhancedBody.metadata = {
          user_id: `user_peerbot_${Date.now()}`,
        };

        // Ensure streaming and other CLI defaults
        enhancedBody.stream = enhancedBody.stream !== false; // Default to true
        enhancedBody.max_tokens = enhancedBody.max_tokens || 32000;
        enhancedBody.temperature = enhancedBody.temperature || 1;

        body = JSON.stringify(enhancedBody);
        logger.info(
          `📝 Enhanced body for expensive model (length: ${body.length})`,
        );
      } else {
        // For cheap models, use original body
        body = body
          ? typeof body === "string"
            ? body
            : JSON.stringify(body)
          : undefined;
      }

      // OAuth headers (Bearer, not x-api-key)
      headers.Authorization = `Bearer ${this.config.anthropicApiKey}`;
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

      // Set appropriate anthropic-beta based on model
      if (isExpensiveModel) {
        headers["anthropic-beta"] =
          "claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14";
        headers["x-stainless-helper-method"] = "stream";
      } else {
        headers["anthropic-beta"] =
          "oauth-2025-04-20,fine-grained-tool-streaming-2025-05-14";
      }

      logger.info(
        `🔧 Using OAuth token with Claude Code CLI pattern for ${isExpensiveModel ? "expensive" : "cheap"} model`,
      );
    } else {
      logger.info(`🔧 Using regular API key routing for public Anthropic API`);

      // Standard API headers for regular API keys
      headers["x-api-key"] = this.config.anthropicApiKey;
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

    logger.info(`🔧 Forwarding to: ${finalUrl}`);

    try {
      const response = await fetch(finalUrl, {
        method: req.method,
        headers,
        body: body,
      });

      // Forward status code
      res.status(response.status);

      // Forward response headers
      response.headers.forEach((value, key) => {
        // Skip certain headers that shouldn't be forwarded
        if (
          !["transfer-encoding", "connection", "upgrade"].includes(
            key.toLowerCase(),
          )
        ) {
          res.setHeader(key, value);
        }
      });

      // Handle streaming responses
      if (
        response.headers.get("content-type")?.includes("text/event-stream") ||
        response.headers.get("transfer-encoding") === "chunked"
      ) {
        // Set up streaming
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");

        // Pipe the response stream
        response.body?.pipe(res);
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

/**
 * Create and configure Anthropic proxy
 */
export function createAnthropicProxy(
  config: AnthropicProxyConfig,
): AnthropicProxy {
  return new AnthropicProxy(config);
}
