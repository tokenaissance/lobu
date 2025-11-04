#!/usr/bin/env bun

import { existsSync } from "node:fs";
import path from "node:path";
import type { AgentOptions, LogLevel } from "@peerbot/core";
import { createLogger, TIME } from "@peerbot/core";
import { config as dotenvConfig } from "dotenv";
import { DEFAULTS } from "../config/constants";
import type { OrchestratorConfig } from "../orchestration/base-deployment-manager";
import type { SlackConfig } from "../slack/config";

const logger = createLogger("cli-config");

/**
 * Complete gateway configuration - single source of truth
 * Platform-specific configs (like Slack) are built separately
 */
export interface GatewayConfig {
  // TODO: can we use "agent" instead of "claude" here? Also why is this Partial investigate?
  claude: Partial<AgentOptions>;
  sessionTimeoutMinutes: number;
  logLevel: LogLevel;
  queues: {
    connectionString: string;
    directMessage: string;
    messageQueue: string;
    retryLimit: number;
    retryDelay: number;
    expireInHours: number;
  };
  anthropicProxy: {
    enabled: boolean;
    anthropicApiKey: string;
    anthropicBaseUrl?: string;
  };
  orchestration: OrchestratorConfig;
  mcp: {
    serversUrl?: string;
    publicGatewayUrl: string;
    callbackUrl: string;
  };
  health: {
    checkIntervalMs: number;
    staleThresholdMs: number;
    protectActiveWorkers: boolean;
  };
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/**
 * Load environment variables from .env file if in non-production
 */
export function loadEnvFile(envPath?: string): void {
  if (process.env.NODE_ENV === "production") {
    logger.info("Production mode - skipping .env file");
    return;
  }

  const envProvided = Boolean(envPath);
  const resolvedPath = envProvided
    ? path.resolve(process.cwd(), envPath!)
    : path.resolve(process.cwd(), ".env");

  if (existsSync(resolvedPath)) {
    dotenvConfig({ path: resolvedPath });
    logger.debug(`Loaded environment variables from ${resolvedPath}`);
  } else if (envProvided) {
    logger.warn(
      `Specified env file ${resolvedPath} was not found; continuing without it.`
    );
  } else {
    logger.debug("No .env file found; relying on process environment.");
  }
}

/**
 * Get required environment variable or throw
 */
function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new ConfigError(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * Get optional environment variable with default
 */
function getOptionalEnv(name: string, defaultValue: string): string {
  return process.env[name] || defaultValue;
}

/**
 * Get optional number environment variable with default
 */
function getOptionalNumber(name: string, defaultValue: number): number {
  const value = process.env[name];
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new ConfigError(
      `Invalid number for ${name}: ${value} (expected integer)`
    );
  }
  return parsed;
}

/**
 * Get optional boolean environment variable with default
 */
function getOptionalBoolean(name: string, defaultValue: boolean): boolean {
  const value = process.env[name];
  if (!value) return defaultValue;
  return value === "true";
}

/**
 * Build Slack-specific configuration from environment variables
 */
export function buildSlackConfig(): SlackConfig {
  const botToken = getRequiredEnv("SLACK_BOT_TOKEN");
  const socketMode = process.env.SLACK_HTTP_MODE !== "true";

  return {
    token: botToken,
    appToken: process.env.SLACK_APP_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    socketMode,
    port: getOptionalNumber("PORT", DEFAULTS.HTTP_PORT),
    botUserId: process.env.SLACK_BOT_USER_ID,
    botId: undefined, // Will be set during initialization
    apiUrl: getOptionalEnv("SLACK_API_URL", DEFAULTS.SLACK_API_URL),
  };
}

/**
 * Build complete gateway configuration from environment variables
 * This is the SINGLE source of truth for all configuration
 */
export function buildGatewayConfig(): GatewayConfig {
  logger.info("Building gateway configuration from environment variables");

  // Required variables
  const connectionString = getRequiredEnv("QUEUE_URL");

  // Anthropic API key (now optional - can use per-user OAuth instead)
  const anthropicApiKey =
    process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN || "";

  if (!anthropicApiKey) {
    logger.warn(
      "No system ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN configured. " +
        "Users will need to authenticate via Claude OAuth in Slack home tab."
    );
  }

  // Build MCP config
  const mcpServersUrl = process.env.PEERBOT_MCP_SERVERS_URL;
  const publicGatewayUrl = getOptionalEnv(
    "PUBLIC_GATEWAY_URL",
    DEFAULTS.PUBLIC_GATEWAY_URL
  );
  const callbackUrl = `${publicGatewayUrl}/mcp/oauth/callback`;

  // Build configuration
  const config: GatewayConfig = {
    claude: {
      allowedTools: process.env.ALLOWED_TOOLS?.split(","),
      disallowedTools: process.env.DISALLOWED_TOOLS?.split(","),
      model: process.env.AGENT_DEFAULT_MODEL,
      timeoutMinutes: process.env.TIMEOUT_MINUTES
        ? Number(process.env.TIMEOUT_MINUTES)
        : undefined,
    },
    sessionTimeoutMinutes: getOptionalNumber(
      "SESSION_TIMEOUT_MINUTES",
      DEFAULTS.SESSION_TIMEOUT_MINUTES
    ),
    logLevel: (process.env.LOG_LEVEL as LogLevel) || DEFAULTS.LOG_LEVEL,
    queues: {
      connectionString,
      directMessage: getOptionalEnv(
        "QUEUE_DIRECT_MESSAGE",
        DEFAULTS.QUEUE_DIRECT_MESSAGE
      ),
      messageQueue: getOptionalEnv(
        "QUEUE_MESSAGE_QUEUE",
        DEFAULTS.QUEUE_MESSAGE_QUEUE
      ),
      retryLimit: getOptionalNumber(
        "QUEUE_RETRY_LIMIT",
        DEFAULTS.QUEUE_RETRY_LIMIT
      ),
      retryDelay: getOptionalNumber(
        "QUEUE_RETRY_DELAY",
        DEFAULTS.QUEUE_RETRY_DELAY_SECONDS
      ),
      expireInHours: getOptionalNumber(
        "QUEUE_EXPIRE_HOURS",
        DEFAULTS.QUEUE_EXPIRE_HOURS
      ),
    },
    anthropicProxy: {
      enabled: true,
      anthropicApiKey,
      anthropicBaseUrl: process.env.ANTHROPIC_BASE_URL,
    },
    orchestration: {
      queues: {
        connectionString,
        retryLimit: getOptionalNumber(
          "QUEUE_RETRY_LIMIT",
          DEFAULTS.QUEUE_RETRY_LIMIT
        ),
        retryDelay: getOptionalNumber(
          "QUEUE_RETRY_DELAY",
          DEFAULTS.QUEUE_RETRY_DELAY_SECONDS
        ),
        expireInSeconds:
          getOptionalNumber("QUEUE_EXPIRE_HOURS", DEFAULTS.QUEUE_EXPIRE_HOURS) *
          TIME.HOUR_SECONDS,
      },
      worker: {
        image: {
          repository: getOptionalEnv(
            "WORKER_IMAGE_REPOSITORY",
            DEFAULTS.WORKER_IMAGE_REPOSITORY
          ),
          tag: getOptionalEnv("WORKER_IMAGE_TAG", DEFAULTS.WORKER_IMAGE_TAG),
          pullPolicy: getOptionalEnv(
            "WORKER_IMAGE_PULL_POLICY",
            DEFAULTS.WORKER_IMAGE_PULL_POLICY
          ),
        },
        runtimeClassName: getOptionalEnv(
          "WORKER_RUNTIME_CLASS_NAME",
          DEFAULTS.WORKER_RUNTIME_CLASS_NAME
        ),
        resources: {
          requests: {
            cpu: getOptionalEnv(
              "WORKER_CPU_REQUEST",
              DEFAULTS.WORKER_CPU_REQUEST
            ),
            memory: getOptionalEnv(
              "WORKER_MEMORY_REQUEST",
              DEFAULTS.WORKER_MEMORY_REQUEST
            ),
          },
          limits: {
            cpu: getOptionalEnv("WORKER_CPU_LIMIT", DEFAULTS.WORKER_CPU_LIMIT),
            memory: getOptionalEnv(
              "WORKER_MEMORY_LIMIT",
              DEFAULTS.WORKER_MEMORY_LIMIT
            ),
          },
        },
        idleCleanupMinutes: getOptionalNumber(
          "WORKER_IDLE_CLEANUP_MINUTES",
          DEFAULTS.WORKER_IDLE_CLEANUP_MINUTES
        ),
        maxDeployments: getOptionalNumber(
          "MAX_WORKER_DEPLOYMENTS",
          DEFAULTS.MAX_WORKER_DEPLOYMENTS
        ),
      },
      kubernetes: {
        namespace: getOptionalEnv(
          "KUBERNETES_NAMESPACE",
          DEFAULTS.KUBERNETES_NAMESPACE
        ),
      },
      cleanup: {
        initialDelayMs: getOptionalNumber(
          "CLEANUP_INITIAL_DELAY_MS",
          DEFAULTS.CLEANUP_INITIAL_DELAY_MS
        ),
        intervalMs: getOptionalNumber(
          "CLEANUP_INTERVAL_MS",
          DEFAULTS.CLEANUP_INTERVAL_MS
        ),
        veryOldDays: getOptionalNumber(
          "CLEANUP_VERY_OLD_DAYS",
          DEFAULTS.CLEANUP_VERY_OLD_DAYS
        ),
      },
    },
    mcp: {
      serversUrl: mcpServersUrl,
      publicGatewayUrl,
      callbackUrl,
    },
    health: {
      checkIntervalMs: getOptionalNumber(
        "SOCKET_HEALTH_CHECK_INTERVAL_MS",
        DEFAULTS.SOCKET_HEALTH_CHECK_INTERVAL_MS
      ),
      staleThresholdMs: getOptionalNumber(
        "SOCKET_STALE_THRESHOLD_MS",
        DEFAULTS.SOCKET_STALE_THRESHOLD_MS
      ),
      protectActiveWorkers: getOptionalBoolean(
        "SOCKET_PROTECT_ACTIVE_WORKERS",
        DEFAULTS.SOCKET_PROTECT_ACTIVE_WORKERS
      ),
    },
  };

  logger.info("Gateway configuration built successfully");

  return config;
}

/**
 * Validate configuration and display it
 */
export function displayConfig(
  config: GatewayConfig,
  slackConfig: SlackConfig
): void {
  const { DISPLAY } = require("../config/constants");
  const separator = "=".repeat(DISPLAY.SEPARATOR_LENGTH);

  console.log("Gateway Configuration:");
  console.log(separator);
  console.log("\nSlack:");
  console.log(
    `  Mode: ${slackConfig.socketMode ? "Socket Mode" : "HTTP Mode"}`
  );
  console.log(`  Port: ${slackConfig.port}`);
  console.log(
    `  Bot Token: ${slackConfig.token?.substring(0, DISPLAY.TOKEN_PREVIEW_LENGTH)}... (${slackConfig.token.length} chars)`
  );
  console.log(
    `  App Token: ${slackConfig.appToken ? `${slackConfig.appToken.substring(0, DISPLAY.TOKEN_PREVIEW_LENGTH)}... (${slackConfig.appToken.length} chars)` : "not set"}`
  );
  console.log(`  API URL: ${slackConfig.apiUrl}`);

  console.log("\nQueues:");
  console.log(
    `  Connection: ${config.queues.connectionString.substring(0, 30)}...`
  );
  console.log(`  Retry Limit: ${config.queues.retryLimit}`);
  console.log(`  Retry Delay: ${config.queues.retryDelay}s`);

  console.log("\nMCP:");
  console.log(`  Servers URL: ${config.mcp.serversUrl || "not set"}`);
  console.log(`  Public Gateway: ${config.mcp.publicGatewayUrl}`);
  console.log(`  OAuth Callback: ${config.mcp.callbackUrl}`);

  console.log("\nOrchestration:");
  console.log(
    `  Worker Image: ${config.orchestration.worker.image.repository}`
  );
  console.log(`  Worker Tag: ${config.orchestration.worker.image.tag}`);
  console.log(
    `  Max Deployments: ${config.orchestration.worker.maxDeployments}`
  );

  console.log("\nHealth:");
  console.log(`  Socket Check Interval: ${config.health.checkIntervalMs}ms`);
  console.log(`  Socket Stale Threshold: ${config.health.staleThresholdMs}ms`);
  console.log(
    `  Protect Active Workers: ${config.health.protectActiveWorkers}`
  );

  console.log(`\n${separator}`);
}
