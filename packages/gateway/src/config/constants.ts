#!/usr/bin/env bun

import { DEFAULTS as CORE_DEFAULTS, REDIS_KEYS, TIME } from "@peerbot/core";

/**
 * Gateway-specific constants
 * Core constants (TIME, REDIS_KEYS, core DEFAULTS) are imported from @peerbot/core
 * This file contains gateway-specific configuration values
 */

// Re-export core constants
export { TIME, REDIS_KEYS };

// Gateway-specific default configuration values
export const GATEWAY_DEFAULTS = {
  /** Default HTTP server port */
  HTTP_PORT: 3000,
  /** Default Slack API URL */
  SLACK_API_URL: "https://slack.com/api",
  /** Default public gateway URL */
  PUBLIC_GATEWAY_URL: "http://localhost:8080",
  /** Default queue names */
  QUEUE_DIRECT_MESSAGE: "direct_message",
  QUEUE_MESSAGE_QUEUE: "message_queue",
  /** Default worker settings */
  WORKER_IMAGE_REPOSITORY: "peerbot-worker",
  WORKER_IMAGE_TAG: "latest",
  WORKER_IMAGE_PULL_POLICY: "Always",
  WORKER_RUNTIME_CLASS_NAME: "kata",
  WORKER_CPU_REQUEST: "100m",
  WORKER_MEMORY_REQUEST: "256Mi",
  WORKER_CPU_LIMIT: "1000m",
  WORKER_MEMORY_LIMIT: "2Gi",
  WORKER_IDLE_CLEANUP_MINUTES: 60,
  MAX_WORKER_DEPLOYMENTS: 100,
  WORKER_STALE_TIMEOUT_MINUTES: 10,
  /** Default Kubernetes namespace */
  KUBERNETES_NAMESPACE: "peerbot",
  /** Default cleanup settings */
  CLEANUP_INITIAL_DELAY_MS: TIME.FIVE_SECONDS_MS,
  CLEANUP_INTERVAL_MS: 60000, // 1 minute
  CLEANUP_VERY_OLD_DAYS: 7,
  /** Default socket health settings */
  SOCKET_HEALTH_CHECK_INTERVAL_MS: 5 * TIME.MINUTE_MS, // 5 minutes
  SOCKET_STALE_THRESHOLD_MS: 15 * TIME.MINUTE_MS, // 15 minutes
  SOCKET_PROTECT_ACTIVE_WORKERS: true,
  /** Default deployment settings */
  PEERBOT_DEV_PROJECT_PATH: "/app",
  COMPOSE_PROJECT_NAME: "peerbot",
  DISPATCHER_SERVICE_NAME: "peerbot-dispatcher",
  /** Default log level */
  LOG_LEVEL: "INFO" as const,
  /** Default kubeconfig path */
  KUBECONFIG: "~/.kube/config",
} as const;

// Merged DEFAULTS with core and gateway-specific values
export const DEFAULTS = {
  ...CORE_DEFAULTS,
  ...GATEWAY_DEFAULTS,
} as const;

// OAuth constants
export const OAUTH = {
  /** OAuth state TTL in seconds (5 minutes) */
  STATE_TTL_SECONDS: 5 * 60,
  /** OAuth grant types */
  GRANT_TYPE_AUTHORIZATION_CODE: "authorization_code",
  GRANT_TYPE_REFRESH_TOKEN: "refresh_token",
  /** OAuth response types */
  RESPONSE_TYPE_CODE: "code",
} as const;

// HTTP status codes
export const HTTP_STATUS = {
  OK: 200,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INTERNAL_SERVER_ERROR: 500,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
} as const;

// Display formatting
export const DISPLAY = {
  /** Horizontal separator length */
  SEPARATOR_LENGTH: 50,
  /** Token preview length for logging */
  TOKEN_PREVIEW_LENGTH: 10,
} as const;
