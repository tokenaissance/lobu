/**
 * Internal MCP Token Routes
 *
 * Worker-facing endpoint to retrieve stored MCP OAuth access tokens.
 * Used by plugins (e.g. owletto-openclaw) via tokenCommand to get
 * bearer tokens without going through the MCP proxy.
 */

import { createLogger } from "@lobu/core";
import { Hono } from "hono";
import type { McpConfigService } from "../../auth/mcp/config-service";
import type { McpCredentialStore } from "../../auth/mcp/credential-store";
import { GenericOAuth2Client } from "../../auth/oauth/generic-client";
import { authenticateWorker, type WorkerContext } from "./worker-auth";

const logger = createLogger("internal-mcp-token-routes");

export function createMcpTokenRoutes(
  credentialStore: McpCredentialStore,
  mcpConfigService: McpConfigService
): Hono<WorkerContext> {
  const router = new Hono<WorkerContext>();
  const oauth2Client = new GenericOAuth2Client();

  router.get("/internal/mcp-token/:mcpId", authenticateWorker, async (c) => {
    const worker = c.get("worker");
    const mcpId = c.req.param("mcpId");
    const agentId = worker.agentId || worker.userId;

    logger.info("MCP token request", { mcpId, agentId });

    // Look up stored credentials
    const credentials = await credentialStore.getCredentials(agentId, mcpId);
    if (!credentials) {
      logger.info("No credentials found", { mcpId, agentId });
      return c.text("No credentials", 401);
    }

    // Check if token is expired
    const now = Date.now();
    const isExpired = credentials.expiresAt && credentials.expiresAt < now;

    if (isExpired) {
      if (!credentials.refreshToken) {
        logger.info("Token expired, no refresh token", { mcpId, agentId });
        return c.text("Token expired", 401);
      }

      // Attempt refresh
      try {
        logger.info("Refreshing expired token", { mcpId, agentId });

        // Get OAuth config for this MCP server
        const httpServer = await mcpConfigService.getHttpServer(mcpId, agentId);
        const discoveredOAuth =
          await mcpConfigService.getDiscoveredOAuth(mcpId);

        let oauthConfig = httpServer?.oauth;

        if (!oauthConfig && discoveredOAuth?.metadata) {
          const discoveryService = mcpConfigService.getDiscoveryService();
          if (!discoveryService) {
            logger.error("No discovery service for refresh", { mcpId });
            return c.text("Token expired", 401);
          }

          const clientCredentials =
            await discoveryService.getOrCreateClientCredentials(
              mcpId,
              discoveredOAuth.metadata
            );
          if (!clientCredentials?.client_id) {
            logger.error("Failed to get client credentials for refresh", {
              mcpId,
            });
            return c.text("Token expired", 401);
          }

          oauthConfig = {
            authUrl: discoveredOAuth.metadata.authorization_endpoint,
            tokenUrl: discoveredOAuth.metadata.token_endpoint,
            clientId: clientCredentials.client_id,
            clientSecret: clientCredentials.client_secret || "",
            scopes: discoveredOAuth.metadata.scopes_supported || [],
            grantType: "authorization_code",
            responseType: "code",
            tokenEndpointAuthMethod:
              clientCredentials.token_endpoint_auth_method,
          };
        }

        if (!oauthConfig) {
          logger.error("No OAuth config available for refresh", { mcpId });
          return c.text("Token expired", 401);
        }

        const refreshed = await oauth2Client.refreshToken(
          credentials.refreshToken,
          oauthConfig
        );

        await credentialStore.setCredentials(agentId, mcpId, refreshed);
        logger.info("Token refreshed successfully", { mcpId, agentId });

        return c.text(refreshed.accessToken);
      } catch (error) {
        logger.error("Token refresh failed", { mcpId, agentId, error });
        return c.text("Token expired", 401);
      }
    }

    return c.text(credentials.accessToken);
  });

  logger.debug("Internal MCP token routes registered");
  return router;
}
