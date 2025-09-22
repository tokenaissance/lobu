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
   * Get user environment variables from database with channel precedence
   */
  async getUserEnvironment(
    userId: string,
    channelId?: string
  ): Promise<Record<string, string | undefined>> {
    const dbPool = getDbPool(process.env.DATABASE_URL!);
    const envVariables: Record<string, string | undefined> = {};

    try {
      // First check channel_environ if channelId is provided and not a DM
      if (channelId && !channelId.startsWith("D")) {
        const channelResult = await dbPool.query(
          `SELECT name, value FROM channel_environ WHERE channel_id = $1 AND platform = 'slack'`,
          [channelId]
        );

        for (const row of channelResult.rows) {
          // All environment variables MUST be encrypted in the database
          if (row.value) {
            envVariables[row.name] = decrypt(row.value);
          }
        }

        if (channelResult.rows.length > 0) {
          logger.info(
            `Found ${channelResult.rows.length} channel environment variables for channel ${channelId}`
          );
        }
      }

      // Then check user_environ to fill in any missing variables
      const userResult = await dbPool.query(
        `SELECT ue.name, ue.value 
         FROM user_environ ue
         JOIN users u ON ue.user_id = u.id
         WHERE u.platform = 'slack' AND u.platform_user_id = $1`,
        [userId.toUpperCase()]
      );

      for (const row of userResult.rows) {
        // Only set if not already set by channel_environ
        if (!(row.name in envVariables) && row.value) {
          // All environment variables MUST be encrypted in the database
          envVariables[row.name] = decrypt(row.value);
        }
      }

      if (userResult.rows.length > 0) {
        logger.info(
          `Found ${userResult.rows.length} user environment variables for user ${userId}`
        );
      }

      // Log which environment is being used
      if (envVariables.GITHUB_REPOSITORY) {
        const source =
          channelId &&
          !channelId.startsWith("D") &&
          (
            await dbPool.query(
              `SELECT 1 FROM channel_environ WHERE channel_id = $1 AND platform = 'slack' AND name = 'GITHUB_REPOSITORY'`,
              [channelId]
            )
          ).rows.length > 0
            ? "channel"
            : "user";
        logger.info(
          `Using ${source} repository override: ${envVariables.GITHUB_REPOSITORY}`
        );
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

    // Normalize threadTs BEFORE session key generation to ensure consistency
    const normalizedThreadTs = context.threadTs || context.messageTs;

    // Generate session key with normalized threadTs
    const sessionKey = SessionUtils.generateSessionKey({
      platform: "slack",
      channelId: context.channelId,
      userId: context.userId,
      threadTs: normalizedThreadTs,
      messageTs: context.messageTs,
    });

    logger.info(
      `Handling request for session: ${sessionKey} (threadTs: ${normalizedThreadTs})`
    );

    // Check if session is already active
    const existingSession = this.activeSessions.get(sessionKey);
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

      // Check for environment overrides from database
      const userEnv = await this.getUserEnvironment(
        context.userId,
        context.channelId
      );
      const overrideRepo = userEnv.GITHUB_REPOSITORY as string | undefined;

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
        username,
        repositoryUrl: repository.repositoryUrl,
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
          console.log(
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
            repositoryUrl: repository.repositoryUrl,
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
            repositoryUrl: repository.repositoryUrl,
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

      // Try to update reaction to error
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

      const errorMessage = `❌ *Error:* ${error instanceof Error ? error.message : "Unknown error occurred"}`;

      // Post error message in thread
      const threadTs = context.threadTs || context.messageTs;
      await client.chat.postMessage({
        channel: context.channelId,
        thread_ts: threadTs,
        text: errorMessage,
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
}
