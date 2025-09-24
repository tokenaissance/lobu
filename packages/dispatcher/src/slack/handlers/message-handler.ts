import { SessionUtils } from "@peerbot/shared";
import logger from "../../logger";
import { decrypt } from "../../utils/encryption";
import type {
  QueueProducer,
  ThreadMessagePayload,
  WorkerDeploymentPayload,
} from "../../queue/task-queue-producer";
import type {
  DispatcherConfig,
  SlackContext,
  ThreadSession,
} from "../../types";
import type { GitHubRepositoryManager } from "../../github/repository-manager";
import { getDbPool } from "../../db";

export class MessageHandler {
  private activeSessions = new Map<string, ThreadSession>();
  private userMappings = new Map<string, string>(); // slackUserId -> githubUsername
  private repositoryCache = new Map<
    string,
    { repository: any; timestamp: number }
  >(); // username -> {repository, timestamp}
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache TTL
  private readonly SESSION_TTL = 24 * 60 * 60 * 1000; // 24 hours session TTL
  // private readonly USER_MAPPING_TTL = 60 * 60 * 1000; // 1 hour user mapping TTL - Currently unused
  private lastCleanupTime = Date.now();

  constructor(
    private queueProducer: QueueProducer,
    private repoManager: GitHubRepositoryManager,
    private config: DispatcherConfig
  ) {
    this.startCachePrewarming();
  }

  /**
   * Get bot ID from configuration
   */
  private getBotId(): string {
    return this.config.slack.botId || "default-slack-bot";
  }

  /**
   * Get user environment variables from database with channel and repository precedence
   * Priority: Channel+Repo > Channel > User+Repo > User
   */
  async getUserEnvironment(
    userId: string,
    channelId?: string,
    repository?: string
  ): Promise<Record<string, string | undefined>> {
    const dbPool = getDbPool(process.env.DATABASE_URL!);
    const envVariables: Record<string, string | undefined> = {};

    try {
      // Get user ID from database
      const userResult = await dbPool.query(
        `SELECT id FROM users WHERE platform = 'slack' AND platform_user_id = $1`,
        [userId.toUpperCase()]
      );

      if (userResult.rows.length === 0) {
        logger.warn(`User ${userId} not found in database`);
        return envVariables;
      }

      const userDbId = userResult.rows[0].id;
      const isChannel = channelId && !channelId.startsWith("D");

      // Query with priority ordering
      const query = `
        WITH prioritized AS (
          SELECT 
            name, 
            value,
            channel_id,
            repository,
            -- Priority ranking
            CASE
              WHEN channel_id = $2 AND repository = $3 THEN 1
              WHEN channel_id = $2 AND repository IS NULL THEN 2
              WHEN channel_id IS NULL AND repository = $3 THEN 3
              WHEN channel_id IS NULL AND repository IS NULL THEN 4
            END as priority
          FROM user_environ
          WHERE user_id = $1
            AND (
              (channel_id = $2 AND repository = $3) OR
              (channel_id = $2 AND repository IS NULL) OR
              (channel_id IS NULL AND repository = $3) OR
              (channel_id IS NULL AND repository IS NULL)
            )
        )
        SELECT DISTINCT ON (name) name, value, channel_id, repository
        FROM prioritized
        ORDER BY name, priority`;

      const result = await dbPool.query(query, [
        userDbId,
        isChannel ? channelId : null,
        repository || null,
      ]);

      // Decrypt all values
      for (const row of result.rows) {
        if (row.value) {
          envVariables[row.name] = decrypt(row.value);
        }
      }

      if (result.rows.length > 0) {
        logger.info(
          `Found ${result.rows.length} environment variables for user ${userId}` +
            (channelId ? ` in channel ${channelId}` : "") +
            (repository ? ` for repository ${repository}` : "")
        );
      }

      // Log which repository is being used
      if (envVariables.GITHUB_REPOSITORY) {
        logger.info(`Using repository: ${envVariables.GITHUB_REPOSITORY}`);
      }
    } catch (error) {
      logger.error(`Error fetching environment for user ${userId}:`, error);
    }

    return envVariables;
  }

  /**
   * Handle user request by routing to appropriate queue
   */
  async handleUserRequest(
    context: SlackContext,
    userRequest: string,
    client: any
  ): Promise<void> {
    const requestStartTime = Date.now();
    logger.info(
      `[TIMING] handleUserRequest started at: ${new Date(requestStartTime).toISOString()}`
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
    const threadCreatorSessionKey = SessionUtils.generateSessionKey({
      platform: "slack",
      channelId: context.channelId,
      userId: context.userId,
      threadTs: normalizedThreadTs,
      messageTs: context.messageTs,
    });

    // Check for existing session to find thread creator
    let existingSession: ThreadSession | undefined;
    for (const [, session] of this.activeSessions.entries()) {
      if (
        session.threadTs === normalizedThreadTs &&
        session.channelId === context.channelId
      ) {
        existingSession = session;
        break;
      }
    }

    // Check if this is a reply from someone other than the thread creator
    if (
      existingSession?.threadCreator &&
      existingSession.threadCreator !== context.userId
    ) {
      logger.warn(
        `User ${context.userId} tried to interact with thread owned by ${existingSession.threadCreator}`
      );

      // Send ownership message
      await client.chat.postMessage({
        channel: context.channelId,
        thread_ts: normalizedThreadTs,
        text: `This thread is owned by <@${existingSession.threadCreator}>. Only the thread creator can interact with the bot in this conversation.`,
        mrkdwn: true,
      });

      return;
    }

    const sessionKey = threadCreatorSessionKey;

    logger.info(
      `Handling request for session: ${sessionKey} (threadTs: ${normalizedThreadTs})`
    );

    logger.info(
      `Existing session status for ${sessionKey}: ${existingSession?.status || "none"}`
    );

    try {
      // Get user's GitHub username mapping
      const username = await this.getOrCreateUserMapping(
        context.userId,
        client
      );

      // Check if this is a new session
      const isNewSession = !context.threadTs;

      // First get a preliminary check for repository without context
      const preliminaryEnv = await this.getUserEnvironment(
        context.userId,
        context.channelId,
        undefined // Don't pass repository yet as we need to determine it first
      );
      const overrideRepo = preliminaryEnv.GITHUB_REPOSITORY as
        | string
        | undefined;

      let repository;
      if (overrideRepo) {
        // User has overridden the repository URL
        const repoUrl = overrideRepo;
        const parts = repoUrl.split("/");
        const repoName = parts[parts.length - 1];

        repository = {
          repositoryUrl: repoUrl,
          repositoryName: repoName,
          cloneUrl: repoUrl.endsWith(".git") ? repoUrl : `${repoUrl}.git`,
          createdAt: Date.now(),
          lastUsed: Date.now(),
        };

        logger.info(`Using overridden repository for ${username}: ${repoUrl}`);
      } else {
        // Normal flow - check cache then fetch
        const cachedRepo = this.repositoryCache.get(username);
        if (cachedRepo && Date.now() - cachedRepo.timestamp < this.CACHE_TTL) {
          repository = cachedRepo.repository;
          logger.info(`Using cached repository for ${username}`);
        } else {
          repository = await this.repoManager.ensureUserRepository(username);
          this.repositoryCache.set(username, {
            repository,
            timestamp: Date.now(),
          });
        }
      }

      const threadTs = normalizedThreadTs;

      // Create thread session
      const threadSession: ThreadSession = {
        sessionKey,
        threadTs: threadTs,
        channelId: context.channelId,
        userId: context.userId,
        threadCreator: context.userId, // Store the thread creator
        username,
        repositoryUrl: repository?.repositoryUrl || "",
        lastActivity: Date.now(),
        status: "pending",
        createdAt: Date.now(),
      };

      this.activeSessions.set(sessionKey, threadSession);

      // Add immediate acknowledgment reaction
      const isDM = context.channelId?.startsWith("D");
      const isRootMessage = !context.threadTs;
      if (isDM || isRootMessage) {
        try {
          logger.info(
            `👀 REACTION CHANGE: Adding acknowledgment reaction 'eyes' to message ${context.messageTs} in channel ${context.channelId}`
          );
          await client.reactions.add({
            channel: context.channelId,
            timestamp: context.messageTs,
            name: "eyes",
          });
          logger.info(`Added eyes reaction to message ${context.messageTs}`);
        } catch (reactionError) {
          logger.warn("Failed to add eyes reaction:", reactionError);
        }
      }

      // Determine if this is a new conversation
      const isNewConversation = !context.threadTs || isNewSession;

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
            repositoryUrl: repository?.repositoryUrl || null,
            slackResponseChannel: context.channelId,
            slackResponseTs: context.messageTs,
            originalMessageTs: context.messageTs,
            botResponseTs: threadSession.botResponseTs,
          },
          claudeOptions: {
            allowedTools: this.config.claude.allowedTools,
            model: this.config.claude.model,
            timeoutMinutes: this.config.sessionTimeoutMinutes.toString(),
          },
          routingMetadata: {
            targetThreadId: threadTs,
            userId: context.userId,
          },
        };

        const jobId =
          await this.queueProducer.enqueueWorkerDeployment(deploymentPayload);

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
            repositoryUrl: repository?.repositoryUrl || null,
            slackResponseChannel: context.channelId,
            slackResponseTs: context.messageTs,
            originalMessageTs: context.messageTs,
            botResponseTs: threadSession.botResponseTs,
          },
          claudeOptions: {
            ...this.config.claude,
            timeoutMinutes: this.config.sessionTimeoutMinutes.toString(),
          },
          routingMetadata: {
            targetThreadId: threadTs,
            userId: context.userId,
          },
        };

        const jobId =
          await this.queueProducer.enqueueThreadMessage(threadPayload);

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
        await client.reactions.remove({
          channel: context.channelId,
          timestamp: context.messageTs,
          name: "eyes",
        });

        await client.reactions.add({
          channel: context.channelId,
          timestamp: context.messageTs,
          name: "x",
        });
      } catch (reactionError) {
        logger.error("Failed to update error reaction:", reactionError);
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
      this.activeSessions.delete(sessionKey);
    }
  }

  /**
   * Extract Slack context from event
   */
  extractSlackContext(event: any): SlackContext {
    return {
      channelId: event.channel,
      userId: event.user,
      teamId: event.team || "",
      threadTs: event.thread_ts,
      messageTs: event.ts,
      text: event.text || "",
      userDisplayName: event.user_profile?.display_name || "Unknown User",
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
   */
  isUserAllowed(userId: string): boolean {
    const allowedUsers = process.env.ALLOWED_USERS || "";
    if (!allowedUsers) {
      return true; // If no restrictions, allow all
    }

    const userList = allowedUsers.split(",").map((u) => u.trim());
    return userList.includes(userId);
  }

  /**
   * Get or create mapping between Slack user ID and GitHub username
   */
  async getOrCreateUserMapping(
    slackUserId: string,
    client: any
  ): Promise<string> {
    // Check cache first (with TTL)
    const cached = this.userMappings.get(slackUserId);
    if (cached) {
      return cached;
    }

    try {
      const userInfo = await client.users.info({ user: slackUserId });
      const userProfile = userInfo?.user?.profile;

      let username =
        userProfile?.display_name || userProfile?.real_name || slackUserId;
      username = username.toLowerCase().replace(/[^a-z0-9-]/g, "-");

      if (!username.match(/^[a-z0-9]/)) {
        username = `user-${username}`;
      }

      this.userMappings.set(slackUserId, username);
      logger.info(`Created user mapping: ${slackUserId} -> ${username}`);
      return username;
    } catch (error) {
      logger.error(`Failed to get user info for ${slackUserId}:`, error);
      const fallback = `user-${slackUserId.toLowerCase()}`;
      this.userMappings.set(slackUserId, fallback);
      return fallback;
    }
  }

  /**
   * Start cache prewarming
   */
  private startCachePrewarming(): void {
    setInterval(() => {
      this.cleanupExpiredData();
    }, 60000); // Every minute
  }

  /**
   * Cleanup expired data from caches
   */
  cleanupExpiredData(): void {
    const now = Date.now();

    // Only run cleanup every 5 minutes
    if (now - this.lastCleanupTime < 5 * 60 * 1000) {
      return;
    }

    this.lastCleanupTime = now;

    // Cleanup expired sessions
    for (const [key, session] of this.activeSessions.entries()) {
      if (now - session.lastActivity > this.SESSION_TTL) {
        logger.info(`Cleaning up expired session: ${key}`);
        this.activeSessions.delete(key);
      }
    }

    // Cleanup expired user mappings
    this.userMappings.clear();

    // Cleanup expired repository cache
    for (const [key, cached] of this.repositoryCache.entries()) {
      if (now - cached.timestamp > this.CACHE_TTL) {
        this.repositoryCache.delete(key);
      }
    }

    logger.info(
      `Cleanup completed - Active sessions: ${this.activeSessions.size}, User mappings: ${this.userMappings.size}, Repo cache: ${this.repositoryCache.size}`
    );
  }

  // Getters for accessing private state
  getActiveSessions(): Map<string, ThreadSession> {
    return this.activeSessions;
  }

  getUserMappings(): Map<string, string> {
    return this.userMappings;
  }

  getRepositoryCache(): Map<string, { repository: any; timestamp: number }> {
    return this.repositoryCache;
  }

  clearCacheForUser(username: string): void {
    this.repositoryCache.delete(username);
  }

  setShortcutCommandHandler(_handler: any): void {
    // Reference to ShortcutCommandHandler - currently not used
  }
}
