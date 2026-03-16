import {
  type ConfigProviderMeta,
  createLogger,
  type IntegrationInfo,
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
  /** Credential env var placeholders for proxy mode (e.g. Z_AI_API_KEY → "lobu-proxy") */
  credentialPlaceholders?: Record<string, string>;
}

interface SkillContent {
  name: string;
  content: string;
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
  integrationStatus?: IntegrationInfo[];
  skillsConfig?: SkillContent[];
}

// Module-level cache for session context
let cachedResult: {
  gatewayInstructions: string;
  providerConfig: ProviderConfig;
  skillsConfig: SkillContent[];
  mcpTools: Record<string, McpToolDef[]>;
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

function buildIntegrationInstructions(integrations: IntegrationInfo[]): string {
  if (!integrations || integrations.length === 0) {
    return "";
  }

  const lines: string[] = [
    "## Integrations\n\nConfigured third-party integrations. Use CallService to make authenticated API calls.",
  ];

  for (const ig of integrations) {
    const tag = `[${ig.authType || "oauth"}]`;
    const header = `- ${tag} **${ig.label}** (\`${ig.id}\`)`;
    const api = ig.apiBase
      ? `\n  API: \`${ig.apiBase}\`${ig.apiHints ? ` — ${ig.apiHints}` : ""}`
      : "";

    if (!ig.connected || ig.accounts.length === 0) {
      const scopes =
        ig.availableScopes.length > 0
          ? ` (available scopes: ${ig.availableScopes.join(", ")})`
          : "";
      lines.push(`${header} — not connected${scopes}${api}`);
    } else if (ig.authType === "api-key" || ig.accounts.length === 1) {
      lines.push(`${header} — connected${api}`);
    } else {
      const details = ig.accounts
        .map(
          (a) =>
            `  - **${a.accountId}**: ${a.grantedScopes.join(", ") || "default"}`
        )
        .join("\n");
      lines.push(
        `${header} — ${ig.accounts.length} accounts\n${details}${api}`
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
  skillsConfig: SkillContent[];
  mcpTools: Record<string, McpToolDef[]>;
}> {
  if (cachedResult) {
    logger.debug("Returning cached session context");
    return cachedResult;
  }

  const dispatcherUrl = process.env.DISPATCHER_URL;
  const workerToken = process.env.WORKER_TOKEN;

  if (!dispatcherUrl || !workerToken) {
    logger.warn("Missing dispatcher URL or worker token for session context");
    return {
      gatewayInstructions: "",
      providerConfig: {},
      skillsConfig: [],
      mcpTools: {},
    };
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
      return {
        gatewayInstructions: "",
        providerConfig: {},
        skillsConfig: [],
        mcpTools: {},
      };
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
    const integrationInstructions = buildIntegrationInstructions(
      data.integrationStatus || []
    );

    // MCP tools are now exposed as first-class callable tools (not curl instructions).
    // Only include server instructions for context.
    const gatewayInstructions = [
      data.agentInstructions,
      data.platformInstructions,
      data.networkInstructions,
      data.skillsInstructions,
      mcpSetupInstructions,
      mcpServerInstructions,
      integrationInstructions,
    ]
      .filter(Boolean)
      .join("\n\n");

    const mcpTools = data.mcpTools || {};

    logger.info(
      `Built gateway instructions: agent (${(data.agentInstructions || "").length} chars) + platform (${data.platformInstructions.length} chars) + network (${data.networkInstructions.length} chars) + skills (${(data.skillsInstructions || "").length} chars) + MCP setup (${mcpSetupInstructions.length} chars) + MCP server instructions (${mcpServerInstructions.length} chars) + integrations (${integrationInstructions.length} chars), mcpTools: ${Object.keys(mcpTools).length} servers`
    );

    const result = {
      gatewayInstructions,
      providerConfig: data.providerConfig || {},
      skillsConfig: data.skillsConfig || [],
      mcpTools,
    };
    cachedResult = result;
    return result;
  } catch (error) {
    logger.error("Failed to fetch session context from gateway", { error });
    return {
      gatewayInstructions: "",
      providerConfig: {},
      skillsConfig: [],
      mcpTools: {},
    };
  }
}
