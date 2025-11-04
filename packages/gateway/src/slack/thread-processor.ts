#!/usr/bin/env bun

import type { IModuleRegistry } from "@peerbot/core";
import { createLogger, DEFAULTS, REDIS_KEYS } from "@peerbot/core";
import type { AnyBlock } from "@slack/types";
import { WebClient } from "@slack/web-api";
import type Redis from "ioredis";
import type {
  IMessageQueue,
  QueueJob,
  ThreadResponsePayload,
} from "../infrastructure/queue";
import {
  type ModuleButton,
  SlackBlockBuilder,
} from "./converters/block-builder";
import { extractCodeBlockActions } from "./converters/blockkit";
import { convertMarkdownToSlack } from "./converters/markdown";

const logger = createLogger("dispatcher");

/**
 * Represents a single Slack chatStream session
 */
class StreamSession {
  private streamTs: string | null = null;
  private messageTs: string | null = null;
  private started: boolean = false;
  private slackClient: WebClient;
  private channelId: string;
  private threadTs: string;
  private userId: string;
  private teamId?: string;

  constructor(
    slackClient: WebClient,
    channelId: string,
    threadTs: string,
    userId: string,
    teamId?: string
  ) {
    this.slackClient = slackClient;
    this.channelId = channelId;
    this.threadTs = threadTs;
    this.userId = userId;
    this.teamId = teamId;
  }

  /**
   * Set "is running..." status indicator
   */
  private async setRunningStatus(): Promise<void> {
    try {
      await this.slackClient.apiCall("assistant.threads.setStatus", {
        channel_id: this.channelId,
        thread_ts: this.threadTs,
        status: "is running..",
        loading_messages: [
          "working on it...",
          "thinking...",
          "processing...",
          "cooking something up...",
          "crafting a response...",
          "figuring it out...",
          "on the case...",
          "analyzing...",
          "computing...",
        ],
      });
      logger.info(
        `Set "is running" status for channel ${this.channelId}, thread ${this.threadTs}`
      );
    } catch (error) {
      // Non-critical
      logger.warn(`Failed to set running status: ${error}`);
    }
  }

  /**
   * Clear status indicator
   */
  private async clearStatus(): Promise<void> {
    try {
      await this.slackClient.apiCall("assistant.threads.setStatus", {
        channel_id: this.channelId,
        thread_ts: this.threadTs,
        status: "",
      });
      logger.info(
        `Cleared status for channel ${this.channelId}, thread ${this.threadTs}`
      );
    } catch (error) {
      // Non-critical
      logger.warn(`Failed to clear status: ${error}`);
    }
  }

  async appendDelta(
    delta: string,
    isFullReplacement: boolean = false
  ): Promise<string | null> {
    // If this is a full replacement and we have an active stream, stop it first
    if (isFullReplacement && this.started && this.streamTs) {
      logger.info(
        `🔄 REPLACING STREAM CONTENT: channel=${this.channelId}, thread=${this.threadTs}`
      );
      await this.stop();
      this.started = false;
      this.streamTs = null;
    }

    if (!this.started) {
      // Start new stream
      logger.info(
        `🚀 STARTING NEW STREAM: channel=${this.channelId}, thread=${this.threadTs}, deltaLength=${delta.length}`
      );
      const response = (await this.slackClient.apiCall("chat.startStream", {
        channel: this.channelId,
        thread_ts: this.threadTs,
        markdown_text: convertMarkdownToSlack(delta),
        recipient_user_id: this.userId,
        ...(this.teamId ? { recipient_team_id: this.teamId } : {}),
      })) as {
        ok?: boolean;
        stream_ts?: string;
        ts?: string;
        error?: string;
      };

      if (!response.ok) {
        const error = response.error || "unknown_error";
        logger.error(
          `Failed to start Slack stream for channel ${this.channelId}, thread ${this.threadTs}: ${error}`
        );
        throw new Error(`chat.startStream failed: ${error}`);
      }

      const streamTs = response.stream_ts || response.ts;
      const messageTs = response.ts || response.stream_ts;

      if (!streamTs) {
        logger.error(
          `chat.startStream response missing stream_ts for channel ${this.channelId}, thread ${this.threadTs}`
        );
        throw new Error("chat.startStream response missing stream_ts");
      }

      this.streamTs = streamTs;
      this.messageTs = messageTs ?? streamTs;
      this.started = true;
      logger.info(
        `✅ Stream started with initial content (${delta.length} chars) streamTs=${streamTs}, messageTs=${this.messageTs}`
      );

      await this.setRunningStatus();

      return this.messageTs ?? this.streamTs;
    } else {
      // Append to existing stream
      logger.info(
        `➕ APPENDING TO STREAM: channel=${this.channelId}, thread=${this.threadTs}, deltaLength=${delta.length}, streamTs=${this.streamTs}, messageTs=${this.messageTs}`
      );
      if (this.streamTs && this.messageTs) {
        try {
          const appendParams = {
            channel: this.channelId,
            stream_ts: this.streamTs,
            ts: this.messageTs,
            markdown_text: convertMarkdownToSlack(delta),
          };
          logger.info(
            `chat.appendStream params: channel=${this.channelId}, stream_ts=${this.streamTs}, ts=${this.messageTs}, delta_length=${delta.length}`
          );

          const response = (await this.slackClient.apiCall(
            "chat.appendStream",
            appendParams
          )) as { ok?: boolean; error?: string };

          if (!response.ok) {
            const error = response.error || "unknown_error";

            // Check if this is a streaming state error - restart stream with new message
            if (error === "message_not_in_streaming_state") {
              logger.warn(
                `⚠️ Streaming state lost for ${this.streamTs}, restarting stream with new message`
              );
              // Reset stream state
              this.streamTs = null;
              this.started = false;
              // Start a fresh stream with the current delta
              return this.appendDelta(delta, false);
            }

            logger.error(
              `Failed to append to Slack stream ${this.streamTs} in channel ${this.channelId}: ${error}`
            );
            throw new Error(`chat.appendStream failed: ${error}`);
          }
        } catch (error) {
          // Check if the error is about streaming state
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          if (errorMessage.includes("message_not_in_streaming_state")) {
            logger.warn(
              `⚠️ Streaming state lost (exception), restarting stream with new message`
            );
            // Reset stream state
            this.streamTs = null;
            this.started = false;
            // Start a fresh stream with the current delta
            return this.appendDelta(delta, false);
          }

          logger.error(`Exception during chat.appendStream: ${error}`, {
            streamTs: this.streamTs,
            messageTs: this.messageTs,
            channel: this.channelId,
            error,
          });
          throw error;
        }
      }
      logger.info(`✅ Appended ${delta.length} chars to existing stream`);
    }

    return this.messageTs ?? this.streamTs;
  }

  async stop(deleteMessage: boolean = false): Promise<void> {
    if (this.started && this.streamTs) {
      if (!this.messageTs) {
        logger.error(
          `Cannot stop stream ${this.streamTs} - missing message timestamp`
        );
        throw new Error("Cannot stop stream without message timestamp");
      }

      const response = (await this.slackClient.apiCall("chat.stopStream", {
        channel: this.channelId,
        stream_ts: this.streamTs,
        ts: this.messageTs,
      })) as { ok?: boolean; error?: string };

      if (!response.ok) {
        const error = response.error || "unknown_error";
        logger.error(
          `Failed to stop Slack stream ${this.streamTs} in channel ${this.channelId}: ${error}`
        );
        throw new Error(`chat.stopStream failed: ${error}`);
      }

      // Delete the message if requested (e.g., when stopping for interaction)
      if (deleteMessage && this.messageTs) {
        logger.info(
          `Deleting streaming message ${this.messageTs} from channel ${this.channelId}`
        );
        try {
          await this.slackClient.chat.delete({
            channel: this.channelId,
            ts: this.messageTs,
          });
          logger.info(`✅ Deleted streaming message ${this.messageTs}`);
        } catch (error) {
          logger.warn(
            `Failed to delete streaming message ${this.messageTs}: ${error}`
          );
          // Non-critical - continue anyway
        }
      }

      this.streamTs = null;
      this.messageTs = null;
      this.started = false;
      logger.info(
        `Stopped Slack stream for channel ${this.channelId}, thread ${this.threadTs}`
      );

      // Clear status indicator now that stream is complete
      await this.clearStatus();
    }
  }

  isStarted(): boolean {
    return this.started;
  }

  getMessageTs(): string | null {
    return this.messageTs ?? this.streamTs;
  }
}

/**
 * Manages all active stream sessions
 */
class StreamSessionManager {
  private sessions = new Map<string, StreamSession>();
  private slackClient: WebClient;

  constructor(slackClient: WebClient) {
    this.slackClient = slackClient;
  }

  async handleDelta(
    sessionId: string,
    channelId: string,
    threadTs: string,
    userId: string,
    delta: string,
    isFullReplacement: boolean = false,
    teamId?: string
  ): Promise<string | null> {
    let session = this.sessions.get(sessionId);

    if (!session) {
      // Create new session
      session = new StreamSession(
        this.slackClient,
        channelId,
        threadTs,
        userId,
        teamId
      );
      this.sessions.set(sessionId, session);
    }

    const streamTs = await session.appendDelta(delta, isFullReplacement);
    return streamTs ?? session.getMessageTs();
  }

  async completeSession(
    sessionId: string,
    deleteMessage: boolean = false
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      await session.stop(deleteMessage);
      this.sessions.delete(sessionId);
    }
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  async completeAllSessionsForThread(
    threadTs: string,
    deleteMessage: boolean = false
  ): Promise<number> {
    let stoppedCount = 0;
    const sessionsToStop: string[] = [];

    // Find all sessions for this thread
    for (const [sessionId, session] of this.sessions.entries()) {
      if ((session as any).threadTs === threadTs) {
        sessionsToStop.push(sessionId);
      }
    }

    // Stop all matching sessions
    for (const sessionId of sessionsToStop) {
      await this.completeSession(sessionId, deleteMessage);
      stoppedCount++;
    }

    return stoppedCount;
  }
}

/**
 * Consumer that listens to thread_response queue and updates Slack messages
 * This handles all Slack communication that was previously done by the workerdon
 */
export class ThreadResponseConsumer {
  private queue: IMessageQueue;
  private redis: Redis;
  private slackClient: WebClient;
  private isRunning = false;
  private blockBuilder: SlackBlockBuilder;
  private readonly BOT_MESSAGES_PREFIX = REDIS_KEYS.BOT_MESSAGES;
  private moduleRegistry: IModuleRegistry;
  private streamSessionManager: StreamSessionManager;

  constructor(
    queue: IMessageQueue,
    slackToken: string,
    moduleRegistry: IModuleRegistry
  ) {
    this.queue = queue;
    this.slackClient = new WebClient(slackToken);
    this.blockBuilder = new SlackBlockBuilder();
    this.moduleRegistry = moduleRegistry;
    this.streamSessionManager = new StreamSessionManager(this.slackClient);
    // Get Redis client from queue connection pool (queue must be started)
    this.redis = this.queue.getRedisClient();
  }

  /**
   * Stop stream for a specific thread
   * Called when an interaction is created to prevent messages appearing after the interaction
   */
  async stopStreamForThread(_userId: string, threadId: string): Promise<void> {
    logger.info(
      `Stopping all streams for thread ${threadId} due to interaction creation - deleting messages`
    );
    // Stop all sessions for this thread (session keys use messageId, not threadId)
    const stoppedCount =
      await this.streamSessionManager.completeAllSessionsForThread(
        threadId,
        true
      );

    if (stoppedCount > 0) {
      logger.info(
        `✅ Stopped and deleted ${stoppedCount} stream(s) for thread ${threadId}`
      );
    } else {
      logger.debug(`No active streams found for thread ${threadId}`);
    }
  }

  /**
   * Get bot message timestamp from Redis
   */
  private async getBotMessageTs(sessionKey: string): Promise<string | null> {
    const key = `${this.BOT_MESSAGES_PREFIX}${sessionKey}`;
    return await this.redis.get(key);
  }

  /**
   * Store bot message timestamp in Redis with 24h TTL
   */
  private async setBotMessageTs(
    sessionKey: string,
    botMessageTs: string
  ): Promise<void> {
    const key = `${this.BOT_MESSAGES_PREFIX}${sessionKey}`;
    await this.redis.set(key, botMessageTs, "EX", DEFAULTS.SESSION_TTL_SECONDS);
  }

  /**
   * Start consuming thread_response messages
   */
  async start(): Promise<void> {
    try {
      await this.queue.start();

      // Create the thread_response queue if it doesn't exist
      await this.queue.createQueue("thread_response");

      // Register job handler for thread response messages
      await this.queue.work(
        "thread_response",
        this.handleThreadResponse.bind(this)
      );

      this.isRunning = true;
      logger.info("✅ Thread response consumer started");
    } catch (error) {
      logger.error("Failed to start thread response consumer:", error);
      throw error;
    }
  }

  /**
   * Stop the consumer
   */
  async stop(): Promise<void> {
    try {
      this.isRunning = false;
      await this.queue.stop();
      logger.info("✅ Thread response consumer stopped");
    } catch (error) {
      logger.error("Error stopping thread response consumer:", error);
      throw error;
    }
  }

  /**
   * Parse thread response job data from queue format
   */
  private parseThreadResponseJob(
    job: QueueJob<ThreadResponsePayload>
  ): ThreadResponsePayload {
    const data = job.data;

    if (!data || !data.messageId) {
      throw new Error(`Invalid thread response data: ${JSON.stringify(data)}`);
    }
    logger.info(
      `📤 AGENT RESPONSE: Processing agent response for user ${data.userId}, thread ${data.threadId || "unknown"}, jobId: ${job.id}`
    );

    return data;
  }

  /**
   * Update thread status indicator with elapsed time
   */
  private async updateThreadStatus(
    channelId: string,
    threadId: string,
    elapsedSeconds: number,
    state: string
  ): Promise<void> {
    try {
      // Don't update status if there's an active interaction for this thread
      const activeInteractionKey = `interaction:active:${threadId}`;
      const activeInteractionId = await this.redis.get(activeInteractionKey);

      if (activeInteractionId) {
        logger.debug(
          `Skipping status update for thread ${threadId} - active interaction ${activeInteractionId}`
        );
        return;
      }

      const statusText = `is ${state}...`;
      const loadingMessages = [
        `still ${state}... (${elapsedSeconds}s)`,
        `working on it... (${elapsedSeconds}s)`,
        `${state} your request... (${elapsedSeconds}s)`,
      ];

      await this.slackClient.apiCall("assistant.threads.setStatus", {
        channel_id: channelId,
        thread_ts: threadId,
        status: statusText,
        loading_messages: loadingMessages,
      });

      logger.debug(
        `Updated status for thread ${threadId}: ${state} (${elapsedSeconds}s)`
      );
    } catch (error) {
      logger.warn(`Failed to update thread status: ${error}`);
    }
  }

  /**
   * Process streaming delta content
   */
  private async processStreamDelta(
    data: ThreadResponsePayload,
    sessionKey: string
  ): Promise<string | null> {
    if (!data.delta) {
      return null;
    }

    // Suppress deltas when thread has an active interaction
    const activeInteractionKey = `interaction:active:${data.threadId}`;
    const activeInteractionId = await this.redis.get(activeInteractionKey);

    if (activeInteractionId) {
      logger.info(
        `Suppressing delta for thread ${data.threadId} - active interaction ${activeInteractionId}`
      );
      return null;
    }

    logger.info(
      `Processing stream delta length=${data.delta.length} for session ${sessionKey}, isFullReplacement=${data.isFullReplacement || false}`
    );

    return await this.streamSessionManager.handleDelta(
      sessionKey,
      data.channelId,
      data.threadId,
      data.userId,
      data.delta,
      data.isFullReplacement || false,
      data.teamId
    );
  }

  /**
   * Complete streaming session and handle final content
   */
  private async completeStreamingSession(
    data: ThreadResponsePayload,
    sessionKey: string,
    _existingBotMessageTs: string | null,
    _isFirstResponse: boolean
  ): Promise<void> {
    const hasActiveStream = this.streamSessionManager.hasSession(sessionKey);

    if (hasActiveStream) {
      logger.info(`Completing active stream for session ${sessionKey}`);
      await this.streamSessionManager.completeSession(sessionKey);
    } else {
      // Clear status even if no session exists (handles "is scheduling..." status)
      try {
        await this.slackClient.apiCall("assistant.threads.setStatus", {
          channel_id: data.channelId,
          thread_ts: data.threadId,
          status: "",
        });
        logger.info(
          `Cleared status for channel ${data.channelId}, thread ${data.threadId}`
        );
      } catch (error) {
        logger.warn(`Failed to clear status: ${error}`);
      }
    }
  }

  /**
   * Store bot message timestamp for future updates
   */
  private async storeBotMessageTimestamp(
    sessionKey: string,
    newBotResponseTs: string,
    _data: ThreadResponsePayload
  ): Promise<void> {
    logger.info(
      `Bot created first response with ts: ${newBotResponseTs}, storing for session ${sessionKey}`
    );
    await this.setBotMessageTs(sessionKey, newBotResponseTs);
  }

  /**
   * Handle thread response message jobs
   */
  private async handleThreadResponse(
    job: QueueJob<ThreadResponsePayload>
  ): Promise<void> {
    let data: ThreadResponsePayload | undefined;

    try {
      data = this.parseThreadResponseJob(job);

      logger.info(
        `Processing thread response job for message ${data.messageId}, originalMessageId: ${data.originalMessageId}, botResponseId: ${data.botResponseId}`
      );

      // Create a session key to track bot messages per conversation
      const sessionKey = `${data.userId}:${data.originalMessageId || data.messageId}`;

      logger.info(`Using session key: ${sessionKey}`);
      logger.info(
        `Thread response data fields: ${Object.keys(data).join(", ")}`
      );

      // Check if we have a bot message for this Claude session
      const redisBotMessageTs = await this.getBotMessageTs(sessionKey);
      let existingBotMessageTs = data.botResponseId || redisBotMessageTs;
      let isFirstResponse = !existingBotMessageTs;

      // Handle ephemeral messages (OAuth/auth flows) early
      if (data.ephemeral && data.content) {
        await this.handleEphemeralMessage(data);
        return;
      }

      // Handle status updates (heartbeat with elapsed time)
      if (data.statusUpdate) {
        await this.updateThreadStatus(
          data.channelId,
          data.threadId,
          data.statusUpdate.elapsedSeconds,
          data.statusUpdate.state
        );
        return; // Early return - status updates don't need further processing
      }

      // Handle streaming delta
      const streamTs = await this.processStreamDelta(data, sessionKey);
      if (streamTs) {
        const storedTsChanged =
          !redisBotMessageTs || redisBotMessageTs !== streamTs;
        existingBotMessageTs = streamTs;
        if (storedTsChanged) {
          await this.storeBotMessageTimestamp(sessionKey, streamTs, data);
        }
        isFirstResponse = false;
      }

      // Early return after stream delta if no other content to process
      if (data.delta && !data.error) {
        return;
      }

      // Handle error signals
      if (data.error) {
        const botMessageTs = existingBotMessageTs || data.botResponseId;
        await this.handleError(data, isFirstResponse, botMessageTs);
        // Clean up session and clear status indicator on error
        await this.completeStreamingSession(
          data,
          sessionKey,
          existingBotMessageTs,
          isFirstResponse
        );
      }

      // Handle completion
      if (
        Array.isArray(data.processedMessageIds) &&
        data.processedMessageIds.length > 0
      ) {
        logger.info(
          `Thread processing completed for message ${data.messageId}`
        );
        await this.completeStreamingSession(
          data,
          sessionKey,
          existingBotMessageTs,
          isFirstResponse
        );
        // Status is cleared automatically by StreamSession.stop()
      }
    } catch (error: unknown) {
      // Log the error details
      if (typeof error === "object" && error !== null) {
        const err = error as {
          data?: { error?: string };
          code?: string;
          message?: string;
        };

        // Check if it's a validation error that shouldn't be retried
        if (
          err.data?.error === "invalid_blocks" ||
          err.data?.error === "msg_too_long" ||
          err.data?.error === "message_not_in_streaming_state" ||
          err.code === "slack_webapi_platform_error"
        ) {
          logger.error(
            `Slack validation error (not retrying): ${err.data?.error || err.message}`,
            {
              jobId: job.id,
              messageId: data?.messageId,
              threadId: data?.threadId,
              error: err.data?.error || err.message,
            }
          );

          // Don't throw - mark job as complete to prevent retry loops
          // Note: We don't try to update the message here because:
          // 1. If streaming is active, chat.update would conflict with the stream
          // 2. The content has validation issues that would likely fail again
          // 3. The worker should handle showing errors in its own stream content
          // 4. message_not_in_streaming_state means stream already ended/never started

          // Clean up session and clear status on validation error
          if (
            data?.channelId &&
            data?.threadId &&
            data?.userId &&
            data?.messageId
          ) {
            try {
              const sessionKey = `${data.userId}:${data.originalMessageId || data.messageId}`;
              await this.completeStreamingSession(
                data,
                sessionKey,
                null,
                false
              );
            } catch (cleanupError) {
              logger.warn(
                `Failed to cleanup session after validation error: ${cleanupError}`
              );
              // Continue anyway - we don't want cleanup errors to cause retries
            }
          }
          return;
        }
      }

      logger.error(`Failed to process thread response job ${job.id}:`, error);

      // Clean up session and clear status on error
      if (
        data?.channelId &&
        data?.threadId &&
        data?.userId &&
        data?.messageId
      ) {
        try {
          const sessionKey = `${data.userId}:${data.originalMessageId || data.messageId}`;
          await this.completeStreamingSession(data, sessionKey, null, false);
        } catch (cleanupError) {
          logger.warn(`Failed to cleanup session after error: ${cleanupError}`);
          // Continue to throw original error - cleanup failures shouldn't mask it
        }
      }

      throw error; // Let the queue handle retry logic for other errors
    }
  }

  /**
   * Handle ephemeral message (only visible to specific user)
   */
  private async handleEphemeralMessage(
    data: ThreadResponsePayload
  ): Promise<void> {
    const { content, channelId, userId, threadId } = data;

    if (!content) return;

    try {
      logger.info(
        `Sending ephemeral message to user ${userId} in channel ${channelId}`
      );

      // Parse content (could be JSON blocks or markdown)
      const { text, blocks } = await this.parseMessageContent(content, data);

      // Send as ephemeral message
      await this.slackClient.chat.postEphemeral({
        channel: channelId,
        user: userId,
        thread_ts: threadId, // Send in thread if applicable
        text,
        blocks,
      });

      logger.info(`Ephemeral message sent successfully to user ${userId}`);
    } catch (error: unknown) {
      if (error instanceof Error) {
        logger.error(`Failed to send ephemeral message: ${error.message}`);
      } else {
        logger.error(`Failed to send ephemeral message: ${error}`);
      }
      throw error;
    }
  }

  /**
   * Parse message content - handles JSON blocks or markdown
   */
  private async parseMessageContent(
    content: string,
    data: ThreadResponsePayload
  ): Promise<{ text: string; blocks: AnyBlock[] }> {
    // Check if content is JSON with blocks (from authentication prompt)
    try {
      const parsed = JSON.parse(content);
      if (parsed.blocks && Array.isArray(parsed.blocks)) {
        logger.debug(
          `Content is pre-formatted blocks - blocks count: ${parsed.blocks.length}`
        );
        return {
          text: parsed.blocks[0]?.text?.text || "Authentication required",
          blocks: parsed.blocks,
        };
      }
    } catch {
      // Not JSON or not blocks format - continue to markdown processing
    }

    // Process as markdown
    logger.debug(
      `Processing content for Slack - content length: ${content?.length || 0}`
    );

    // Extract code block actions and process markdown
    const { processedContent, actionButtons: codeBlockButtons } =
      extractCodeBlockActions(content);
    const text = convertMarkdownToSlack(processedContent);

    logger.debug(
      `Extracted ${codeBlockButtons.length} code block action buttons`
    );

    // Get action buttons from modules
    const moduleButtons = await this.getModuleActionButtons(
      data.userId,
      data.channelId,
      data.threadId,
      data.moduleData
    );

    // Combine all action buttons
    const allActionButtons = [...codeBlockButtons, ...moduleButtons];

    // Use block builder to create proper blocks with validation
    const result = this.blockBuilder.buildBlocks(text, {
      actionButtons: allActionButtons,
      includeActionButtons: true,
    });

    return { text: result.text, blocks: result.blocks };
  }

  /**
   * Handle error messages
   */
  private async handleError(
    data: ThreadResponsePayload,
    isFirstResponse: boolean,
    botMessageTs?: string
  ): Promise<void> {
    const { error, channelId, threadId, userId } = data;

    if (!error) return;

    try {
      logger.info(
        `Sending error message to channel ${channelId}, thread ${threadId}`
      );

      // Get action buttons from modules
      const actionButtons = await this.getModuleActionButtons(
        userId,
        data.channelId,
        data.threadId,
        data.moduleData
      );

      // Use block builder for error blocks
      const errorResult = this.blockBuilder.buildErrorBlocks(
        error,
        actionButtons
      );

      if (isFirstResponse) {
        // Create new error message
        const postResult = await this.slackClient.chat.postMessage({
          channel: channelId,
          thread_ts: threadId,
          text: errorResult.text,
          mrkdwn: true,
          blocks: errorResult.blocks,
          unfurl_links: true,
          unfurl_media: true,
        });
        logger.info(`Error message created: ${postResult.ok}`);
      } else {
        // Update existing message with error - use the passed botMessageTs or fallback
        const botTs = botMessageTs || data.botResponseId || threadId;
        const updateResult = await this.slackClient.chat.update({
          channel: channelId,
          ts: botTs,
          text: errorResult.text,
          blocks: errorResult.blocks,
        });
        logger.info(`Error message update result: ${updateResult.ok}`);
      }
    } catch (updateError: unknown) {
      const err = updateError as { message?: string };
      logger.error(
        `Failed to send error message to Slack: ${err.message || updateError}`
      );
      throw updateError;
    }
  }

  /**
   * Get action buttons from all registered modules
   * Extracted to deduplicate code between message and error handling
   */
  private async getModuleActionButtons(
    userId: string,
    channelId: string,
    threadTs: string,
    moduleData?: Record<string, unknown>
  ): Promise<ModuleButton[]> {
    const actionButtons: ModuleButton[] = [];
    const dispatcherModules = this.moduleRegistry.getDispatcherModules();

    for (const module of dispatcherModules) {
      try {
        const moduleButtons = await module.generateActionButtons({
          userId,
          channelId,
          threadTs,
          slackClient: this.slackClient,
          moduleData: moduleData?.[module.name],
        });

        // Validate and convert buttons
        for (const btn of moduleButtons) {
          if (!btn.text || !btn.action_id) {
            logger.warn(
              `Invalid button from module ${module.name}: missing text or action_id`,
              btn
            );
            continue;
          }

          actionButtons.push({
            text: btn.text,
            action_id: btn.action_id,
            style: btn.style,
            value: btn.value,
          });
        }
      } catch (error) {
        logger.error(
          `Failed to get action buttons from module ${module.name}:`,
          error
        );
      }
    }

    return actionButtons;
  }

  /**
   * Check if consumer is running and healthy
   */
  isHealthy(): boolean {
    return this.isRunning;
  }

  /**
   * Get current status
   */
  getStatus(): {
    isRunning: boolean;
  } {
    return {
      isRunning: this.isRunning,
    };
  }
}

// Export functions for backward compatibility
export { convertMarkdownToSlack };
