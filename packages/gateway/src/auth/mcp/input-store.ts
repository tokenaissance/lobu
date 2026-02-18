import { BaseRedisStore, decrypt, encrypt } from "@lobu/core";
import type { IMessageQueue } from "../../infrastructure/queue";

export interface InputValues {
  [inputId: string]: string;
}

/**
 * Storage for MCP input credentials (PATs, API keys, etc.)
 * Values are encrypted at rest using AES-256-GCM.
 * Unlike OAuth tokens, these don't expire so we store them without TTL.
 */
export class McpInputStore extends BaseRedisStore<InputValues> {
  private encryptionAvailable = false;

  constructor(queue: IMessageQueue) {
    super({
      redis: queue.getRedisClient(),
      keyPrefix: "mcp:inputs",
      loggerName: "mcp-input-store",
    });

    // Check if encryption key is configured
    try {
      encrypt("test");
      this.encryptionAvailable = true;
    } catch {
      this.logger.warn(
        "ENCRYPTION_KEY not configured - MCP input credentials will be stored unencrypted"
      );
    }
  }

  protected override serialize(value: InputValues): string {
    const json = JSON.stringify(value);
    if (this.encryptionAvailable) {
      return encrypt(json);
    }
    return json;
  }

  protected override deserialize(data: string): InputValues {
    // Try decrypting first (encrypted format is hex:hex:hex)
    if (this.encryptionAvailable && data.includes(":")) {
      try {
        const decrypted = decrypt(data);
        return JSON.parse(decrypted) as InputValues;
      } catch {
        // Fall through to plain JSON parse for backwards compatibility
      }
    }
    return JSON.parse(data) as InputValues;
  }

  /**
   * Store input values for a space and MCP server
   * No TTL - these are persistent until explicitly deleted
   */
  async setInputs(
    agentId: string,
    mcpId: string,
    inputs: InputValues
  ): Promise<void> {
    const key = this.buildKey(agentId, mcpId);
    await this.set(key, inputs);
    this.logger.info(`Stored inputs for space ${agentId}, MCP ${mcpId}`);
  }

  /**
   * Retrieve input values for a space and MCP server
   */
  async getInputs(agentId: string, mcpId: string): Promise<InputValues | null> {
    const key = this.buildKey(agentId, mcpId);
    return this.get(key);
  }

  /**
   * Delete input values for a space and MCP server
   */
  async deleteInputs(agentId: string, mcpId: string): Promise<void> {
    const key = this.buildKey(agentId, mcpId);
    await this.delete(key);
    this.logger.info(`Deleted inputs for space ${agentId}, MCP ${mcpId}`);
  }

  /**
   * Check if space has inputs stored for an MCP server
   */
  async has(agentId: string, mcpId: string): Promise<boolean> {
    const values = await this.getInputs(agentId, mcpId);
    return values !== null;
  }
}
