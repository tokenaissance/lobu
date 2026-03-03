import {
  buildMcpToolInstructions,
  type ConfigProviderMeta,
  createLogger,
  type McpToolDef,
} from "@lobu/core";
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

export interface ProviderConfig {
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
  /** Dynamic provider metadata from config-driven providers */
  configProviders?: Record<string, ConfigProviderMeta>;
}

interface IntegrationAccountStatus {
  accountId: string;
  grantedScopes: string[];
}

interface IntegrationStatus {
  id: string;
  label: string;
  authType: string;
  connected: boolean;
  accounts: IntegrationAccountStatus[];
  availableScopes: string[];
}

interface SessionContextResponse {
  agentInstructions: string;
  platformInstructions: string;
  networkInstructions: string;
  skillsInstructions: string;
  mcpStatus: McpStatus[];
  mcpTools?: Record<string, McpToolDef[]>;
  mcpInstructions?: Record<string, string>;
  providerConfig?: ProviderConfig;
  integrationStatus?: IntegrationStatus[];
}

// Module-level cache for session context
let cachedResult: {
  gatewayInstructions: string;
  providerConfig: ProviderConfig;
} | null = null;

/**
 * Invalidate the session context cache.
 * Called by the SSE client when a config_changed event is received.
 */
export function invalidateSessionContextCache(): void {
  cachedResult = null;
  logger.info("Session context cache invalidated");
}

function buildMcpInstructions(
  mcpStatus: McpStatus[],
  mcpToolIds: Set<string>
): string {
  if (!mcpStatus || mcpStatus.length === 0) {
    return "";
  }

  // MCPs with no tools at all that need setup
  const undiscoveredMcps = mcpStatus.filter(
    (mcp) =>
      !mcpToolIds.has(mcp.id) &&
      ((mcp.requiresAuth && !mcp.authenticated) ||
        (mcp.requiresInput && !mcp.configured))
  );

  // MCPs with tools visible but still needing auth to use them
  const unauthenticatedMcps = mcpStatus.filter(
    (mcp) => mcpToolIds.has(mcp.id) && mcp.requiresAuth && !mcp.authenticated
  );

  if (undiscoveredMcps.length === 0 && unauthenticatedMcps.length === 0) {
    return "";
  }

  const lines: string[] = ["## MCP Tools Requiring Setup"];

  for (const mcp of undiscoveredMcps) {
    const reasons: string[] = [];
    if (mcp.requiresAuth && !mcp.authenticated) {
      reasons.push("OAuth authentication");
    }
    if (mcp.requiresInput && !mcp.configured) {
      reasons.push("configuration");
    }

    lines.push(
      `- ⚠️ **${mcp.name}** (id: ${mcp.id}): Requires ${reasons.join(" and ")}. Call ConnectService(id="${mcp.id}") to authenticate and see available tools.`
    );
  }

  for (const mcp of unauthenticatedMcps) {
    lines.push(
      `- ⚠️ **${mcp.name}** (id: ${mcp.id}): Tools are visible but require authentication to use. Call ConnectService(id="${mcp.id}") to authenticate.`
    );
  }

  return lines.join("\n");
}

function buildMcpServerInstructions(
  mcpInstructions: Record<string, string>
): string {
  const entries = Object.entries(mcpInstructions).filter(([, v]) => v);
  if (entries.length === 0) return "";

  const lines: string[] = ["## MCP Server Instructions", ""];
  for (const [mcpId, instructions] of entries) {
    lines.push(`### ${mcpId}`, "", instructions, "");
  }
  return lines.join("\n");
}

function buildIntegrationInstructions(
  integrations: IntegrationStatus[]
): string {
  if (!integrations || integrations.length === 0) {
    return "";
  }

  const lines: string[] = [
    "## Integrations\n\nConfigured third-party integrations. Use CallService to make authenticated API calls.",
  ];

  for (const integration of integrations) {
    const authTag = `[${integration.authType || "oauth"}]`;
    if (integration.connected && integration.accounts.length > 0) {
      if (integration.authType === "api-key") {
        lines.push(
          `- ${authTag} **${integration.label}** (\`${integration.id}\`) — connected`
        );
      } else {
        const accountDetails = integration.accounts
          .map((a) => {
            const scopes =
              a.grantedScopes.length > 0
                ? a.grantedScopes.join(", ")
                : "default";
            return `  - **${a.accountId}**: ${scopes}`;
          })
          .join("\n");
        lines.push(
          `- ${authTag} **${integration.label}** (\`${integration.id}\`) — ${integration.accounts.length} account(s) connected\n${accountDetails}`
        );
      }
    } else {
      const scopeInfo =
        integration.availableScopes.length > 0
          ? ` (available scopes: ${integration.availableScopes.join(", ")})`
          : "";
      lines.push(
        `- ${authTag} **${integration.label}** (\`${integration.id}\`) — not connected${scopeInfo}`
      );
    }
  }

  return lines.join("\n");
}

/**
 * Fetch session context from gateway for OpenClaw worker.
 * Returns gateway instructions and dynamic provider configuration.
 * Caches the result until invalidated by a config_changed SSE event.
 * Skips MCP server config (OpenClaw doesn't use Claude SDK's MCP format).
 */
export async function getOpenClawSessionContext(): Promise<{
  gatewayInstructions: string;
  providerConfig: ProviderConfig;
}> {
  if (cachedResult) {
    logger.debug("Returning cached session context");
    return cachedResult;
  }

  const dispatcherUrl = process.env.DISPATCHER_URL;
  const workerToken = process.env.WORKER_TOKEN;

  if (!dispatcherUrl || !workerToken) {
    logger.warn("Missing dispatcher URL or worker token for session context");
    return { gatewayInstructions: "", providerConfig: {} };
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
      return { gatewayInstructions: "", providerConfig: {} };
    }

    const data = (await response.json()) as SessionContextResponse;

    logger.info(
      `Received session context: ${data.platformInstructions.length} chars platform instructions, ${data.mcpStatus.length} MCP status entries, provider: ${data.providerConfig?.defaultProvider || "none"}, cliBackends: ${data.providerConfig?.cliBackends?.map((b) => b.name).join(", ") || "none"}`
    );

    const toolMcpIds = new Set(Object.keys(data.mcpTools || {}));
    const mcpSetupInstructions = buildMcpInstructions(
      data.mcpStatus,
      toolMcpIds
    );
    // Server instructions for MCPs that have tools are co-located in mcpToolInstructions.
    // Build a separate section only for servers with instructions but no tools.
    const instructionsOnlyMcps: Record<string, string> = {};
    for (const [id, instr] of Object.entries(data.mcpInstructions || {})) {
      if (instr && !toolMcpIds.has(id)) {
        instructionsOnlyMcps[id] = instr;
      }
    }
    const mcpServerInstructions =
      buildMcpServerInstructions(instructionsOnlyMcps);
    const mcpToolInstructions =
      data.mcpTools && Object.keys(data.mcpTools).length > 0
        ? buildMcpToolInstructions(
            data.mcpTools,
            dispatcherUrl,
            data.mcpInstructions
          )
        : "";
    const integrationInstructions = buildIntegrationInstructions(
      data.integrationStatus || []
    );

    const gatewayInstructions = [
      data.agentInstructions,
      data.platformInstructions,
      data.networkInstructions,
      data.skillsInstructions,
      mcpSetupInstructions,
      mcpServerInstructions,
      mcpToolInstructions,
      integrationInstructions,
    ]
      .filter(Boolean)
      .join("\n\n");

    logger.info(
      `Built gateway instructions: agent (${(data.agentInstructions || "").length} chars) + platform (${data.platformInstructions.length} chars) + network (${data.networkInstructions.length} chars) + skills (${(data.skillsInstructions || "").length} chars) + MCP setup (${mcpSetupInstructions.length} chars) + MCP server instructions (${mcpServerInstructions.length} chars) + integrations (${integrationInstructions.length} chars)`
    );

    const result = {
      gatewayInstructions,
      providerConfig: data.providerConfig || {},
    };
    cachedResult = result;
    return result;
  } catch (error) {
    logger.error("Failed to fetch session context from gateway", { error });
    return { gatewayInstructions: "", providerConfig: {} };
  }
}
