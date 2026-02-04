#!/usr/bin/env bun

import {
  createLogger,
  type InteractionOptions,
  type InteractionType,
  retryWithBackoff,
  TIME,
  type UserInteractionResponse,
} from "@termosdev/core";

const logger = createLogger("interaction-client");

/**
 * Pending interaction state
 */
interface PendingInteraction {
  resolve: (response: UserInteractionResponse) => void;
  timeoutId: NodeJS.Timeout;
}

/**
 * Platform and agent-agnostic interaction client
 * Uses HTTP + SSE to communicate with gateway
 */
export class InteractionClient {
  private pendingInteractions = new Map<string, PendingInteraction>();

  constructor(
    private gatewayUrl: string,
    private workerToken: string
  ) {}

  /**
   * Ask user a question and block until they respond
   * Returns the user's response
   */
  async askUser(args: {
    interactionType: InteractionType;
    question: string;
    options: InteractionOptions;
    metadata?: any;
  }): Promise<UserInteractionResponse> {
    logger.info(
      `Asking user (${args.interactionType}): ${args.question.substring(0, 50)}...`
    );

    // Debug: log token format
    logger.debug(
      `Worker token format check: ${this.workerToken.split(":").length} parts`
    );

    // Create interaction with retry logic
    const data = await retryWithBackoff(async () => {
      const response = await fetch(
        `${this.gatewayUrl}/internal/interactions/create`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.workerToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            interactionType: args.interactionType,
            question: args.question,
            options: args.options,
            metadata: args.metadata,
            blocking: true,
          }),
        }
      );

      if (!response.ok) {
        throw new Error(
          `Failed to create interaction: ${response.status} ${response.statusText}`
        );
      }

      return (await response.json()) as { id: string };
    });

    const interactionId = data.id;

    logger.info(
      `[INTERACTION-CLIENT] ✅ Interaction created: ${interactionId}, waiting for response...`
    );

    // Wait for response (will be delivered via SSE)
    const startTime = Date.now();
    return new Promise((resolve) => {
      const wrappedResolve = (response: UserInteractionResponse) => {
        const duration = Date.now() - startTime;
        logger.info(
          `[INTERACTION-CLIENT] 🎉 Promise resolving for interaction ${interactionId} after ${duration}ms`
        );
        logger.info(
          `[INTERACTION-CLIENT] Response: ${response?.answer || JSON.stringify(response?.formData)}`
        );
        resolve(response);
      };
      // Timeout after configured duration - cleanup properly
      logger.info(
        `[INTERACTION-CLIENT] ⏱️  Setting timeout for ${interactionId} with duration ${TIME.THREE_HOURS_MS}ms`
      );
      const timeoutStartTime = Date.now();
      const timeoutId = setTimeout(() => {
        const actualDuration = Date.now() - timeoutStartTime;
        logger.warn(
          `[INTERACTION-CLIENT] ⏰ Timeout fired for ${interactionId} after ${actualDuration}ms (expected ${TIME.THREE_HOURS_MS}ms)`
        );
        const pending = this.pendingInteractions.get(interactionId);
        if (pending) {
          logger.warn(
            `[INTERACTION-CLIENT] ⏰ Interaction ${interactionId} timed out after ${TIME.THREE_HOURS_MS}ms`
          );
          this.pendingInteractions.delete(interactionId);
          pending.resolve({
            timestamp: Date.now(),
          });
        } else {
          logger.warn(
            `[INTERACTION-CLIENT] ⚠️  Timeout fired but no pending interaction found for ${interactionId}`
          );
        }
      }, TIME.THREE_HOURS_MS);

      // Store resolver and timeout ID together
      this.pendingInteractions.set(interactionId, {
        resolve: wrappedResolve,
        timeoutId,
      });
      logger.info(
        `[INTERACTION-CLIENT] 📝 Stored interaction ${interactionId} in pendingInteractions map (size: ${this.pendingInteractions.size})`
      );
    });
  }

  /**
   * Show suggestions to user (non-blocking)
   * Returns immediately without waiting
   */
  async suggestToUser(
    prompts: Array<{ title: string; message: string }>
  ): Promise<void> {
    logger.info(`Sending ${prompts.length} suggestions to user`);

    await retryWithBackoff(async () => {
      const response = await fetch(
        `${this.gatewayUrl}/internal/suggestions/create`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.workerToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ prompts, blocking: false }),
        }
      );

      if (!response.ok) {
        throw new Error(
          `Failed to send suggestions: ${response.status} ${response.statusText}`
        );
      }

      return response;
    });

    logger.info("Suggestions sent");
  }

  /**
   * Handle interaction response received via SSE
   * Called by SSE client when gateway sends response
   */
  handleInteractionResponse(
    interactionId: string,
    response: UserInteractionResponse
  ): void {
    logger.info(
      `[INTERACTION-CLIENT] 📨 handleInteractionResponse called for ${interactionId}`
    );
    logger.info(`[INTERACTION-CLIENT] Response: ${JSON.stringify(response)}`);
    logger.info(
      `[INTERACTION-CLIENT] 📊 pendingInteractions map size: ${this.pendingInteractions.size}`
    );

    const pendingKeys = Array.from(this.pendingInteractions.keys());
    logger.info(
      `[INTERACTION-CLIENT] 🔑 Pending interaction IDs: [${pendingKeys.join(", ")}]`
    );
    logger.info(`[INTERACTION-CLIENT] 🔍 Looking for ID: ${interactionId}`);
    logger.info(
      `[INTERACTION-CLIENT] 🎯 Match found: ${this.pendingInteractions.has(interactionId)}`
    );

    const pending = this.pendingInteractions.get(interactionId);

    if (pending) {
      logger.info(
        `[INTERACTION-CLIENT] ✅ Found pending interaction ${interactionId}: ${response.answer || JSON.stringify(response.formData)}`
      );
      logger.info(
        `[INTERACTION-CLIENT] 🧹 Clearing timeout for ${interactionId}`
      );

      // Clear the timeout to prevent memory leak
      clearTimeout(pending.timeoutId);

      logger.info(
        `[INTERACTION-CLIENT] 🎉 Resolving promise for ${interactionId}`
      );
      // Resolve the promise
      pending.resolve(response);

      // Clean up from map
      this.pendingInteractions.delete(interactionId);
      logger.info(
        `[INTERACTION-CLIENT] ✅ Successfully handled interaction ${interactionId}, remaining: ${this.pendingInteractions.size}`
      );
    } else {
      logger.warn(
        `[INTERACTION-CLIENT] ⚠️ Received response for unknown interaction: ${interactionId} (likely restarted while waiting)`
      );
    }
  }

  /**
   * Get list of pending interaction IDs (for debugging)
   */
  getPendingInteractionIds(): string[] {
    return Array.from(this.pendingInteractions.keys());
  }

  /**
   * Clean up all pending interactions
   * Called when worker is shutting down
   */
  cleanup(): void {
    logger.info(
      `Cleaning up ${this.pendingInteractions.size} pending interactions`
    );

    for (const [, pending] of this.pendingInteractions.entries()) {
      // Clear the timeout
      clearTimeout(pending.timeoutId);

      // Resolve with timeout response
      pending.resolve({
        timestamp: Date.now(),
      });
    }

    // Clear the map
    this.pendingInteractions.clear();
  }
}
