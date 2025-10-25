export interface ClaudeExecutionOptions {
  model?: string;
  timeoutMinutes?: number;
  allowedTools?: string[];
  maxTokens?: number;
  customInstructions?: string;
  workingDirectory?: string;
  sessionId?: string;
  resume?: boolean;
  permissionMode?: string;
}

export interface SessionContext {
  platform: string; // Platform identifier (e.g., "slack", "discord", "teams")
  channelId: string;
  userId: string;
  messageId?: string;
  threadId?: string;
  conversationHistory?: ConversationMessage[];
  customInstructions?: string;
  workingDirectory?: string;
}

export interface ConversationMessage {
  role: "system" | "user" | "assistant";
  content: string;
  timestamp: number;
}

/**
 * Platform-provided execution hints passed through gateway → worker.
 * Extends ClaudeExecutionOptions with additional knobs and index signature
 * for forward compatibility.
 */
export interface AgentOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  allowedTools?: string | string[];
  disallowedTools?: string | string[];
  timeoutMinutes?: number | string;
  [key: string]: string | number | boolean | string[] | undefined;
}

/**
 * Platform-agnostic log level type
 * Maps to common logging levels used across different platforms
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

// ============================================================================
// Instruction Provider Types
// ============================================================================

/**
 * Context information passed to instruction providers
 */
export interface InstructionContext {
  userId: string;
  sessionKey: string;
  workingDirectory: string;
  availableProjects?: string[];
}

/**
 * Interface for components that contribute custom instructions
 */
export interface InstructionProvider {
  /** Unique identifier for this provider */
  name: string;

  /** Priority for ordering (lower = earlier in output) */
  priority: number;

  /**
   * Generate instruction text for this provider
   * @param context - Context information for instruction generation
   * @returns Instruction text or empty string if none
   */
  getInstructions(context: InstructionContext): Promise<string> | string;
}

// ============================================================================
// Thread Response Types
// ============================================================================

/**
 * Shared payload contract for worker → platform thread responses.
 * Ensures gateway consumers and workers stay type-aligned.
 */
export interface ThreadResponsePayload {
  messageId: string;
  channelId: string;
  threadId: string;
  userId: string;
  teamId?: string;
  content?: string;
  delta?: string;
  isStreamDelta?: boolean;
  isFullReplacement?: boolean;
  finalContent?: string;
  usedStreaming?: boolean;
  processedMessageIds?: string[];
  reaction?: string;
  error?: string;
  timestamp: number;
  originalMessageId?: string;
  moduleData?: Record<string, unknown>;
  botResponseId?: string;
  claudeSessionId?: string;
  ephemeral?: boolean; // If true, message should be sent as ephemeral (only visible to user)
  statusUpdate?: {
    status?: string;
    loadingMessages?: string[];
    [key: string]: unknown;
  };
}
