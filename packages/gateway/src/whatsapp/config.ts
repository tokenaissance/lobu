/**
 * WhatsApp platform configuration.
 */

import { getOptionalBoolean, getOptionalNumber } from "@lobu/core";

export interface WhatsAppConfig {
  /** Enable WhatsApp platform */
  enabled: boolean;

  /**
   * Base64-encoded credentials JSON from QR link flow.
   * This is the primary way to provide credentials.
   */
  credentials?: string;

  /**
   * Allowed phone numbers that can interact with the bot.
   * Empty array means allow all.
   * Format: E.164 (e.g., "+1234567890")
   */
  allowFrom: string[];

  /** Allow messages from group chats */
  allowGroups: boolean;

  /** Require @mention in group chats to respond */
  requireMention: boolean;

  /** Allow self-chat mode for testing (respond to own messages) */
  selfChatEnabled: boolean;

  /** Max reconnection attempts before giving up */
  reconnectMaxAttempts: number;

  /** Base delay for reconnection in ms */
  reconnectBaseDelay: number;

  /** Max delay for reconnection in ms */
  reconnectMaxDelay: number;

  /** Exponential backoff factor */
  reconnectFactor: number;

  /** Jitter factor (0-1) for reconnection delay */
  reconnectJitter: number;

  /** Max characters per message (WhatsApp limit is ~65536, but 4096 is practical) */
  messageChunkSize: number;

  /** Typing indicator duration in ms */
  typingTimeout: number;

  /** Max messages to keep in conversation history per chat */
  maxHistoryMessages: number;

  /** Conversation history TTL in seconds (default: 24 hours) */
  historyTtlSeconds: number;
}

export const DEFAULT_WHATSAPP_CONFIG: WhatsAppConfig = {
  enabled: false,
  credentials: undefined,
  allowFrom: [],
  allowGroups: true,
  requireMention: true,
  selfChatEnabled: false,
  reconnectMaxAttempts: 5,
  reconnectBaseDelay: 2000,
  reconnectMaxDelay: 60000,
  reconnectFactor: 1.8,
  reconnectJitter: 0.25,
  messageChunkSize: 4096,
  typingTimeout: 5000,
  maxHistoryMessages: 10,
  historyTtlSeconds: 86400, // 24 hours
};

/**
 * Build WhatsApp config from environment variables.
 */
export function buildWhatsAppConfig(): WhatsAppConfig | null {
  if (!getOptionalBoolean("WHATSAPP_ENABLED", false)) {
    return null;
  }

  const allowFromEnv = process.env.WHATSAPP_ALLOW_FROM;
  const allowFrom = allowFromEnv
    ? allowFromEnv
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  const defaults = DEFAULT_WHATSAPP_CONFIG;

  return {
    enabled: true,
    credentials: process.env.WHATSAPP_CREDENTIALS,
    allowFrom,
    allowGroups: getOptionalBoolean(
      "WHATSAPP_ALLOW_GROUPS",
      defaults.allowGroups
    ),
    requireMention: getOptionalBoolean(
      "WHATSAPP_REQUIRE_MENTION",
      defaults.requireMention
    ),
    selfChatEnabled: getOptionalBoolean(
      "WHATSAPP_SELF_CHAT",
      defaults.selfChatEnabled
    ),
    reconnectMaxAttempts: getOptionalNumber(
      "WHATSAPP_RECONNECT_MAX_ATTEMPTS",
      defaults.reconnectMaxAttempts
    ),
    reconnectBaseDelay: getOptionalNumber(
      "WHATSAPP_RECONNECT_BASE_DELAY",
      defaults.reconnectBaseDelay
    ),
    reconnectMaxDelay: getOptionalNumber(
      "WHATSAPP_RECONNECT_MAX_DELAY",
      defaults.reconnectMaxDelay
    ),
    reconnectFactor: parseFloat(
      process.env.WHATSAPP_RECONNECT_FACTOR ?? String(defaults.reconnectFactor)
    ),
    reconnectJitter: parseFloat(
      process.env.WHATSAPP_RECONNECT_JITTER ?? String(defaults.reconnectJitter)
    ),
    messageChunkSize: getOptionalNumber(
      "WHATSAPP_MESSAGE_CHUNK_SIZE",
      defaults.messageChunkSize
    ),
    typingTimeout: getOptionalNumber(
      "WHATSAPP_TYPING_TIMEOUT",
      defaults.typingTimeout
    ),
    maxHistoryMessages: getOptionalNumber(
      "WHATSAPP_MAX_HISTORY_MESSAGES",
      defaults.maxHistoryMessages
    ),
    historyTtlSeconds: getOptionalNumber(
      "WHATSAPP_HISTORY_TTL_SECONDS",
      defaults.historyTtlSeconds
    ),
  };
}

/**
 * Display WhatsApp configuration
 */
export function displayWhatsAppConfig(config: WhatsAppConfig | null): void {
  if (config) {
    console.log("\nWhatsApp:");
    console.log(`  Enabled: ${config.enabled}`);
    console.log(
      `  Credentials: ${config.credentials ? "configured" : "not set (QR auth required)"}`
    );
    console.log(`  Allow Groups: ${config.allowGroups}`);
    console.log(`  Require Mention: ${config.requireMention}`);
    console.log(
      `  Allow From: ${config.allowFrom.length > 0 ? config.allowFrom.join(", ") : "all"}`
    );
  } else {
    console.log("\nWhatsApp: disabled");
  }
}
