import http from "node:http";
import express from "express";
import { createLogger } from "@peerbot/shared";

const logger = createLogger("http");
import { GitHubOAuthHandler } from "./oauth/github-oauth-handler";
import type { AnthropicProxy } from "./proxy/anthropic-proxy";

let healthServer: http.Server | null = null;
let proxyApp: express.Application | null = null;
let oauthHandler: GitHubOAuthHandler | null = null;

export function setupHealthEndpoints(
  anthropicProxy?: AnthropicProxy,
  databaseUrl?: string,
  homeTabUpdateCallback?: (userId: string) => Promise<void>
) {
  if (healthServer) return;

  // Create Express app for proxy and health endpoints
  proxyApp = express();

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

  // Add GitHub OAuth endpoints if database URL is provided
  if (databaseUrl && process.env.GITHUB_CLIENT_ID) {
    oauthHandler = new GitHubOAuthHandler(databaseUrl, homeTabUpdateCallback);

    proxyApp.get("/api/github/oauth/authorize", (req, res) =>
      oauthHandler!.handleAuthorize(req, res)
    );

    proxyApp.get("/api/github/oauth/callback", (req, res) =>
      oauthHandler!.handleCallback(req, res)
    );

    proxyApp.post("/api/github/logout", (req, res) =>
      oauthHandler!.handleLogout(req, res)
    );

    logger.info(
      "✅ GitHub OAuth endpoints enabled at :8080/api/github/oauth/*"
    );
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
