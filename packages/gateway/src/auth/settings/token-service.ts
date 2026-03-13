import { resolvePublicUrl } from "../../utils/public-url";

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
 * Unified session payload for settings pages.
 *
 * Used for both OAuth-based sessions and Telegram initData sessions.
 * OAuth sessions populate email/name/oauthUserId; Telegram sessions populate
 * platform/channelId/userId directly.
 */
export interface SettingsTokenPayload {
  /** Agent to configure. Optional when using channel-based entry (user picks agent on page). */
  agentId?: string;
  userId: string;
  platform: string;
  exp: number; // Expiration timestamp (ms)
  /** Channel that triggered the settings link. Used for agent switching and binding. */
  channelId?: string;
  /** Team/workspace ID for multi-tenant platforms (Slack). */
  teamId?: string;
  /** OAuth user email (set for OAuth sessions). */
  email?: string;
  /** OAuth user display name (set for OAuth sessions). */
  name?: string;
  /** OAuth provider user ID (set for OAuth sessions). */
  oauthUserId?: string;
  /** Optional message to display on the settings page (e.g., instructions to get an API key) */
  message?: string;
  /** Optional provider IDs to pre-fill in the settings page (scrolls to provider auth flow) */
  prefillProviders?: string[];
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
  /** Settings mode: "admin" has full access, "user" is restricted by allowedScopes */
  settingsMode?: "admin" | "user";
  /** Scopes the user is allowed to configure (only relevant when settingsMode is "user") */
  allowedScopes?: string[];
  /** Connection ID that triggered this settings session */
  connectionId?: string;
  /** Whether this session has admin access */
  isAdmin?: boolean;
}

/**
 * Build a stable (tokenless) settings URL for Telegram WebApp buttons.
 *
 * Authentication happens via Telegram's `initData` (HMAC-signed by bot token),
 * so the URL never expires and can be reused across button taps.
 */
export function buildTelegramSettingsUrl(chatId: string): string {
  const url = new URL(resolvePublicUrl("/settings"));
  url.searchParams.set("platform", "telegram");
  url.searchParams.set("chat", chatId);
  return url.toString();
}
