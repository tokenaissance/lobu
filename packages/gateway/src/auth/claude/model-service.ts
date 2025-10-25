import { createLogger } from "@peerbot/core";
import type Redis from "ioredis";

const logger = createLogger("claude-model-service");

export interface ClaudeModel {
  id: string;
  display_name: string;
  created_at: string;
  type: string;
}

/**
 * Service to provide available Claude models
 */
export class ClaudeModelService {
  // Hardcoded model list
  private static readonly MODELS: ClaudeModel[] = [
    {
      id: "claude-sonnet-4-5",
      display_name: "Claude Sonnet 4.5",
      created_at: new Date().toISOString(),
      type: "model",
    },
    {
      id: "claude-haiku-4-5",
      display_name: "Claude Haiku 4.5",
      created_at: new Date().toISOString(),
      type: "model",
    },
    {
      id: "claude-opus-4-1",
      display_name: "Claude Opus 4.1",
      created_at: new Date().toISOString(),
      type: "model",
    },
  ];

  constructor(
    private redis: Redis,
    private systemApiKey?: string
  ) {}

  /**
   * Get available models
   */
  async getAvailableModels(): Promise<ClaudeModel[]> {
    logger.debug("Returning hardcoded model list");
    return ClaudeModelService.MODELS;
  }
}
