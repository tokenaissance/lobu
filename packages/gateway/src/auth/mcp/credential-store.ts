import type Redis from "ioredis";
import { BaseCredentialStore } from "../credential-store";

export interface McpCredentialRecord {
  accessToken: string;
  tokenType?: string;
  expiresAt?: number;
  refreshToken?: string;
  metadata?: Record<string, unknown>;
}

/**
 * MCP credential store with multi-part keys (userId, mcpId)
 * Uses composition rather than inheritance due to different API signature
 */
export class McpCredentialStore {
  private store: BaseCredentialStore<McpCredentialRecord>;

  constructor(redis: Redis) {
    this.store = new BaseCredentialStore(
      redis,
      "mcp:credential",
      "mcp-credentials"
    );
  }

  private buildKey(userId: string, mcpId: string): string {
    return `${userId}:${mcpId}`;
  }

  async getCredentials(
    userId: string,
    mcpId: string
  ): Promise<McpCredentialRecord | null> {
    const key = this.buildKey(userId, mcpId);
    return this.store.getCredentials(key);
  }

  async setCredentials(
    userId: string,
    mcpId: string,
    record: McpCredentialRecord,
    ttlSeconds?: number
  ): Promise<void> {
    const key = this.buildKey(userId, mcpId);
    await this.store.setCredentials(key, record, ttlSeconds);
  }

  async deleteCredentials(userId: string, mcpId: string): Promise<void> {
    const key = this.buildKey(userId, mcpId);
    await this.store.deleteCredentials(key);
  }
}
