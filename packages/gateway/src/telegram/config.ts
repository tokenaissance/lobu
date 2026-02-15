/**
 * Telegram platform configuration.
 */

import { getOptionalBoolean, getOptionalNumber } from "@lobu/core";

export interface TelegramConfig {
  /** Enable Telegram platform */
  enabled: boolean;

  /** Telegram Bot API token from @BotFather */
  botToken: string;

  /**
   * Allowed Telegram user IDs that can interact with the bot.
   * Empty array means allow all.
   * Format: numeric user IDs as strings (e.g., "123456789")
   */
  allowFrom: string[];

  /** Allow messages from group chats */
  allowGroups: boolean;

  /** Max characters per message (Telegram limit is 4096) */
  messageChunkSize: number;

  /** Max messages to keep in conversation history per chat */
  maxHistoryMessages: number;

  /** Conversation history TTL in seconds (default: 24 hours) */
  historyTtlSeconds: number;
}

export const DEFAULT_TELEGRAM_CONFIG: TelegramConfig = {
  enabled: false,
  botToken: "",
  allowFrom: [],
  allowGroups: true,
  messageChunkSize: 4096,
  maxHistoryMessages: 10,
  historyTtlSeconds: 86400, // 24 hours
};

/**
 * Build Telegram config from environment variables.
 */
export function buildTelegramConfig(): TelegramConfig | null {
  if (!getOptionalBoolean("TELEGRAM_ENABLED", false)) {
    return null;
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    return null;
  }

  const allowFromEnv = process.env.TELEGRAM_ALLOW_FROM;
  const allowFrom = allowFromEnv
    ? allowFromEnv
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  const defaults = DEFAULT_TELEGRAM_CONFIG;

  return {
    enabled: true,
    botToken,
    allowFrom,
    allowGroups: getOptionalBoolean(
      "TELEGRAM_ALLOW_GROUPS",
      defaults.allowGroups
    ),
    messageChunkSize: getOptionalNumber(
      "TELEGRAM_MESSAGE_CHUNK_SIZE",
      defaults.messageChunkSize
    ),
    maxHistoryMessages: getOptionalNumber(
      "TELEGRAM_MAX_HISTORY_MESSAGES",
      defaults.maxHistoryMessages
    ),
    historyTtlSeconds: getOptionalNumber(
      "TELEGRAM_HISTORY_TTL_SECONDS",
      defaults.historyTtlSeconds
    ),
  };
}

/**
 * Display Telegram configuration.
 */
export function displayTelegramConfig(config: TelegramConfig | null): void {
  if (config) {
    console.log("\nTelegram:");
    console.log(`  Enabled: ${config.enabled}`);
    console.log(`  Bot Token: ${config.botToken ? "configured" : "not set"}`);
    console.log(`  Allow Groups: ${config.allowGroups}`);
    console.log(
      `  Allow From: ${config.allowFrom.length > 0 ? config.allowFrom.join(", ") : "all"}`
    );
  } else {
    console.log("\nTelegram: disabled");
  }
}
