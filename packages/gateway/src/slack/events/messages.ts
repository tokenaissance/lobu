import { createLogger, DEFAULTS } from "@peerbot/core";
import type {
  QueueProducer,
  ThreadMessagePayload,
  WorkerDeploymentPayload,
} from "../../infrastructure/queue/queue-producer";
import type { InteractionService } from "../../interactions";
import type { ISessionManager, ThreadSession } from "../../session";
import { generateSessionKey } from "../../session";
import type { MessageHandlerConfig } from "../config";
import type { SlackContext, SlackMessageEvent, WebClient } from "../types";

const logger = createLogger("dispatcher");

export class MessageHandler {
  private readonly SESSION_TTL = DEFAULTS.SESSION_TTL_MS;

  constructor(
    private queueProducer: QueueProducer,
    private config: MessageHandlerConfig,
    private sessionManager: ISessionManager,
    private slackClient: WebClient,
    private interactionService: InteractionService
  ) {}

  /**
   * Get bot ID from configuration
   */
  private getBotId(): string {
    return this.config.slack.botId || "default-slack-bot";
  }

  /**
   * Set thread status indicator
   */
  private async setThreadStatus(
    channelId: string,
    threadTs: string,
    status: string
  ): Promise<void> {
    try {
      logger.info(
        `Setting thread status "${status}" for channel ${channelId}, thread ${threadTs}`
      );
      await this.slackClient.apiCall("assistant.threads.setStatus", {
        channel_id: channelId,
        thread_ts: threadTs,
        status,
        loading_messages: [
          "warming up...",
          "getting ready...",
          "thinking about it...",
          "on it...",
          "loading...",
          "waking up...",
          "brewing some thoughts...",
          "putting on thinking cap...",
        ],
      });
      logger.info(`Successfully set thread status "${status}"`);
    } catch (error) {
      // Non-critical - just log
      logger.warn(`Failed to set thread status: ${error}`);
    }
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

    // Check if this is a Direct Message channel (DMs start with 'D')
    const isDirectMessage = context.channelId.startsWith("D");

    // Only check thread ownership for non-DM channels
    if (!isDirectMessage) {
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
    } else {
      logger.info(
        `Skipping thread ownership check for DM channel ${context.channelId}`
      );
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

    // Check turn count to prevent infinite loops
    const maxTurns = process.env.MAX_TURNS
      ? parseInt(process.env.MAX_TURNS, 10)
      : 50;
    const currentTurnCount = (existingSession?.turnCount || 0) + 1;

    if (currentTurnCount > maxTurns) {
      logger.warn(
        `Thread ${normalizedThreadTs} exceeded MAX_TURNS (${maxTurns}). Preventing infinite loop.`
      );
      await client.chat.postMessage({
        channel: context.channelId,
        thread_ts: normalizedThreadTs,
        text: `⚠️ This conversation has exceeded the maximum turn limit (${maxTurns} turns). Please start a new thread to continue.`,
      });
      return;
    }

    logger.info(`Turn count: ${currentTurnCount}/${maxTurns}`);

    try {
      const threadTs = normalizedThreadTs;

      // Cancel any pending interactions for this thread when a new message arrives
      // This prevents the worker from being stuck waiting for interaction responses
      const pendingInteractionIds =
        await this.interactionService.getPendingInteractions(threadTs);
      if (pendingInteractionIds.length > 0) {
        logger.info(
          `Cancelling ${pendingInteractionIds.length} pending interaction(s) for thread ${threadTs} due to new user message`
        );

        for (const interactionId of pendingInteractionIds) {
          try {
            // Auto-respond with a cancellation message
            await this.interactionService.respond(
              interactionId,
              { answer: "[Cancelled - user sent a new message]" },
              context.userId
            );
            logger.info(`Cancelled pending interaction ${interactionId}`);
          } catch (err) {
            logger.error(`Failed to cancel interaction ${interactionId}:`, err);
          }
        }
      }

      // Create thread session with turn count
      const threadSession: ThreadSession = {
        sessionKey,
        threadId: threadTs,
        channelId: context.channelId,
        userId: context.userId,
        threadCreator: context.userId, // Store the thread creator
        lastActivity: Date.now(),
        createdAt: Date.now(),
        turnCount: currentTurnCount,
      };

      await this.sessionManager.setSession(threadSession);

      // Determine if this is a new conversation
      // A conversation is new only if this message is the ROOT of the thread (messageTs === threadTs)
      // OR if there's no thread_ts at all (first message in a channel/DM)
      const isNewConversation =
        context.messageTs === normalizedThreadTs && !existingSession;

      if (isNewConversation) {
        await this.sessionManager.setSession(threadSession);

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
            ...this.config.agentOptions,
            timeoutMinutes: this.config.sessionTimeoutMinutes.toString(),
          },
          routingMetadata: {
            targetThreadId: threadTs,
            userId: context.userId,
          },
        };

        const jobId =
          await this.queueProducer.enqueueMessage(deploymentPayload);

        // Set status indicator
        await this.setThreadStatus(
          context.channelId,
          threadTs,
          "is scheduling.."
        );

        logger.info(
          `Enqueued direct message job ${jobId} for session ${sessionKey}`
        );
      } else {
        await this.sessionManager.setSession(threadSession);

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

        // Set status indicator
        await this.setThreadStatus(
          context.channelId,
          threadTs,
          "is scheduling.."
        );

        logger.info(
          `Enqueued thread message job ${jobId} for thread ${threadTs}`
        );
      }
    } catch (error) {
      logger.error(
        `Failed to handle request for session ${sessionKey}:`,
        error
      );

      // Handle all errors the same way - let the worker decide what to show
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
  extractSlackContext(
    event: SlackMessageEvent,
    bodyTeamId?: string
  ): SlackContext {
    // TODO: this is hacky, the slackmessageevent must has the teamid
    const eventWithTeamId = event as SlackMessageEvent & { team_id?: string };
    const teamId = event.team || eventWithTeamId.team_id || bodyTeamId || "";

    return {
      channelId: event.channel,
      userId: event.user || "",
      teamId: teamId,
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
