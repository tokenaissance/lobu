#!/usr/bin/env bun

/**
 * Consolidated types for worker package
 * Merged from: base/types.ts, types.ts, interfaces.ts
 */

import type { WorkerTransport } from "@peerbot/core";

// ============================================================================
// WORKER INTERFACES
// ============================================================================

/**
 * Interface for worker executors
 * Allows different implementations (Claude, GPT, etc.)
 */
export interface WorkerExecutor {
  /**
   * Execute the worker job
   */
  execute(): Promise<void>;

  /**
   * Cleanup worker resources
   */
  cleanup(): Promise<void>;

  /**
   * Get the worker transport for sending updates to gateway
   */
  getWorkerTransport(): WorkerTransport | null;
}

// ============================================================================
// WORKER CONFIG & WORKSPACE
// ============================================================================

export interface WorkerConfig {
  sessionKey: string;
  userId: string;
  channelId: string;
  threadId?: string;
  userPrompt: string; // Base64 encoded
  responseChannel: string; // Platform-agnostic response channel
  responseId: string; // Platform-agnostic response message ID
  botResponseId?: string; // Bot's response message ID for updates
  agentOptions: string; // JSON string
  teamId?: string; // Platform team/workspace ID (e.g., Slack team ID)
  platform: string; // Platform identifier (e.g., "slack", "discord")
  platformMetadata?: any; // Platform-specific metadata (e.g., files, user info)
  workspace: {
    baseDirectory: string;
  };
}

export interface WorkspaceSetupConfig {
  baseDirectory: string;
}

export interface WorkspaceInfo {
  baseDirectory: string;
  userDirectory: string;
}

// ============================================================================
// PROGRESS & EXECUTION TYPES
// ============================================================================

/**
 * Progress update from AI agent execution
 */
export type ProgressUpdate =
  | {
      type: "output";
      data: unknown; // Agent-specific message format
      timestamp: number;
    }
  | {
      type: "completion";
      data: {
        exitCode?: number;
        message?: string;
        success?: boolean;
        sessionId?: string;
      };
      timestamp: number;
    }
  | {
      type: "error";
      data: Error | { message?: string; stack?: string; error?: string };
      timestamp: number;
    }
  | {
      type: "status_update";
      data: {
        elapsedSeconds: number;
        state: string;
      };
      timestamp: number;
    };

/**
 * Callback for receiving progress updates during AI execution
 */
export type ProgressCallback = (update: ProgressUpdate) => Promise<void>;

/**
 * Session context for AI execution
 * Contains information about the current session (platform, user, workspace)
 */
export interface SessionContext {
  platform: string; // Platform identifier (e.g., "slack", "discord", "teams")
  channelId: string;
  userId: string;
  userDisplayName?: string;
  teamId?: string;
  threadId?: string;
  messageId: string;
  workingDirectory?: string;
  customInstructions?: string;
}

/**
 * Result from AI execution
 */
export interface ExecutionResult {
  success: boolean;
  exitCode: number;
  output: string;
  error?: string;
}

/**
 * Result from session execution (includes session metadata)
 */
export interface SessionExecutionResult extends ExecutionResult {
  sessionKey: string;
  persisted?: boolean;
  storagePath?: string;
}

/**
 * Agent-specific execution options (model, parameters, etc.)
 */
export interface AgentExecuteOptions {
  model?: string;
  maxTurns?: number;
  permissionMode?: string;
  [key: string]: unknown; // Allow agent-specific extensions
}

/**
 * Options for executing an AI session
 * Agent-specific options should extend AgentExecuteOptions
 */
export interface ExecuteSessionOptions {
  sessionKey: string;
  userPrompt: string;
  context: SessionContext;
  options: AgentExecuteOptions;
  onProgress?: ProgressCallback;
}
