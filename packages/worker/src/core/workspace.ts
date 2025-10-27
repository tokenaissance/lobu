#!/usr/bin/env bun

import { mkdir } from "node:fs/promises";
import { createLogger, WorkspaceError } from "@peerbot/core";
import type { WorkspaceInfo, WorkspaceSetupConfig } from "./types";

const logger = createLogger("workspace");

// ============================================================================
// WORKSPACE UTILITIES
// ============================================================================

/**
 * Extract thread ID from deployment name
 * Example: peerbot-worker-1756766056.836119 -> 1756766056.836119
 */
function extractThreadIdFromDeploymentName(
  deploymentName: string | undefined
): string | null {
  if (!deploymentName) return null;

  const threadMatch = deploymentName.match(/(\d+\.\d+)/);
  return threadMatch ? (threadMatch[1] ?? null) : null;
}

/**
 * Get workspace directory path for a thread
 */
function getWorkspacePathForThread(
  baseDirectory: string,
  threadId: string
): string {
  // Sanitize thread ID for filesystem
  const sanitizedThreadId = threadId.replace(/[^a-zA-Z0-9.-]/g, "_");
  return `${baseDirectory}/${sanitizedThreadId}`;
}

/**
 * Setup workspace directory environment variable
 * Used by MCP process manager
 */
export function setupWorkspaceEnv(deploymentName: string | undefined): void {
  const threadId = extractThreadIdFromDeploymentName(deploymentName);

  if (threadId) {
    const workspaceDir = getWorkspacePathForThread("/workspace", threadId);
    process.env.WORKSPACE_DIR = workspaceDir;
    logger.info(`📁 Set WORKSPACE_DIR for process manager: ${workspaceDir}`);
  }
}

/**
 * Get thread identifier from various sources
 * Priority: THREAD_ID > sessionKey > username
 */
function getThreadIdentifier(sessionKey?: string, username?: string): string {
  const threadId = process.env.THREAD_ID || sessionKey || username || "default";

  return threadId;
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
      const threadId = getThreadIdentifier(sessionKey, username);

      logger.info(
        `Setting up workspace directory for ${username}, thread: ${threadId}...`
      );

      const userDirectory = getWorkspacePathForThread(
        this.config.baseDirectory,
        threadId
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
        `Workspace directory setup completed for ${username} (thread: ${threadId}) at ${userDirectory}`
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
    try {
      await mkdir(path, { recursive: true });
    } catch (error: any) {
      if (error.code !== "EEXIST") {
        throw error;
      }
    }
  }

  /**
   * Get current working directory
   */
  getCurrentWorkingDirectory(): string {
    return this.workspaceInfo?.userDirectory || this.config.baseDirectory;
  }
}
