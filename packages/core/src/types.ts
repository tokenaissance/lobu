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
 * Platform-agnostic execution hints passed through gateway → worker.
 * Flexible types (string | string[]) and index signature allow forward
 * compatibility for different agent implementations.
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
  content?: string; // Used only for ephemeral messages (OAuth/auth flows)
  delta?: string;
  isFullReplacement?: boolean;
  processedMessageIds?: string[];
  error?: string;
  timestamp: number;
  originalMessageId?: string;
  moduleData?: Record<string, unknown>;
  botResponseId?: string;
  ephemeral?: boolean; // If true, message should be sent as ephemeral (only visible to user)
  statusUpdate?: {
    elapsedSeconds: number;
    state: string; // e.g., "is running" or "is scheduling"
  };
}

// ============================================================================
// User Interaction Types
// ============================================================================

/**
 * Form field schema for inline inputs
 */
export interface FieldSchema {
  type: "text" | "select" | "textarea" | "number" | "checkbox" | "multiselect";
  label?: string; // Defaults to capitalized field name
  placeholder?: string;
  options?: string[]; // For select/multiselect
  required?: boolean;
  default?: any;
}

/**
 * Interaction options - determines UX pattern (all inline, no modals):
 * - string[] → Simple radio buttons (inline, auto-submit on selection)
 * - Record<string, FieldSchema> → Single inline form with submit button
 * - Record<string, Record<string, FieldSchema>> → Multi-section form (inline section buttons + forms)
 */
export type InteractionOptions =
  | string[]
  | Record<string, FieldSchema>
  | Record<string, Record<string, FieldSchema>>;

/**
 * User response to an interaction
 * Format depends on interaction type:
 * - Simple radio: { answer: string }
 * - Single form: { formData: Record<string, any> }
 * - Multi-section form: { formData: Record<sectionName, Record<fieldName, value>> }
 */
export interface UserInteractionResponse {
  answer?: string; // For simple radio button responses
  formData?: Record<string, any>; // For single form or multi-section form (nested by section)
  timestamp: number;
}

/**
 * Interaction type classification
 */
export type InteractionType =
  | "plan_approval"
  | "tool_approval"
  | "question"
  | "form";

/**
 * Blocking user interaction - agent waits for response
 */
export interface UserInteraction {
  id: string;
  userId: string;
  threadId: string;
  channelId: string;
  teamId?: string;

  blocking: true; // Always true - distinguishes from suggestions

  interactionType: InteractionType; // Type of interaction for recovery/context

  question: string; // The question or prompt to display
  options: InteractionOptions; // Determines UX pattern (radio/single-form/multi-section)

  metadata?: any; // Optional metadata for tracking/context

  status: "pending" | "responded" | "expired";
  response?: UserInteractionResponse;
  createdAt: number;
  expiresAt: number;
  respondedAt?: number;
  respondedByUserId?: string; // Who actually clicked/submitted (may differ from userId)

  // Active section for multi-section forms
  activeSection?: string;
  // Partial data (for multi-section workflows before final submit)
  partialData?: Record<string, Record<string, any>>;
}

/**
 * Pending interaction state for worker startup recovery
 * Note: Only contains unanswered interactions (those still in pending set)
 */
export interface PendingInteraction {
  id: string;
  type: InteractionType;
  question: string;
  createdAt: number;
}

/**
 * Suggested prompt for user
 */
export interface SuggestedPrompt {
  title: string; // Short label shown as chip
  message: string; // Full message sent when clicked
}

/**
 * Non-blocking suggestions - agent continues immediately
 * Used for optional next steps
 */
export interface UserSuggestion {
  id: string;
  userId: string;
  threadId: string;
  channelId: string;
  teamId?: string;

  blocking: false; // Always false - distinguishes from interactions

  prompts: SuggestedPrompt[];
}
