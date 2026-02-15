/**
 * Slack-specific configuration and constants
 */

import {
  type AgentOptions as CoreAgentOptions,
  getOptionalEnv,
  getOptionalNumber,
} from "@lobu/core";
import type { LogLevel } from "@slack/bolt";

// ============================================================================
// Defaults
// ============================================================================

const SLACK_DEFAULTS = {
  HTTP_PORT: 3000,
  SLACK_API_URL: "https://slack.com/api",
} as const;

// ============================================================================
// Constants
// ============================================================================

export const SLACK = {
  /** Maximum number of blocks in a Slack message */
  MAX_BLOCKS: 50,
  /** Maximum characters per block text */
  MAX_BLOCK_TEXT_LENGTH: 3000,
} as const;

// ============================================================================
// Types
// ============================================================================

export type AgentOptions = CoreAgentOptions;

export interface SlackConfig {
  token: string;
  appToken?: string;
  signingSecret?: string;
  socketMode: boolean;
  port: number;
  botUserId?: string;
  botId?: string;
  apiUrl: string;
}

/**
 * Platform-agnostic configuration needed by Slack platform
 */
export interface SlackPlatformConfig {
  slack: SlackConfig;
  logLevel: LogLevel;
  health: {
    checkIntervalMs: number;
    staleThresholdMs: number;
    protectActiveWorkers: boolean;
  };
}

/**
 * Message handler configuration
 */
export interface MessageHandlerConfig {
  slack: SlackConfig;
  agentOptions: AgentOptions;
  sessionTimeoutMinutes: number;
}

// ============================================================================
// Configuration Builder
// ============================================================================

/**
 * Build Slack-specific configuration from environment variables
 * Returns null if SLACK_BOT_TOKEN is not set (Slack disabled)
 */
export function buildSlackConfig(): SlackConfig | null {
  const botToken = process.env.SLACK_BOT_TOKEN;

  // If no bot token, Slack is disabled
  if (!botToken) {
    return null;
  }

  const socketMode = process.env.SLACK_HTTP_MODE !== "true";

  return {
    token: botToken,
    appToken: process.env.SLACK_APP_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    socketMode,
    port: getOptionalNumber("PORT", SLACK_DEFAULTS.HTTP_PORT),
    botUserId: process.env.SLACK_BOT_USER_ID,
    botId: undefined, // Will be set during initialization
    apiUrl: getOptionalEnv("SLACK_API_URL", SLACK_DEFAULTS.SLACK_API_URL),
  };
}

/**
 * Display Slack configuration
 */
export function displaySlackConfig(
  config: SlackConfig | null,
  tokenPreviewLength = 10
): void {
  if (config) {
    console.log("\nSlack:");
    console.log(`  Mode: ${config.socketMode ? "Socket Mode" : "HTTP Mode"}`);
    console.log(`  Port: ${config.port}`);
    console.log(
      `  Bot Token: ${config.token?.substring(0, tokenPreviewLength)}... (${config.token.length} chars)`
    );
    console.log(
      `  App Token: ${config.appToken ? `${config.appToken.substring(0, tokenPreviewLength)}... (${config.appToken.length} chars)` : "not set"}`
    );
    console.log(`  API URL: ${config.apiUrl}`);
  } else {
    console.log("\nSlack: disabled");
  }
}
