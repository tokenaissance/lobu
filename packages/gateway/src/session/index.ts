import type { SessionContext } from "@peerbot/core";

/**
 * Platform-agnostic session types and utilities
 * These types are used by all chat platforms for session tracking
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Thread session data structure
 * Tracks the state of a conversation thread across any platform
 */
export interface ThreadSession {
  sessionKey: string;
  threadId?: string;
  channelId: string;
  userId: string;
  threadCreator?: string; // Track the original thread creator
  jobName?: string;
  lastActivity: number;
  createdAt: number;
  botResponseId?: string; // Bot's response message ID for updates
  turnCount?: number; // Track conversation turns to prevent infinite loops
}

/**
 * Session store interface
 * Platform adapters use this to store and retrieve session data
 */
export interface SessionStore {
  get(sessionKey: string): Promise<ThreadSession | null>;
  set(sessionKey: string, session: ThreadSession): Promise<void>;
  delete(sessionKey: string): Promise<void>;
  getByThread(
    channelId: string,
    threadTs: string
  ): Promise<ThreadSession | null>;
  /** Optional cleanup - not needed for Redis TTL-based stores */
  cleanup?(ttl: number): Promise<number>;
}

/**
 * Session manager interface
 * Provides high-level session management operations
 */
export interface ISessionManager {
  createSession(
    channelId: string,
    userId: string,
    threadId?: string,
    threadCreator?: string
  ): Promise<ThreadSession>;
  getSession(sessionKey: string): Promise<ThreadSession | null>;
  findSessionByThread(
    channelId: string,
    threadTs: string
  ): Promise<ThreadSession | null>;
  updateSession(
    sessionKey: string,
    updates: Partial<ThreadSession>
  ): Promise<void>;
  setSession(session: ThreadSession): Promise<void>;
  deleteSession(sessionKey: string): Promise<void>;
  validateThreadOwnership(
    channelId: string,
    threadTs: string,
    userId: string
  ): Promise<{ allowed: boolean; owner?: string }>;
  cleanupExpired(ttl: number): Promise<number>;
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Generate session key from context
 */
export function generateSessionKey(context: SessionContext): string {
  // Use thread ID as the session key (if in a thread)
  // Otherwise use message ID
  const id = context.threadId || context.messageId || "";

  // If we have a thread ID, use it directly as the session key
  // This ensures consistency across all worker executions in the same thread
  if (context.threadId) {
    return context.threadId;
  }

  // For direct messages (no thread), use the channel and message ID
  return `${context.channelId}-${id}`;
}
