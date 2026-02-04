#!/usr/bin/env bun

import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import {
  createLogger,
  type InteractionOptions,
  type InteractionType,
  type PendingInteraction,
  TIME,
  type UserInteraction,
  type UserSuggestion,
} from "@termosdev/core";
import type { Redis } from "ioredis";

const logger = createLogger("interactions");

/**
 * Platform-agnostic interaction service
 * Manages interaction state and emits events for platforms to handle
 */
export class InteractionService extends EventEmitter {
  private beforeCreateHook?: (
    userId: string,
    threadId: string
  ) => Promise<void>;

  constructor(private redis: Redis) {
    super();
  }

  /**
   * Set a hook to run before creating interactions
   * Used by platforms to stop streams before interaction messages appear
   */
  setBeforeCreateHook(
    hook: (userId: string, threadId: string) => Promise<void>
  ): void {
    this.beforeCreateHook = hook;
  }

  /**
   * Create a blocking interaction
   * Stores in Redis and emits event for platform rendering
   */
  async createInteraction(
    userId: string,
    threadId: string,
    channelId: string,
    teamId: string | undefined,
    data: {
      interactionType: InteractionType;
      question: string;
      options: InteractionOptions;
      metadata?: any;
    }
  ): Promise<UserInteraction> {
    // Call beforeCreate hook (e.g., stop streams) BEFORE creating interaction
    if (this.beforeCreateHook) {
      logger.info(`Running beforeCreate hook for thread ${threadId}`);
      await this.beforeCreateHook(userId, threadId);
    }

    const interaction: UserInteraction = {
      id: `ui_${randomUUID()}`,
      userId,
      threadId,
      channelId,
      teamId,
      blocking: true,
      interactionType: data.interactionType,
      status: "pending",
      createdAt: Date.now(),
      expiresAt: Date.now() + TIME.THREE_HOURS_MS,
      question: data.question,
      options: data.options,
      metadata: data.metadata,
    };

    // Store in Redis
    const key = `interaction:${interaction.id}`;
    await this.redis.set(
      key,
      JSON.stringify(interaction),
      "EX",
      TIME.THREE_HOURS_SECONDS
    );

    // Track pending interactions for this session
    const pendingKey = `interaction:pending:${threadId}`;
    await this.redis.sadd(pendingKey, interaction.id);
    await this.redis.expire(pendingKey, TIME.THREE_HOURS_SECONDS);

    // Mark thread as having an active interaction (blocks heartbeat deltas)
    const activeKey = `interaction:active:${threadId}`;
    await this.redis.set(
      activeKey,
      interaction.id,
      "EX",
      TIME.THREE_HOURS_SECONDS
    );

    logger.info(`Created interaction ${interaction.id} for thread ${threadId}`);

    // Emit event for platform to render (stream already stopped)
    this.emit("interaction:created", interaction);

    return interaction;
  }

  /**
   * Store the message timestamp for an interaction
   * Used to update the message later when user responds
   */
  async setMessageTs(interactionId: string, messageTs: string): Promise<void> {
    const key = `interaction:${interactionId}:messageTs`;
    await this.redis.set(key, messageTs, "EX", TIME.THREE_HOURS_SECONDS);
  }

  /**
   * Get the message timestamp for an interaction
   */
  async getMessageTs(interactionId: string): Promise<string | null> {
    const key = `interaction:${interactionId}:messageTs`;
    return await this.redis.get(key);
  }

  /**
   * Create non-blocking suggestions
   * Emits event immediately, no state tracking needed
   */
  async createSuggestion(
    userId: string,
    threadId: string,
    channelId: string,
    teamId: string | undefined,
    prompts: Array<{ title: string; message: string }>
  ): Promise<void> {
    const suggestion: UserSuggestion = {
      id: `sug_${randomUUID()}`,
      userId,
      threadId,
      channelId,
      teamId,
      blocking: false,
      prompts,
    };

    logger.info(`Created suggestion ${suggestion.id} for thread ${threadId}`);

    // Emit event for platform to render (no storage needed)
    this.emit("suggestion:created", suggestion);
  }

  /**
   * Respond to an interaction (called when user clicks button or submits form)
   * Emits event that will be sent to worker via SSE
   */
  async respond(
    id: string,
    response: {
      answer?: string; // For simple button responses
      formData?: Record<string, any>; // For form responses
    },
    respondedByUserId?: string // Optional: who actually clicked/submitted
  ): Promise<void> {
    const key = `interaction:${id}`;
    const data = await this.redis.get(key);

    if (!data) {
      logger.warn(`Cannot respond to interaction ${id} - not found`);
      return;
    }

    const interaction: UserInteraction = JSON.parse(data);

    // Update interaction with response
    interaction.status = "responded";
    interaction.respondedAt = Date.now();
    interaction.response = {
      ...response,
      timestamp: Date.now(),
    };

    // Store who actually responded (might be different from who triggered the interaction)
    if (respondedByUserId) {
      interaction.respondedByUserId = respondedByUserId;
    }

    await this.redis.set(
      key,
      JSON.stringify(interaction),
      "EX",
      TIME.THREE_HOURS_SECONDS
    );

    // Remove from pending set
    const pendingKey = `interaction:pending:${interaction.threadId}`;
    await this.redis.srem(pendingKey, id);

    // Clear active interaction marker (allows heartbeat deltas again)
    const activeKey = `interaction:active:${interaction.threadId}`;
    await this.redis.del(activeKey);

    const responseStr = response.answer || JSON.stringify(response.formData);
    logger.info(
      `Interaction ${id} responded: ${responseStr} by user ${respondedByUserId || interaction.userId}`
    );

    // Emit event
    this.emit("interaction:responded", interaction);
  }

  /**
   * Get pending interactions for a thread (for restart recovery)
   */
  async getPendingInteractions(threadId: string): Promise<string[]> {
    const pendingKey = `interaction:pending:${threadId}`;
    return await this.redis.smembers(pendingKey);
  }

  /**
   * Get interaction by ID
   */
  async getInteraction(interactionId: string): Promise<UserInteraction | null> {
    const key = `interaction:${interactionId}`;
    const data = await this.redis.get(key);

    if (!data) {
      return null;
    }

    return JSON.parse(data) as UserInteraction;
  }

  /**
   * Get pending unanswered interactions for worker startup recovery
   *
   * Note: This only returns UNANSWERED interactions that are still in the pending set.
   * Answered interactions (those with responses) are removed from the pending set and
   * handled separately via SSE reconnection (see WorkerGateway.sendPendingInteractionResponses).
   *
   * Storage model:
   * - interaction:pending:{threadId} - SET of unanswered interaction IDs
   * - interaction:{id} - Full interaction objects (3h TTL)
   * - interaction:response:{threadId}:{id} - Failed response deliveries (1h TTL, separate flow)
   */
  async getPendingUnansweredInteractions(
    threadId: string
  ): Promise<PendingInteraction[]> {
    try {
      const pendingIds = await this.getPendingInteractions(threadId);

      if (pendingIds.length === 0) {
        return [];
      }

      // Get full interaction objects for pending (unanswered) interactions
      const interactions = await Promise.all(
        pendingIds.map((id) => this.getInteraction(id))
      );

      // Map to pending interaction format (no response field - these are all unanswered)
      return interactions
        .filter((i): i is UserInteraction => i !== null)
        .map((i) => ({
          id: i.id,
          type: i.interactionType,
          question: i.question,
          createdAt: i.createdAt,
        }));
    } catch (error) {
      logger.error(
        `Failed to get pending unanswered interactions for thread ${threadId}:`,
        error
      );
      return []; // Graceful degradation - return empty array on error
    }
  }

  /**
   * Save partial form data for multi-section workflows
   * Used when user fills one section but hasn't submitted all
   */
  async savePartialData(
    interactionId: string,
    sectionName: string,
    formData: Record<string, any>
  ): Promise<void> {
    const key = `interaction:${interactionId}`;
    const data = await this.redis.get(key);

    if (!data) {
      logger.warn(
        `Cannot save partial data for interaction ${interactionId} - not found`
      );
      return;
    }

    const interaction: UserInteraction = JSON.parse(data);

    // Initialize partialData if not exists
    if (!interaction.partialData) {
      interaction.partialData = {};
    }

    // Save this section's data
    interaction.partialData[sectionName] = formData;

    // Update in Redis
    await this.redis.set(
      key,
      JSON.stringify(interaction),
      "EX",
      TIME.THREE_HOURS_SECONDS
    );

    logger.info(
      `Saved partial data for section "${sectionName}" in interaction ${interactionId}`
    );
  }

  /**
   * Set active section for multi-section forms
   */
  async setActiveSection(
    interactionId: string,
    sectionName: string
  ): Promise<void> {
    const key = `interaction:${interactionId}`;
    const data = await this.redis.get(key);

    if (!data) {
      logger.warn(
        `Cannot set active section for interaction ${interactionId} - not found`
      );
      return;
    }

    const interaction: UserInteraction = JSON.parse(data);
    interaction.activeSection = sectionName;

    // Update in Redis
    await this.redis.set(
      key,
      JSON.stringify(interaction),
      "EX",
      TIME.THREE_HOURS_SECONDS
    );

    logger.info(
      `Set active section to "${sectionName}" for interaction ${interactionId}`
    );
  }

  /**
   * Submit all collected form data (multi-form workflow)
   */
  async submitAllForms(
    interactionId: string,
    respondedByUserId?: string
  ): Promise<void> {
    const key = `interaction:${interactionId}`;
    const data = await this.redis.get(key);

    if (!data) {
      logger.warn(
        `Cannot submit forms for interaction ${interactionId} - not found`
      );
      return;
    }

    const interaction: UserInteraction = JSON.parse(data);

    if (
      !interaction.partialData ||
      Object.keys(interaction.partialData).length === 0
    ) {
      logger.warn(`No partial data to submit for interaction ${interactionId}`);
      return;
    }

    // Flatten nested partialData structure for multi-section forms
    // partialData is: { "Section1": { "field1": "val1" }, "Section2": { "field2": "val2" } }
    // We need: { "field1": "val1", "field2": "val2" }
    const flattenedData: Record<string, any> = {};
    for (const sectionData of Object.values(interaction.partialData)) {
      if (typeof sectionData === "object" && sectionData !== null) {
        Object.assign(flattenedData, sectionData);
      }
    }

    logger.info(
      `Submitting flattened multi-section form data: ${JSON.stringify(flattenedData)}`
    );

    // Submit as final response with all form data
    await this.respond(
      interactionId,
      {
        formData: flattenedData,
      },
      respondedByUserId
    );
  }
}
