#!/usr/bin/env bun

import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import {
  buildMcpToolInstructions,
  createLogger,
  type PendingInteraction,
} from "@lobu/core";
import { ensureBaseUrl } from "../core/url-utils";

const logger = createLogger("claude-session");

interface MCPServerConfig {
  type?: "sse" | "stdio";
  url?: string;
  description?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  headers?: Record<string, string>;
}

interface MCPConfigResponse {
  mcpServers?: Record<string, MCPServerConfig>;
}

/**
 * MCP status from gateway
 */
interface McpStatus {
  id: string;
  name: string;
  requiresAuth: boolean;
  requiresInput: boolean;
  authenticated: boolean;
  configured: boolean;
}

/**
 * Session context response from gateway
 */
interface SessionContextResponse {
  mcpConfig?: MCPConfigResponse;
  platformInstructions: string;
  networkInstructions: string;
  workspaceFiles?: WorkspaceFiles;
  enabledSkills?: EnabledSkill[];
  skillsInstructions?: string;
  mcpStatus: McpStatus[];
  mcpTools?: Record<string, import("@lobu/core").McpToolDef[]>;
  unansweredInteractions: PendingInteraction[];
}

/**
 * Build MCP instructions from status data
 * Worker builds instructions so it can update them dynamically if MCP fails
 */
function buildMcpInstructions(mcpStatus: McpStatus[]): string {
  if (!mcpStatus || mcpStatus.length === 0) {
    return "";
  }

  // Find MCPs that need setup
  const unavailableMcps = mcpStatus.filter(
    (mcp) =>
      (mcp.requiresAuth && !mcp.authenticated) ||
      (mcp.requiresInput && !mcp.configured)
  );

  if (unavailableMcps.length === 0) {
    return "";
  }

  // Build instruction message
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
 * Fetch session context from gateway (unified endpoint)
 * Returns MCP config, platform instructions, MCP status data, and unanswered interactions
 */
export interface WorkspaceFiles {
  identityMd?: string;
  soulMd?: string;
  userMd?: string;
}

export interface EnabledSkill {
  name: string;
  repo: string;
  description?: string;
  content: string;
}

export async function getSessionContext(): Promise<{
  mcpServers?: Record<string, McpServerConfig>;
  gatewayInstructions: string;
  workspaceFiles: WorkspaceFiles;
  enabledSkills: EnabledSkill[];
  unansweredInteractions: PendingInteraction[];
}> {
  const dispatcherUrl = process.env.DISPATCHER_URL;
  const workerToken = process.env.WORKER_TOKEN;

  if (!dispatcherUrl || !workerToken) {
    logger.warn("Missing dispatcher URL or worker token for session context");
    return {
      gatewayInstructions: "",
      workspaceFiles: {},
      enabledSkills: [],
      unansweredInteractions: [],
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
      signal: AbortSignal.timeout(30_000), // 30s timeout
    });

    if (!response.ok) {
      logger.warn("Gateway returned non-success status for session context", {
        status: response.status,
      });
      return {
        gatewayInstructions: "",
        workspaceFiles: {},
        enabledSkills: [],
        unansweredInteractions: [],
      };
    }

    const data = (await response.json()) as SessionContextResponse;

    logger.info(
      `Received session context: ${Object.keys(data.mcpConfig?.mcpServers || {}).length} MCPs, ${data.platformInstructions.length} chars platform instructions, ${data.mcpStatus.length} MCP status entries`
    );

    // Convert gateway MCP format to SDK format, filtering out unauthenticated MCPs
    const sdkServers: Record<string, McpServerConfig> = {};

    if (data.mcpConfig?.mcpServers) {
      for (const [name, config] of Object.entries(data.mcpConfig.mcpServers)) {
        // Check if this MCP is authenticated/configured in status data
        const status = data.mcpStatus.find((s) => s.id === name);
        if (status) {
          // Skip if requires auth but not authenticated
          if (status.requiresAuth && !status.authenticated) {
            logger.info(
              `⏭️ Skipping MCP ${name} - authentication required but not authenticated`
            );
            continue;
          }
          // Skip if requires input but not configured
          if (status.requiresInput && !status.configured) {
            logger.info(
              `⏭️ Skipping MCP ${name} - configuration required but not configured`
            );
            continue;
          }
        }

        if (config.type === "sse" && config.url) {
          sdkServers[name] = {
            type: "http",
            url: config.url,
            headers: config.headers || {},
          };
          logger.info(`✅ Including HTTP MCP server: ${name}`);
        } else if (config.command) {
          sdkServers[name] = {
            command: config.command,
            args: config.args || [],
            env: config.env || {},
          };
          logger.info(`✅ Including stdio MCP server: ${name}`);
        } else {
          logger.warn(
            `Skipping MCP ${name} - no type=sse or command property`,
            {
              type: config.type,
              hasUrl: !!config.url,
              hasCommand: !!config.command,
            }
          );
        }
      }
    }

    // Build MCP instructions from status data
    const mcpInstructions = buildMcpInstructions(data.mcpStatus);
    const mcpToolInstructions =
      data.mcpTools && Object.keys(data.mcpTools).length > 0 && dispatcherUrl
        ? buildMcpToolInstructions(data.mcpTools, dispatcherUrl)
        : "";

    // Merge platform + network + skills + MCP instructions
    // Note: workspace instructions (SOUL.md, USER.md, IDENTITY.md) are handled
    // by WorkspaceFilesLocalProvider on the worker side (filesystem-first),
    // with gateway-provided content as fallback when no local files exist
    const gatewayInstructions = [
      data.platformInstructions,
      data.networkInstructions,
      data.skillsInstructions,
      mcpInstructions,
      mcpToolInstructions,
    ]
      .filter(Boolean)
      .join("\n\n");

    const wsFileCount = [
      data.workspaceFiles?.identityMd,
      data.workspaceFiles?.soulMd,
      data.workspaceFiles?.userMd,
    ].filter(Boolean).length;
    logger.info(
      `Built gateway instructions: platform (${data.platformInstructions.length} chars) + network (${data.networkInstructions.length} chars) + skills (${(data.skillsInstructions || "").length} chars) + MCP (${mcpInstructions.length} chars) + ${wsFileCount} workspace files from settings`
    );

    return {
      mcpServers: Object.keys(sdkServers).length > 0 ? sdkServers : undefined,
      gatewayInstructions,
      workspaceFiles: data.workspaceFiles || {},
      enabledSkills: data.enabledSkills || [],
      unansweredInteractions: data.unansweredInteractions || [],
    };
  } catch (error) {
    logger.error("Failed to fetch session context from gateway", { error });
    return {
      gatewayInstructions: "",
      workspaceFiles: {},
      enabledSkills: [],
      unansweredInteractions: [],
    };
  }
}
