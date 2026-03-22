/**
 * Internal MCP Login Routes
 *
 * Worker-facing endpoint to trigger MCP OAuth login for the user.
 * Generates an MCP OAuth init URL and sends it as a link button.
 */

import { createLogger } from "@lobu/core";
import { Hono } from "hono";
import type { McpOAuthModule } from "../../auth/mcp/oauth-module";
import type { InteractionService } from "../../interactions";
import { authenticateWorker, type WorkerContext } from "./worker-auth";

const logger = createLogger("internal-mcp-login-routes");

export function createMcpLoginRoutes(
  mcpOAuthModule: McpOAuthModule,
  interactionService?: InteractionService
): Hono<WorkerContext> {
  const router = new Hono<WorkerContext>();

  router.post("/internal/mcp-login", authenticateWorker, async (c) => {
    const worker = c.get("worker");
    const { mcpId } = await c.req.json<{ mcpId: string }>();
    const { userId, platform } = worker;
    const agentId = worker.agentId || userId;

    if (!mcpId) {
      return c.json({ error: "Missing mcpId" }, 400);
    }

    logger.info("Generating MCP login link", {
      mcpId,
      agentId,
      userId,
      platform,
    });

    // Get auth status which includes login URLs (thread context flows into the
    // secure token so the OAuth callback can notify the originating conversation)
    const statuses = await mcpOAuthModule.getAuthStatus(userId, agentId, {
      conversationId: worker.conversationId,
      channelId: worker.channelId,
      teamId: worker.teamId,
      platform,
      connectionId: worker.connectionId,
    });
    const mcpStatus = statuses.find((s) => s.id === mcpId);

    if (!mcpStatus) {
      return c.json({ error: `MCP '${mcpId}' not found` }, 404);
    }

    if (!mcpStatus.loginUrl) {
      return c.json(
        { error: `MCP '${mcpId}' does not support OAuth login` },
        400
      );
    }

    // Send login button to user via interaction service
    if (interactionService) {
      await interactionService.postLinkButton(
        userId,
        worker.conversationId,
        worker.channelId,
        worker.teamId,
        worker.connectionId,
        platform || "unknown",
        mcpStatus.loginUrl,
        `Login to ${mcpStatus.name}`,
        "oauth"
      );

      return c.json({
        type: "mcp_login_link",
        message: `Login button for ${mcpStatus.name} sent to the user.`,
      });
    }

    // Fallback: return the URL directly
    return c.json({
      type: "mcp_login_url",
      url: mcpStatus.loginUrl,
      message: `Send this login link to the user: ${mcpStatus.loginUrl}`,
    });
  });

  logger.debug("Internal MCP login routes registered");
  return router;
}
