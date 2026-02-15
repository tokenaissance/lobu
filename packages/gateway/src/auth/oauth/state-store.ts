import { randomBytes } from "node:crypto";
import { createLogger, type Logger } from "@lobu/core";
import type Redis from "ioredis";

/**
 * Generic OAuth state store for CSRF protection
 * Pattern: {keyPrefix}:{state}
 * TTL: 5 minutes
 */
export class OAuthStateStore<T extends { userId: string }> {
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

    this.logger.info(`Created OAuth state for user ${data.userId}`, { state });
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
      this.logger.info(`Consumed OAuth state for user ${stateData.userId}`, {
        state,
      });
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
// Claude OAuth State Types and Factory
// ============================================================================

/**
 * Context for routing auth completion back to the originating platform.
 */
export interface OAuthPlatformContext {
  platform: string;
  channelId: string; // chatJid for WhatsApp, channel for Slack
  threadId?: string;
}

export interface ClaudeOAuthStateData {
  userId: string;
  agentId: string;
  codeVerifier: string;
  context?: OAuthPlatformContext;
}

export type ClaudeOAuthState = ClaudeOAuthStateData & { createdAt: number };

/**
 * Create a Claude OAuth state store for PKCE flow
 */
export function createClaudeOAuthStateStore(
  redis: Redis
): OAuthStateStore<ClaudeOAuthStateData> {
  return new OAuthStateStore(redis, "claude:oauth_state", "claude-oauth-state");
}

// ============================================================================
// MCP OAuth State Types and Factory
// ============================================================================

export interface McpOAuthStateData {
  userId: string;
  agentId: string;
  mcpId: string;
  nonce: string;
  redirectPath?: string;
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

// Type alias for backward compatibility
export type ClaudeOAuthStateStore = OAuthStateStore<ClaudeOAuthStateData>;
