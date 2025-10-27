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
import { setThreadStatus } from "./utils";

const logger = createLogger("dispatcher");

/**
 * Type for Slack chat stream (undocumented API)
 */
interface ChatStream {
  append(data: { markdown_text: string }): Promise<void>;
  stop(): Promise<void>;
}

/**
 * Represents a single Slack chatStream session
 */
class StreamSession {
  private stream: ChatStream | null = null;
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

  async appendDelta(
    delta: string,
    isFullReplacement: boolean = false
  ): Promise<void> {
    // If this is a full replacement and we have an active stream, stop it first
    if (isFullReplacement && this.started && this.stream) {
      logger.info(
        `🔄 REPLACING STREAM CONTENT: channel=${this.channelId}, thread=${this.threadTs}`
      );
      await this.stream.stop();
      this.started = false;
      this.stream = null;
    }

    if (!this.started) {
      // Start new stream
      logger.info(
        `🚀 STARTING NEW STREAM: channel=${this.channelId}, thread=${this.threadTs}, deltaLength=${delta.length}`
      );
      this.stream = (this.slackClient as any).chatStream({
        channel: this.channelId,
        thread_ts: this.threadTs,
        recipient_user_id: this.userId,
        markdown_text: delta,
        ...(this.teamId ? { recipient_team_id: this.teamId } : {}),
      });
      this.started = true;
      logger.info(
        `✅ Stream started with initial content (${delta.length} chars)`
      );
    } else {
      // Append to existing stream
      logger.info(
        `➕ APPENDING TO STREAM: channel=${this.channelId}, thread=${this.threadTs}, deltaLength=${delta.length}`
      );
      if (this.stream) {
        await this.stream.append({ markdown_text: delta });
      }
      logger.info(`✅ Appended ${delta.length} chars to existing stream`);
    }
  }

  async stop(): Promise<void> {
    if (this.started && this.stream) {
      await this.stream.stop();
      this.stream = null;
      logger.info(
        `Stopped Slack stream for channel ${this.channelId}, thread ${this.threadTs}`
      );
    }
  }

  isStarted(): boolean {
    return this.started;
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
  ): Promise<void> {
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

    await session.appendDelta(delta, isFullReplacement);
  }

  async completeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      await session.stop();
      this.sessions.delete(sessionId);
    }
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
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
   * Process streaming delta content
   */
  private async processStreamDelta(
    data: ThreadResponsePayload,
    sessionKey: string
  ): Promise<void> {
    if (!data.isStreamDelta || !data.delta) {
      return;
    }

    logger.info(
      `Processing stream delta length=${data.delta.length} for session ${sessionKey}, isFullReplacement=${data.isFullReplacement || false}`
    );

    await this.streamSessionManager.handleDelta(
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
    existingBotMessageTs: string | null,
    isFirstResponse: boolean
  ): Promise<void> {
    const hasActiveStream = this.streamSessionManager.hasSession(sessionKey);

    if (hasActiveStream) {
      logger.info(`Completing active stream for session ${sessionKey}`);
      await this.streamSessionManager.completeSession(sessionKey);
      // Don't set status - streaming completion handles it
    } else {
      // Clear status for non-streaming completion
      await setThreadStatus(
        this.slackClient,
        data.channelId,
        data.threadId,
        ""
      );

      if (data.finalContent) {
        // No streaming or stream wasn't active - post content directly
        logger.info(
          `Posting final content directly (${data.finalContent.length} chars) - usedStreaming: ${data.usedStreaming}, hasActiveStream: ${hasActiveStream}`
        );
        const botMessageTs = existingBotMessageTs || data.botResponseId;
        await this.handleMessageUpdate(
          { ...data, content: data.finalContent },
          isFirstResponse,
          botMessageTs
        );
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
      const existingBotMessageTs = data.botResponseId || redisBotMessageTs;
      const isFirstResponse = !existingBotMessageTs;

      // Handle streaming delta
      await this.processStreamDelta(data, sessionKey);

      // Apply status update if provided (works alongside streaming)
      if (data.statusUpdate) {
        logger.info(
          `Setting thread status to: "${data.statusUpdate.status}" for thread ${data.threadId}`
        );
        await setThreadStatus(
          this.slackClient,
          data.channelId,
          data.threadId,
          data.statusUpdate.status,
          data.statusUpdate.loadingMessages
        );
      }

      // Early return after stream delta if no other content to process
      if (data.isStreamDelta && !data.content && !data.error) {
        return;
      }

      // Handle message content
      if (data.content) {
        const botMessageTs = existingBotMessageTs || data.botResponseId;

        // Check if message should be ephemeral
        if (data.ephemeral) {
          await this.handleEphemeralMessage(data);
        } else {
          const newBotResponseTs = await this.handleMessageUpdate(
            data,
            isFirstResponse,
            botMessageTs
          );

          // Store the bot response timestamp in Redis for future updates
          if (isFirstResponse && newBotResponseTs) {
            await this.storeBotMessageTimestamp(
              sessionKey,
              newBotResponseTs,
              data
            );
          }
        }
      } else if (data.error) {
        const botMessageTs = existingBotMessageTs || data.botResponseId;
        await this.handleError(data, isFirstResponse, botMessageTs);
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
      }
    } catch (error: unknown) {
      // Check if it's a validation error that shouldn't be retried
      if (typeof error === "object" && error !== null) {
        const err = error as {
          data?: { error?: string };
          code?: string;
          message?: string;
        };
        if (
          err.data?.error === "invalid_blocks" ||
          err.data?.error === "msg_too_long" ||
          err.code === "slack_webapi_platform_error"
        ) {
          logger.error(
            `Slack validation error: ${err.data?.error || err.message}`
          );

          // Try to inform the user about the validation error
          if (data?.channelId && data.messageId) {
            try {
              await this.slackClient.chat.update({
                channel: data.channelId,
                ts: data.messageId,
                text: `❌ **Message update failed**\n\n**Error:** ${err.data?.error || err.message}\n\nThe response may contain invalid formatting or be too long for Slack.`,
              });
              logger.info(
                `Notified user about validation error in job ${job.id}`
              );
            } catch (notifyError) {
              logger.error(
                `Failed to notify user about validation error: ${notifyError}`
              );
            }
          }

          // Don't throw - mark job as complete to prevent retry loops
          return;
        }
      }

      logger.error(`Failed to process thread response job ${job.id}:`, error);
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
   * Post or update Slack message
   */
  private async postOrUpdateSlackMessage(
    channelId: string,
    threadTs: string,
    text: string,
    blocks: AnyBlock[],
    isFirstResponse: boolean,
    botMessageTs?: string
  ): Promise<string | undefined> {
    logger.debug(
      `Final blocks to send - count: ${blocks.length}, types: ${blocks.map((b) => b.type).join(", ")}`
    );

    if (isFirstResponse) {
      // Create new message for first response
      logger.info(
        `Creating new bot message in channel ${channelId}, thread ${threadTs}`
      );
      const postResult = await this.slackClient.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: text,
        mrkdwn: true,
        blocks: blocks,
        unfurl_links: true,
        unfurl_media: true,
      });

      logger.info(
        `Bot message created: ${postResult.ok}, ts: ${postResult.ts}`
      );

      if (!postResult.ok) {
        logger.error(`Failed to create bot message: ${postResult.error}`);
        return;
      }

      // Validate that Slack created the message in the correct thread
      const returnedTs = postResult.ts as string;
      const returnedThreadTs =
        (postResult.message as any)?.thread_ts || returnedTs;

      // Check if the message was created in the intended thread
      if (threadTs && returnedThreadTs !== threadTs) {
        // Delete the wrongly placed message
        try {
          await this.slackClient.chat.delete({
            channel: channelId,
            ts: returnedTs,
          });
          logger.info(`Deleted misplaced message ${returnedTs}`);
        } catch (deleteError) {
          logger.error(`Failed to delete misplaced message:`, deleteError);
        }

        // Retry with explicit thread creation
        await new Promise((resolve) => setTimeout(resolve, 1000));

        const retryResult = await this.slackClient.chat.postMessage({
          channel: channelId,
          thread_ts: threadTs,
          text: text,
          mrkdwn: true,
          blocks: blocks,
          unfurl_links: true,
          unfurl_media: true,
          reply_broadcast: false,
        });

        if (!retryResult.ok) {
          throw new Error(
            `Failed to create bot message after retry: ${retryResult.error}`
          );
        }

        return retryResult.ts as string;
      }

      return returnedTs;
    } else {
      // Update existing message
      const botTs = botMessageTs || threadTs;
      logger.info(`Updating bot message in channel ${channelId}, ts ${botTs}`);

      const updateResult = await this.slackClient.chat.update({
        channel: channelId,
        ts: botTs,
        text: text,
        blocks: blocks,
      });

      logger.info(`Slack update result: ${updateResult.ok}`);

      if (!updateResult.ok) {
        logger.error(`Slack update failed with error: ${updateResult.error}`);
      }

      return undefined;
    }
  }

  /**
   * Handle message content updates
   */
  private async handleMessageUpdate(
    data: ThreadResponsePayload,
    isFirstResponse: boolean,
    botMessageTs?: string
  ): Promise<string | undefined> {
    const { content, channelId, threadId } = data;

    if (!content) return;

    try {
      const { text, blocks } = await this.parseMessageContent(content, data);

      return await this.postOrUpdateSlackMessage(
        channelId,
        threadId,
        text,
        blocks,
        isFirstResponse,
        botMessageTs
      );
    } catch (error: unknown) {
      // Handle specific Slack errors
      if (typeof error === "object" && error !== null) {
        const err = error as {
          code?: string;
          data?: { error?: string };
          message?: string;
        };
        if (err.code === "message_not_found") {
          logger.error("Slack message not found - it may have been deleted");
        } else if (err.code === "channel_not_found") {
          logger.error("Slack channel not found - bot may not have access");
        } else if (err.code === "not_in_channel") {
          logger.error("Bot is not in the channel");
        } else if (
          err.data?.error === "invalid_blocks" ||
          err.data?.error === "msg_too_long"
        ) {
          // These are Slack validation errors - retrying won't help
          logger.error(`Slack validation error: ${JSON.stringify(error)}`);

          // Try to send a simple error message with raw content for recovery
          try {
            // Truncate content to fit in code block
            const maxContentLength = 2500;
            const truncatedContent =
              content.length > maxContentLength
                ? `${content.substring(0, maxContentLength)}\n...[truncated]`
                : content;

            const errorMessage = `❌ *Error occurred while updating message*\n\n*Error:* ${err.data?.error || ""}${err.message || ""}\n\nThe response may be too long or contain invalid formatting.\n\n*Raw Content:*\n\`\`\`\n${truncatedContent}\n\`\`\``;

            await this.slackClient.chat.update({
              channel: channelId,
              ts: threadId,
              text: errorMessage,
            });
            logger.info(
              `Sent fallback error message with raw content for validation error: ${err.data?.error}`
            );
          } catch (fallbackError) {
            logger.error(
              "Failed to send fallback error message:",
              fallbackError
            );
          }
          // Don't throw - this prevents retry loops for validation errors
        } else {
          if (error instanceof Error) {
            logger.error(`Failed to update Slack message: ${error.message}`);
          } else {
            logger.error(`Failed to update Slack message: ${error}`);
          }
          throw error;
        }
      }
    }
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
