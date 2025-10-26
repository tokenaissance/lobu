#!/usr/bin/env bun

/**
 * Consolidated types for worker package
 * Merged from: base/types.ts, types.ts, interfaces.ts
 */

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
   * Get the gateway integration for sending updates
   */
  getGatewayIntegration(): GatewayIntegrationInterface | null;
}

/**
 * Interface for gateway integration
 * Provides methods for communicating with the dispatcher
 */
export interface GatewayIntegrationInterface {
  setJobId(jobId: string): void;
  setModuleData(moduleData: Record<string, unknown>): void;
  updateStatus(status: string, loadingMessages?: string[]): Promise<void>;
  sendContent(content: string): Promise<void>;
  sendStreamDelta(
    delta: string,
    isFullReplacement?: boolean,
    isFinal?: boolean
  ): Promise<void>;
  signalDone(finalDelta?: string, fullContent?: string): Promise<void>;
  signalCompletion(): Promise<void>;
  signalError(error: Error): Promise<void>;
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
  resumeSessionId?: string; // Claude session ID to resume ("continue" or specific ID)
  teamId?: string; // Platform team/workspace ID (e.g., Slack team ID)
  platform?: string; // Platform identifier (e.g., "slack", "discord")
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
      type: "status";
      data: { status: string; details?: string };
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
  claudeSessionId?: string;
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
