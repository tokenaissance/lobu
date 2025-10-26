import { createLogger, DEFAULTS } from "@peerbot/core";
import type { QueueProducer } from "../../infrastructure/queue/queue-producer";
import type {
  ThreadMessagePayload,
  WorkerDeploymentPayload,
} from "../../infrastructure/queue/queue-producer";
import type { ThreadSession, ISessionManager } from "../../session";
import { generateSessionKey } from "../../session";
import { setThreadStatus } from "../utils";
import type { MessageHandlerConfig } from "../config";
import type { SlackContext, WebClient, SlackMessageEvent } from "../types";

const logger = createLogger("dispatcher");

export class MessageHandler {
  private readonly SESSION_TTL = DEFAULTS.SESSION_TTL_MS;

  constructor(
    private queueProducer: QueueProducer,
    private config: MessageHandlerConfig,
    private sessionManager: ISessionManager
  ) {}

  /**
   * Get bot ID from configuration
   */
  private getBotId(): string {
    return this.config.slack.botId || "default-slack-bot";
  }

  /**
   * Handle user request by routing to appropriate queue
   */
  async handleUserRequest(
    context: SlackContext,
    userRequest: string,
    client: WebClient,
    files?: any[]
  ): Promise<void> {
    const requestStartTime = Date.now();
    logger.info(
      `[TIMING] handleUserRequest started at: ${new Date(requestStartTime).toISOString()}`
    );
    logger.info(
      `📨 Handling request from user ${context.userId} in thread ${context.threadTs || context.messageTs}`
    );

    // CRITICAL: Always use thread_ts for thread identification
    // For root messages: thread_ts is undefined, so we use message_ts
    // For replies in thread: thread_ts points to the root message
    // This ensures all messages in a thread share the same worker
    const normalizedThreadTs = context.threadTs || context.messageTs;

    // Log for debugging thread routing
    logger.info(
      `Thread routing - messageTs: ${context.messageTs}, threadTs: ${context.threadTs}, normalizedThreadTs: ${normalizedThreadTs}`
    );

    // Generate session key with normalized threadTs - use thread creator as userId for consistency
    const threadCreatorSessionKey = generateSessionKey({
      platform: "slack",
      channelId: context.channelId,
      userId: context.userId,
      threadId: normalizedThreadTs,
      messageId: context.messageTs,
    });

    // Check thread ownership using session manager
    const ownershipCheck = await this.sessionManager.validateThreadOwnership(
      context.channelId,
      normalizedThreadTs,
      context.userId
    );

    if (!ownershipCheck.allowed && ownershipCheck.owner) {
      logger.warn(
        `User ${context.userId} tried to interact with thread owned by ${ownershipCheck.owner}`
      );

      // Send ownership message
      await client.chat.postMessage({
        channel: context.channelId,
        thread_ts: normalizedThreadTs,
        text: `This thread is owned by <@${ownershipCheck.owner}>. Only the thread creator can interact with the bot in this conversation.`,
        mrkdwn: true,
      });

      return;
    }

    // Get existing session if any
    const existingSession = await this.sessionManager.findSessionByThread(
      context.channelId,
      normalizedThreadTs
    );

    const sessionKey = threadCreatorSessionKey;

    logger.info(
      `Handling request for session: ${sessionKey} (threadTs: ${normalizedThreadTs})`
    );

    logger.info(
      `Existing session status for ${sessionKey}: ${existingSession?.status || "none"}`
    );

    try {
      const threadTs = normalizedThreadTs;

      // Create thread session
      const threadSession: ThreadSession = {
        sessionKey,
        threadId: threadTs,
        channelId: context.channelId,
        userId: context.userId,
        threadCreator: context.userId, // Store the thread creator
        lastActivity: Date.now(),
        status: "pending",
        createdAt: Date.now(),
      };

      await this.sessionManager.setSession(threadSession);

      // Show immediate typing indicator
      await setThreadStatus(
        client,
        context.channelId,
        normalizedThreadTs,
        "is thinking..."
      );

      // Determine if this is a new conversation
      // A conversation is new only if this message is the ROOT of the thread (messageTs === threadTs)
      // OR if there's no thread_ts at all (first message in a channel/DM)
      const isNewConversation =
        context.messageTs === normalizedThreadTs && !existingSession;

      if (isNewConversation) {
        const deploymentPayload: WorkerDeploymentPayload = {
          userId: context.userId,
          botId: this.getBotId(),
          threadId: threadTs,
          platform: "slack",
          platformUserId: context.userId,
          messageId: context.messageTs,
          messageText: userRequest,
          channelId: context.channelId,
          platformMetadata: {
            teamId: context.teamId,
            userDisplayName: context.userDisplayName,
            responseChannel: context.channelId,
            responseId: context.messageTs,
            originalMessageId: context.messageTs,
            botResponseId: threadSession.botResponseId,
            files: files || [],
          },
          agentOptions: {
            allowedTools: this.config.agentOptions.allowedTools,
            model: this.config.agentOptions.model,
            timeoutMinutes: this.config.sessionTimeoutMinutes.toString(),
          },
          routingMetadata: {
            targetThreadId: threadTs,
            userId: context.userId,
          },
        };

        const jobId =
          await this.queueProducer.enqueueMessage(deploymentPayload);

        logger.info(
          `Enqueued direct message job ${jobId} for session ${sessionKey}`
        );
        threadSession.status = "pending";
      } else {
        // Enqueue to user-specific queue
        const threadPayload: ThreadMessagePayload = {
          botId: this.getBotId(),
          userId: context.userId,
          threadId: threadTs,
          platform: "slack",
          channelId: context.channelId,
          messageId: context.messageTs,
          messageText: userRequest,
          platformMetadata: {
            teamId: context.teamId,
            userDisplayName: context.userDisplayName,
            responseChannel: context.channelId,
            responseId: context.messageTs,
            originalMessageId: context.messageTs,
            botResponseId: threadSession.botResponseId,
            files: files || [],
          },
          agentOptions: {
            ...this.config.agentOptions,
            timeoutMinutes: this.config.sessionTimeoutMinutes.toString(),
          },
          routingMetadata: {
            targetThreadId: threadTs,
            userId: context.userId,
          },
        };

        const jobId = await this.queueProducer.enqueueMessage(threadPayload);

        logger.info(
          `Enqueued thread message job ${jobId} for thread ${threadTs}`
        );
        threadSession.status = "running";
      }
    } catch (error) {
      logger.error(
        `Failed to handle request for session ${sessionKey}:`,
        error
      );

      // Handle all errors the same way - let the worker decide what to show
      try {
        await setThreadStatus(
          client,
          context.channelId,
          normalizedThreadTs,
          "encountered an error"
        );
      } catch (statusError) {
        logger.error("Failed to update error status:", statusError);
      }

      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorMsg = `❌ *Error:* ${errorMessage || "Unknown error occurred"}`;

      // Post error message in thread
      const threadTs = context.threadTs || context.messageTs;
      await client.chat.postMessage({
        channel: context.channelId,
        thread_ts: threadTs,
        text: errorMsg,
        mrkdwn: true,
      });

      // Clean up session
      await this.sessionManager.deleteSession(sessionKey);
    }
  }

  /**
   * Extract Slack context from event
   */
  extractSlackContext(event: SlackMessageEvent): SlackContext {
    return {
      channelId: event.channel,
      userId: event.user || "",
      teamId: event.team || "",
      threadTs: event.thread_ts,
      messageTs: event.ts,
      text: event.text || "",
      userDisplayName:
        (event as { user_profile?: { display_name?: string } }).user_profile
          ?.display_name || "Unknown User",
    };
  }

  /**
   * Extract user request from mention text
   */
  extractUserRequest(text: string): string {
    const cleaned = text.replace(/<@[^>]+>/g, "").trim();

    if (!cleaned) {
      return "Hello! How can I help you today?";
    }

    return cleaned;
  }

  /**
   * Check if user is allowed to use the bot
   * Note: User allowlisting removed - all users are allowed by default
   */
  isUserAllowed(_userId: string): boolean {
    return true; // All users allowed
  }

  /**
   * Cleanup expired data from session store
   */
  async cleanupExpiredData(): Promise<void> {
    const deletedCount = await this.sessionManager.cleanupExpired(
      this.SESSION_TTL
    );
    if (deletedCount > 0) {
      logger.info(`Cleanup completed - Deleted ${deletedCount} sessions`);
    }
  }
}
