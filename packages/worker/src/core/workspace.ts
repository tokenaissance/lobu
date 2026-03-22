#!/usr/bin/env bun

import { mkdir } from "node:fs/promises";
import {
  createLogger,
  sanitizeConversationId,
  WorkspaceError,
} from "@lobu/core";
import type { WorkspaceInfo, WorkspaceSetupConfig } from "./types";

const logger = createLogger("workspace");

export const DEFAULT_WORKSPACE_DIR = "/workspace";

export function getWorkspaceDir(): string {
  return process.env.WORKSPACE_DIR || DEFAULT_WORKSPACE_DIR;
}

// ============================================================================
// WORKSPACE UTILITIES
// ============================================================================

/**
 * Get workspace directory path for a thread
 */
function getWorkspacePathForThread(
  baseDirectory: string,
  conversationId: string
): string {
  // Sanitize thread ID for filesystem
  const sanitizedConversationId = sanitizeConversationId(conversationId);
  return `${baseDirectory}/${sanitizedConversationId}`;
}

/**
 * Setup workspace directory environment variable
 * Used by MCP process manager
 */
export function setupWorkspaceEnv(deploymentName: string | undefined): void {
  const conversationId = process.env.CONVERSATION_ID;

  if (conversationId) {
    const baseDir = getWorkspaceDir();
    const workspaceDir = getWorkspacePathForThread(baseDir, conversationId);
    process.env.WORKSPACE_DIR = workspaceDir;
    logger.info(`📁 Set WORKSPACE_DIR for process manager: ${workspaceDir}`);
  } else if (deploymentName) {
    // deploymentName is no longer parseable (it may be hashed/collision-resistant).
    logger.warn("WORKSPACE_DIR not set (missing CONVERSATION_ID env var)");
  }
}

/**
 * Get conversation identifier from various sources
 * Priority: CONVERSATION_ID > sessionKey > username
 */
function getThreadIdentifier(sessionKey?: string, username?: string): string {
  return process.env.CONVERSATION_ID || sessionKey || username || "default";
}

// ============================================================================
// WORKSPACE MANAGER
// ============================================================================

/**
 * Simplified WorkspaceManager - only handles directory creation
 * All VCS operations (git, etc.) are handled by modules via hooks
 */
export class WorkspaceManager {
  private config: WorkspaceSetupConfig;
  private workspaceInfo?: WorkspaceInfo;

  constructor(config: WorkspaceSetupConfig) {
    this.config = config;
  }

  /**
   * Setup workspace directory - creates thread-specific directory only
   * VCS operations are handled by module hooks (e.g., GitHub module)
   */
  async setupWorkspace(
    username: string,
    sessionKey?: string
  ): Promise<WorkspaceInfo> {
    try {
      // Use thread-specific directory to avoid conflicts between concurrent threads
      const conversationId = getThreadIdentifier(sessionKey, username);

      logger.info(
        `Setting up workspace directory for ${username}, conversation: ${conversationId}...`
      );

      const userDirectory = getWorkspacePathForThread(
        this.config.baseDirectory,
        conversationId
      );

      // Ensure base directory exists
      await this.ensureDirectory(this.config.baseDirectory);

      // Ensure user directory exists
      await this.ensureDirectory(userDirectory);

      // Create workspace info
      this.workspaceInfo = {
        baseDirectory: this.config.baseDirectory,
        userDirectory,
      };

      logger.info(
        `Workspace directory setup completed for ${username} (conversation: ${conversationId}) at ${userDirectory}`
      );

      return this.workspaceInfo;
    } catch (error) {
      throw new WorkspaceError(
        "setupWorkspace",
        `Failed to setup workspace directory`,
        error as Error
      );
    }
  }

  /**
   * Ensure directory exists
   */
  private async ensureDirectory(path: string): Promise<void> {
    await mkdir(path, { recursive: true });
  }

  /**
   * Get current working directory
   */
  getCurrentWorkingDirectory(): string {
    return this.workspaceInfo?.userDirectory || this.config.baseDirectory;
  }
}
