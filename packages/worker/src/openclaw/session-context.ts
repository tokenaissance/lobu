import { createLogger, type PendingInteraction } from "@lobu/core";
import { ensureBaseUrl } from "../core/url-utils";

const logger = createLogger("openclaw-session-context");

interface McpStatus {
  id: string;
  name: string;
  requiresAuth: boolean;
  requiresInput: boolean;
  authenticated: boolean;
  configured: boolean;
}

interface SessionContextResponse {
  platformInstructions: string;
  networkInstructions: string;
  mcpStatus: McpStatus[];
  unansweredInteractions: PendingInteraction[];
}

function buildMcpInstructions(mcpStatus: McpStatus[]): string {
  if (!mcpStatus || mcpStatus.length === 0) {
    return "";
  }

  const unavailableMcps = mcpStatus.filter(
    (mcp) =>
      (mcp.requiresAuth && !mcp.authenticated) ||
      (mcp.requiresInput && !mcp.configured)
  );

  if (unavailableMcps.length === 0) {
    return "";
  }

  const lines: string[] = ["## MCP Tools Requiring Setup"];

  for (const mcp of unavailableMcps) {
    const reasons: string[] = [];
    if (mcp.requiresAuth && !mcp.authenticated) {
      reasons.push("OAuth authentication");
    }
    if (mcp.requiresInput && !mcp.configured) {
      reasons.push("configuration");
    }

    lines.push(
      `- ⚠️ **${mcp.name}**: Requires ${reasons.join(" and ")} - visit homepage to set up`
    );
  }

  return lines.join("\n");
}

/**
 * Fetch session context from gateway for OpenClaw worker.
 * Returns gateway instructions and unanswered interactions.
 * Skips MCP server config (OpenClaw doesn't use Claude SDK's MCP format).
 */
export async function getOpenClawSessionContext(): Promise<{
  gatewayInstructions: string;
  unansweredInteractions: PendingInteraction[];
}> {
  const dispatcherUrl = process.env.DISPATCHER_URL;
  const workerToken = process.env.WORKER_TOKEN;

  if (!dispatcherUrl || !workerToken) {
    logger.warn("Missing dispatcher URL or worker token for session context");
    return { gatewayInstructions: "", unansweredInteractions: [] };
  }

  try {
    const url = new URL(
      "/worker/session-context",
      ensureBaseUrl(dispatcherUrl)
    );
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${workerToken}`,
      },
    });

    if (!response.ok) {
      logger.warn("Gateway returned non-success status for session context", {
        status: response.status,
      });
      return { gatewayInstructions: "", unansweredInteractions: [] };
    }

    const data = (await response.json()) as SessionContextResponse;

    logger.info(
      `Received session context: ${data.platformInstructions.length} chars platform instructions, ${data.mcpStatus.length} MCP status entries`
    );

    const mcpInstructions = buildMcpInstructions(data.mcpStatus);

    const gatewayInstructions = [
      data.platformInstructions,
      data.networkInstructions,
      mcpInstructions,
    ]
      .filter(Boolean)
      .join("\n\n");

    logger.info(
      `Built gateway instructions: platform (${data.platformInstructions.length} chars) + network (${data.networkInstructions.length} chars) + MCP (${mcpInstructions.length} chars)`
    );

    return {
      gatewayInstructions,
      unansweredInteractions: data.unansweredInteractions || [],
    };
  } catch (error) {
    logger.error("Failed to fetch session context from gateway", { error });
    return { gatewayInstructions: "", unansweredInteractions: [] };
  }
}
