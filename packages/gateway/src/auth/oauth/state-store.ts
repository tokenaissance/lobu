import { randomBytes } from "node:crypto";
import { createLogger, type Logger } from "@lobu/core";
import type Redis from "ioredis";

/**
 * Generic OAuth state store for CSRF protection
 * Pattern: {keyPrefix}:{state}
 * TTL: 5 minutes
 */
export class OAuthStateStore<T extends object> {
  private static readonly TTL_SECONDS = 5 * 60; // 5 minutes
  protected logger: Logger;

  constructor(
    private redis: Redis,
    private keyPrefix: string,
    loggerName: string
  ) {
    this.logger = createLogger(loggerName);
  }

  /**
   * Create a new OAuth state with data
   * Returns the state string to use in OAuth flow
   */
  async create(data: T): Promise<string> {
    const state = this.generateState();
    const key = this.getKey(state);

    const stateData = {
      ...data,
      createdAt: Date.now(),
    };

    await this.redis.setex(
      key,
      OAuthStateStore.TTL_SECONDS,
      JSON.stringify(stateData)
    );

    const userId =
      typeof (data as { userId?: unknown }).userId === "string"
        ? (data as { userId: string }).userId
        : undefined;
    this.logger.info(
      userId ? `Created OAuth state for user ${userId}` : "Created OAuth state",
      { state }
    );
    return state;
  }

  /**
   * Validate and consume an OAuth state
   * Returns the state data if valid, null if invalid or expired
   * Deletes the state after retrieval (one-time use)
   */
  async consume(state: string): Promise<(T & { createdAt: number }) | null> {
    const key = this.getKey(state);

    // Get and delete in one operation
    const data = await this.redis.getdel(key);

    if (!data) {
      this.logger.warn(`Invalid or expired OAuth state: ${state}`);
      return null;
    }

    try {
      const stateData = JSON.parse(data) as T & { createdAt: number };
      const stateDataWithUser = stateData as unknown as { userId?: unknown };
      const userId =
        typeof stateDataWithUser.userId === "string"
          ? stateDataWithUser.userId
          : undefined;
      this.logger.info(
        userId
          ? `Consumed OAuth state for user ${userId}`
          : "Consumed OAuth state",
        { state }
      );
      return stateData;
    } catch (error) {
      this.logger.error(`Failed to parse OAuth state: ${state}`, { error });
      return null;
    }
  }

  /**
   * Generate a cryptographically secure random state string
   */
  private generateState(): string {
    return randomBytes(32).toString("base64url");
  }

  private getKey(state: string): string {
    return `${this.keyPrefix}:${state}`;
  }
}

// ============================================================================
// Provider OAuth State Types and Factory
// ============================================================================

/**
 * Context for routing auth completion back to the originating platform.
 */
export interface OAuthPlatformContext {
  platform: string;
  channelId: string; // chatJid for WhatsApp, channel for Slack
  conversationId?: string;
}

export interface ProviderOAuthStateData {
  userId: string;
  agentId: string;
  codeVerifier: string;
  context?: OAuthPlatformContext;
}

export type ProviderOAuthState = ProviderOAuthStateData & {
  createdAt: number;
};

/**
 * Create a provider OAuth state store for PKCE flow
 */
export function createOAuthStateStore(
  providerId: string,
  redis: Redis
): OAuthStateStore<ProviderOAuthStateData> {
  return new OAuthStateStore(
    redis,
    `${providerId}:oauth_state`,
    `${providerId}-oauth-state`
  );
}

export interface SlackInstallStateData {
  redirectUri: string;
}

export type SlackInstallState = SlackInstallStateData & { createdAt: number };

export function createSlackInstallStateStore(
  redis: Redis
): OAuthStateStore<SlackInstallStateData> {
  return new OAuthStateStore(redis, "slack:oauth:state", "slack-install-state");
}

// ============================================================================
// MCP OAuth State Types and Factory
// ============================================================================

export interface McpOAuthThreadContext {
  conversationId: string;
  channelId: string;
  teamId?: string;
  platform?: string;
  connectionId?: string;
}

export interface McpOAuthStateData {
  userId: string;
  agentId: string;
  mcpId: string;
  nonce: string;
  redirectPath?: string;
  codeVerifier?: string;
  resource?: string;
  threadContext?: McpOAuthThreadContext;
}

export type McpOAuthState = McpOAuthStateData & { createdAt: number };

/**
 * MCP OAuth state store with auto-generated nonce
 */
export class McpOAuthStateStore extends OAuthStateStore<McpOAuthStateData> {
  constructor(redis: Redis) {
    super(redis, "mcp:oauth:state", "mcp-oauth-state");
  }

  /**
   * Create state with auto-generated nonce
   */
  async createWithNonce(
    data: Omit<McpOAuthStateData, "nonce">
  ): Promise<string> {
    const stateData: McpOAuthStateData = {
      ...data,
      nonce: randomBytes(16).toString("hex"),
    };
    return this.create(stateData);
  }
}

/**
 * Create an MCP OAuth state store
 */
export function createMcpOAuthStateStore(redis: Redis): McpOAuthStateStore {
  return new McpOAuthStateStore(redis);
}

export type ProviderOAuthStateStore = OAuthStateStore<ProviderOAuthStateData>;
