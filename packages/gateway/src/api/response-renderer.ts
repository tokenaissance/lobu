#!/usr/bin/env bun

/**
 * API Response Renderer
 * Broadcasts worker responses to SSE connections for direct API clients
 */

import { createLogger } from "@lobu/core";
import type { ThreadResponsePayload } from "../infrastructure/queue/types";
import type { ResponseRenderer } from "../platform/response-renderer";
import { broadcastToAgent } from "../routes/public/agent";

const logger = createLogger("api-response-renderer");

/**
 * Response renderer for API platform
 * Broadcasts responses to SSE clients instead of external platforms
 */
export class ApiResponseRenderer implements ResponseRenderer {
  private extractSessionId(payload: ThreadResponsePayload): string | undefined {
    return (
      (payload.platformMetadata?.sessionId as string) ||
      payload.conversationId ||
      undefined
    );
  }

  /**
   * Handle streaming delta content
   * Broadcasts delta to SSE connections
   */
  async handleDelta(
    payload: ThreadResponsePayload,
    _sessionKey: string
  ): Promise<string | null> {
    const sessionId = this.extractSessionId(payload);

    if (!sessionId) {
      logger.warn("No session ID found in payload for delta broadcast");
      return null;
    }

    // Broadcast delta to SSE clients
    broadcastToAgent(sessionId, "output", {
      type: "delta",
      content: payload.delta,
      timestamp: payload.timestamp || Date.now(),
      messageId: payload.messageId,
    });

    logger.debug(
      `Broadcast delta to session ${sessionId}: ${payload.delta?.length || 0} chars`
    );

    return payload.messageId;
  }

  /**
   * Handle completion of response processing
   * Sends completion event to SSE clients
   */
  async handleCompletion(
    payload: ThreadResponsePayload,
    _sessionKey: string
  ): Promise<void> {
    const sessionId = this.extractSessionId(payload);

    if (!sessionId) {
      logger.warn("No session ID found in payload for completion broadcast");
      return;
    }

    // Broadcast completion to SSE clients
    broadcastToAgent(sessionId, "complete", {
      type: "complete",
      messageId: payload.messageId,
      processedMessageIds: payload.processedMessageIds,
      timestamp: payload.timestamp || Date.now(),
    });

    logger.info(`Broadcast completion to session ${sessionId}`);
  }

  /**
   * Handle error response
   * Sends error event to SSE clients
   */
  async handleError(
    payload: ThreadResponsePayload,
    _sessionKey: string
  ): Promise<void> {
    const sessionId = this.extractSessionId(payload);

    if (!sessionId) {
      logger.warn("No session ID found in payload for error broadcast");
      return;
    }

    // Broadcast error to SSE clients
    broadcastToAgent(sessionId, "error", {
      type: "error",
      error: payload.error,
      messageId: payload.messageId,
      timestamp: payload.timestamp || Date.now(),
    });

    logger.error(`Broadcast error to session ${sessionId}: ${payload.error}`);
  }

  /**
   * Handle status updates (heartbeat with elapsed time)
   * Sends status event to SSE clients
   */
  async handleStatusUpdate(payload: ThreadResponsePayload): Promise<void> {
    const sessionId = this.extractSessionId(payload);

    if (!sessionId) {
      return;
    }

    // Broadcast status to SSE clients
    broadcastToAgent(sessionId, "status", {
      type: "status",
      status: payload.statusUpdate,
      messageId: payload.messageId,
      timestamp: payload.timestamp || Date.now(),
    });
  }

  /**
   * Handle ephemeral messages
   * For API platform, these are just broadcast as regular events
   */
  async handleEphemeral(payload: ThreadResponsePayload): Promise<void> {
    const sessionId = this.extractSessionId(payload);

    if (!sessionId) {
      return;
    }

    // Broadcast ephemeral content to SSE clients
    broadcastToAgent(sessionId, "ephemeral", {
      type: "ephemeral",
      content: payload.content,
      messageId: payload.messageId,
      timestamp: payload.timestamp || Date.now(),
    });
  }

  /**
   * Stop stream for conversation - no-op for API platform
   * SSE connections handle their own lifecycle
   */
  async stopStreamForConversation(
    _userId: string,
    _conversationId: string
  ): Promise<void> {
    // No-op - SSE connections manage their own lifecycle
  }
}
