#!/usr/bin/env bun

import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { createLogger, type UserSuggestion } from "@lobu/core";

const logger = createLogger("interactions");

/**
 * Payload emitted on "question:created" — platform renderers listen for this.
 */
export interface PostedQuestion {
  id: string;
  userId: string;
  conversationId: string;
  channelId: string;
  teamId?: string;
  question: string;
  options: string[];
}

/**
 * Platform-agnostic interaction service (fire-and-forget).
 * Posts questions with buttons; no Redis, no blocking, no state machine.
 * User clicks → platform converts to regular message → normal queue.
 */
export class InteractionService extends EventEmitter {
  private beforeCreateHook?: (
    userId: string,
    conversationId: string
  ) => Promise<void>;

  /**
   * Set a hook to run before creating interactions.
   * Used by platforms to stop streams before interaction messages appear.
   */
  setBeforeCreateHook(
    hook: (userId: string, conversationId: string) => Promise<void>
  ): void {
    this.beforeCreateHook = hook;
  }

  /**
   * Post a question with button options (non-blocking, fire-and-forget).
   * Emits "question:created" for platform renderers.
   */
  async postQuestion(
    userId: string,
    conversationId: string,
    channelId: string,
    teamId: string | undefined,
    question: string,
    options: string[]
  ): Promise<PostedQuestion> {
    if (this.beforeCreateHook) {
      await this.beforeCreateHook(userId, conversationId);
    }

    const posted: PostedQuestion = {
      id: `q_${randomUUID()}`,
      userId,
      conversationId,
      channelId,
      teamId,
      question,
      options,
    };

    logger.info(
      `Posted question ${posted.id} for conversation ${conversationId}`
    );

    this.emit("question:created", posted);
    return posted;
  }

  /**
   * Create non-blocking suggestions.
   * Emits event immediately, no state tracking needed.
   */
  async createSuggestion(
    userId: string,
    conversationId: string,
    channelId: string,
    teamId: string | undefined,
    prompts: Array<{ title: string; message: string }>
  ): Promise<void> {
    const suggestion: UserSuggestion = {
      id: `sug_${randomUUID()}`,
      userId,
      conversationId,
      channelId,
      teamId,
      blocking: false,
      prompts,
    };

    logger.info(
      `Created suggestion ${suggestion.id} for conversation ${conversationId}`
    );

    this.emit("suggestion:created", suggestion);
  }
}
