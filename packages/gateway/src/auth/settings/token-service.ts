import { createLogger } from "@lobu/core";

const logger = createLogger("settings-token-service");

/**
 * Pre-filled skill configuration for settings page
 */
export interface PrefillSkill {
	/** Skill repository (e.g., "anthropics/skills/pdf") */
	repo: string;
	/** Display name */
	name?: string;
	/** Description */
	description?: string;
}

/**
 * Pre-filled MCP server configuration for settings page
 */
export interface PrefillMcpServer {
	/** MCP server ID (key in mcpServers record) */
	id: string;
	/** Display name/description */
	name?: string;
	/** Server URL (for SSE type) */
	url?: string;
	/** Server type */
	type?: "sse" | "stdio";
	/** Command (for stdio type) */
	command?: string;
	/** Args (for stdio type) */
	args?: string[];
	/** Environment variables needed (just the keys, user fills values) */
	envVars?: string[];
}

/**
 * Source message context where settings link was requested.
 * Used to send follow-up notifications back to the same conversation.
 */
export interface SettingsSourceContext {
	conversationId: string;
	channelId: string;
	teamId?: string;
	platform?: string;
}

/**
 * Canonical session payload type. Stored server-side in Redis.
 *
 * Supports two entry modes:
 * - Agent-based: `agentId` is set (from /configure, Slack Home tab, worker endpoint)
 * - Channel-based: `channelId` is set, `agentId` may be absent (from message handlers when no agent bound)
 * At least one of `agentId` or `channelId` must be present.
 */
export interface SettingsSessionPayload {
	/** Agent to configure. Optional when using channel-based entry (user picks agent on page). */
	agentId?: string;
	userId: string;
	platform: string;
	exp: number; // Expiration timestamp (ms)
	/** Channel that triggered the settings link. Used for agent switching and binding. */
	channelId?: string;
	/** Team/workspace ID for multi-tenant platforms (Slack). */
	teamId?: string;
	/** Optional message to display on the settings page (e.g., instructions to get an API key) */
	message?: string;
	/** Optional env vars to pre-fill in the settings page (just the keys, user fills values) */
	prefillEnvVars?: string[];
	/** Optional skills to pre-fill (user confirms to enable) */
	prefillSkills?: PrefillSkill[];
	/** Optional MCP servers to pre-fill (user confirms to enable) */
	prefillMcpServers?: PrefillMcpServer[];
	/** Optional Nix packages to pre-fill in the system packages section */
	prefillNixPackages?: string[];
	/** Optional domain patterns to pre-fill as grants */
	prefillGrants?: string[];
	/** Optional source context for post-install notifications */
	sourceContext?: SettingsSourceContext;
}

/**
 * Default TTL for settings tokens (1 hour)
 */
const DEFAULT_TOKEN_TTL_MS = 60 * 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const SECOND_MS = 1000;

function formatUnit(value: number, unit: string): string {
	return `${value} ${unit}${value === 1 ? "" : "s"}`;
}

/**
 * Resolve settings token TTL from environment.
 *
 * `SETTINGS_TOKEN_TTL_MS` is optional. If not set (or invalid), falls back to 1 hour.
 */
export function getSettingsTokenTtlMs(): number {
	const raw = process.env.SETTINGS_TOKEN_TTL_MS;
	if (!raw || raw.trim().length === 0) {
		return DEFAULT_TOKEN_TTL_MS;
	}

	const parsed = Number.parseInt(raw, 10);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		logger.warn(
			{ rawValue: raw },
			"Invalid SETTINGS_TOKEN_TTL_MS; using default 1 hour",
		);
		return DEFAULT_TOKEN_TTL_MS;
	}

	return parsed;
}

/**
 * Human-readable settings token TTL for user-facing messages.
 */
export function formatSettingsTokenTtl(
	ttlMs = getSettingsTokenTtlMs(),
): string {
	if (ttlMs >= WEEK_MS && ttlMs % WEEK_MS === 0) {
		return formatUnit(ttlMs / WEEK_MS, "week");
	}
	if (ttlMs >= DAY_MS && ttlMs % DAY_MS === 0) {
		return formatUnit(ttlMs / DAY_MS, "day");
	}
	if (ttlMs >= HOUR_MS && ttlMs % HOUR_MS === 0) {
		return formatUnit(ttlMs / HOUR_MS, "hour");
	}
	if (ttlMs >= MINUTE_MS && ttlMs % MINUTE_MS === 0) {
		return formatUnit(ttlMs / MINUTE_MS, "minute");
	}
	const seconds = Math.max(1, Math.round(ttlMs / SECOND_MS));
	return formatUnit(seconds, "second");
}

/**
 * Build a stable (tokenless) settings URL for Telegram WebApp buttons.
 *
 * Authentication happens via Telegram's `initData` (HMAC-signed by bot token),
 * so the URL never expires and can be reused across button taps.
 */
export function buildTelegramSettingsUrl(chatId: string): string {
	const baseUrl = process.env.PUBLIC_GATEWAY_URL || "http://localhost:8080";
	return `${baseUrl}/settings?platform=telegram&chat=${encodeURIComponent(chatId)}`;
}
