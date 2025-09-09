#!/usr/bin/env bun

import { randomUUID } from "node:crypto";
import { SessionUtils } from "@peerbot/shared";
import type { App } from "@slack/bolt";
import type { GitHubRepositoryManager } from "../github/repository-manager";
import logger from "../logger";
import type {
  QueueProducer,
  ThreadMessagePayload,
  WorkerDeploymentPayload,
} from "../queue/task-queue-producer";
import type { DispatcherConfig, SlackContext, ThreadSession, UserRepository } from "../types";
import {
  setupFileHandlers,
  setupMessageHandlers,
  setupUserHandlers,
} from "./event-handlers";
import {
  handleBlockkitForm,
  handleExecutableCodeBlock,
  handleStopWorker,
} from "./event-handlers/block-actions";
import { handleBlockkitFormSubmission } from "./event-handlers/form-handlers";

/**
 * Queue-based Slack event handlers that replace direct Kubernetes job creation
 * Routes messages to appropriate queues based on conversation state
 */
export class SlackEventHandlers {
  private activeSessions = new Map<string, ThreadSession>();
  private userMappings = new Map<string, string>(); // slackUserId -> githubUsername
  private repositoryCache = new Map<
    string,
    { repository: any; timestamp: number }
  >(); // username -> {repository, timestamp}
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache TTL

  constructor(
    private app: App,
    private queueProducer: QueueProducer,
    private repoManager: GitHubRepositoryManager,
    private config: DispatcherConfig
  ) {
    this.setupEventHandlers();
    this.startCachePrewarming();
  }

  /**
   * Get bot ID from configuration
   */
  private getBotId(): string {
    return this.config.slack.botId || "default-slack-bot";
  }

  /**
   * Setup Slack event handlers
   */
  private setupEventHandlers(): void {
    logger.info("Setting up Queue-based Slack event handlers...");

    // Setup modular event handlers
    setupMessageHandlers(this.app);
    setupUserHandlers(this.app);
    setupFileHandlers(this.app);

    // Handle app mentions
    logger.info("Registering app_mention event handler");
    this.app.event("app_mention", async ({ event, client, say }) => {
      const handlerStartTime = Date.now();
      logger.info("=== APP_MENTION HANDLER TRIGGERED (QUEUE) ===");
      logger.info(
        `[TIMING] Handler triggered at: ${new Date(handlerStartTime).toISOString()}`
      );

      try {
        const context = this.extractSlackContext(event);

        if (!context.userId) {
          logger.error("No user ID found in app_mention event");
          await say({
            thread_ts: context.threadTs,
            text: "❌ Error: Unable to identify user. Please try again.",
          });
          return;
        }

        if (!this.isUserAllowed(context.userId)) {
          await say({
            thread_ts: context.threadTs,
            text: "Sorry, you don't have permission to use this bot.",
          });
          return;
        }

        const userRequest = this.extractUserRequest(context.text);

        // Log full user message details
        console.log(`📨 FULL USER MESSAGE:`, {
          userId: context.userId,
          userDisplayName: context.userDisplayName,
          channelId: context.channelId,
          messageTs: context.messageTs,
          threadTs: context.threadTs,
          originalText: context.text,
          extractedRequest: userRequest,
          timestamp: new Date().toISOString(),
        });

        await this.handleUserRequest(context, userRequest, client);
      } catch (error) {
        logger.error("Error handling app mention:", error);

        try {
          console.log(
            `🔴 REACTION CHANGE: Adding error reaction 'x' to message ${event.ts} in channel ${event.channel}`
          );
          await client.reactions.add({
            channel: event.channel,
            timestamp: event.ts,
            name: "x",
          });
          console.log(
            `✅ REACTION ADDED: 'x' successfully added to message ${event.ts}`
          );
        } catch (reactionError) {
          console.log(
            `❌ REACTION FAILED: Could not add 'x' reaction to message ${event.ts}:`,
            reactionError
          );
          logger.error("Failed to add error reaction:", reactionError);
        }

        await say({
          thread_ts: event.thread_ts,
          text: `❌ Error: ${error instanceof Error ? error.message : "Unknown error occurred"}`,
        });
      }
    });

    // Handle direct messages
    this.app.message(async ({ message, client, say }) => {
      logger.info("=== MESSAGE HANDLER TRIGGERED (QUEUE) ===");
      logger.debug(`Message type: ${(message as any).type}, subtype: ${(message as any).subtype}, channel: ${(message as any).channel}`);

      // Skip our own bot's messages
      const botUserId = this.config.slack.botUserId;
      const botId = this.config.slack.botId;
      if (
        (message as any).user === botUserId ||
        (message as any).bot_id === botId
      ) {
        logger.debug(`Skipping our own bot's message`);
        return;
      }

      // Skip ALL channel messages - only app_mention handles channel mentions
      // Use channel ID prefix to reliably detect channel vs DM (C* = channel, D* = DM)
      const channelId = (message as any).channel;
      if (channelId?.startsWith("C")) {
        logger.debug(
          `Skipping channel message in ${channelId} - only app_mention handles channels`
        );
        return;
      }

      const ignoredSubtypes = [
        "message_changed",
        "message_deleted",
        "thread_broadcast",
        "channel_join",
        "channel_leave",
        "assistant_app_thread",
      ];

      if (message.subtype && ignoredSubtypes.includes(message.subtype)) {
        logger.debug(`Ignoring message with subtype: ${message.subtype}`);
        return;
      }

      try {
        const context = this.extractSlackContext(message);

        if (!context.userId) {
          logger.error("No user ID found in message event");
          await say("❌ Error: Unable to identify user. Please try again.");
          return;
        }

        if (!this.isUserAllowed(context.userId)) {
          await say("Sorry, you don't have permission to use this bot.");
          return;
        }

        const userRequest = this.extractUserRequest(context.text);

        // Log full user message details
        console.log(`📨 FULL USER MESSAGE:`, {
          userId: context.userId,
          userDisplayName: context.userDisplayName,
          channelId: context.channelId,
          messageTs: context.messageTs,
          threadTs: context.threadTs,
          originalText: context.text,
          extractedRequest: userRequest,
          timestamp: new Date().toISOString(),
        });

        await this.handleUserRequest(context, userRequest, client);
      } catch (error) {
        logger.error("Error handling direct message:", error);
        await say(
          `❌ Error: ${error instanceof Error ? error.message : "Unknown error occurred"}`
        );
      }
    });

    // Handle view submissions (dialog/modal submissions)
    this.app.view(/.*/, async ({ ack, body, view, client }) => {
      logger.info("=== VIEW SUBMISSION HANDLER TRIGGERED (QUEUE) ===");
      await ack();

      try {
        const userId = body.user.id;
        
        // Handle repository modal submission
        if (view.callback_id === 'repository_modal') {
          await this.handleRepositoryModalSubmission(userId, view, client);
          return;
        }
        
        const metadata = view.private_metadata
          ? JSON.parse(view.private_metadata)
          : {};


        // Handle blockkit form modal submissions
        if (view.callback_id === "blockkit_form_modal") {
          await handleBlockkitFormSubmission(
            userId,
            view,
            client,
            this.handleUserRequest.bind(this)
          );
          return;
        }

        const channelId = metadata.channel_id;
        const threadTs = metadata.thread_ts;
        const userInput = this.extractViewInputs(view.state.values);

        if (channelId && threadTs) {
          const buttonText =
            metadata.button_text ||
            (metadata.action_id
              ? metadata.action_id.replace(/_/g, " ")
              : null) ||
            view.callback_id?.replace(/_/g, " ") ||
            "Form";

          const formattedInput = `> 📝 *Form submitted from "${buttonText}" button*\n\n${userInput}`;

          const inputMessage = await client.chat.postMessage({
            channel: channelId,
            thread_ts: threadTs,
            text: formattedInput,
            blocks: [
              {
                type: "context",
                elements: [
                  {
                    type: "mrkdwn",
                    text: `<@${userId}> submitted form`,
                  },
                ],
              },
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: userInput,
                },
              },
            ],
          });

          const context = {
            channelId,
            userId,
            userDisplayName: body.user.name || "Unknown User",
            teamId: body.team?.id || "",
            messageTs: inputMessage.ts as string,
            threadTs: threadTs,
            text: userInput,
          };

          await this.handleUserRequest(context, userInput, client);
        }
      } catch (error) {
        logger.error("Error handling view submission:", error);
      }
    });

    // Handle options requests for external selects
    this.app.options('repository_dropdown', async ({ body, options, ack }) => {
      try {
        const query = (options as any)?.value || '';
        const userId = (body as any)?.user?.id;
        
        // Get user's GitHub token
        const githubUser = await this.getUserGitHubInfo(userId);
        
        if (!githubUser.token) {
          await ack({
            options: []
          });
          return;
        }
        
        // Fetch user's repositories
        const repos = await this.repoManager.getUserRepositories(githubUser.token);
        
        // Filter repositories based on query
        const filteredRepos = repos
          .filter((repo: any) => 
            repo.full_name.toLowerCase().includes(query.toLowerCase()) ||
            repo.name.toLowerCase().includes(query.toLowerCase())
          )
          .slice(0, 100)
          .map((repo: any) => ({
            text: {
              type: "plain_text" as const,
              text: repo.full_name,
            },
            value: repo.clone_url,
          }));
        
        await ack({ options: filteredRepos });
      } catch (error) {
        logger.error('Error providing repository options:', error);
        await ack({ options: [] });
      }
    });

    // Handle interactive actions (button clicks, select menus, etc.)
    this.app.action(/.*/, async ({ action, ack, client, body }) => {
      logger.info("=== ACTION HANDLER TRIGGERED (QUEUE) ===");
      await ack();

      try {
        const actionId = (action as any).action_id;
        const userId = body.user.id;
        const channelId =
          (body as any).channel?.id || (body as any).container?.channel_id;
        const messageTs =
          (body as any).message?.ts || (body as any).container?.message_ts;

        if (!this.isUserAllowed(userId)) {
          await client.chat.postEphemeral({
            channel: channelId,
            user: userId,
            text: "Sorry, you don't have permission to use this action.",
          });
          return;
        }

        await this.handleBlockAction(
          actionId,
          userId,
          channelId,
          messageTs,
          body,
          client
        );
      } catch (error) {
        logger.error("Error handling action:", error);

        const userId = body.user.id;
        const channelId =
          (body as any).channel?.id || (body as any).container?.channel_id;

        await client.chat.postEphemeral({
          channel: channelId,
          user: userId,
          text: `❌ Error: ${error instanceof Error ? error.message : "Unknown error occurred"}`,
        });
      }
    });

    // Handle app home opened events
    this.app.event("app_home_opened", async ({ event, client }) => {
      logger.info("=== APP_HOME_OPENED HANDLER TRIGGERED (QUEUE) ===");

      try {
        if (event.tab === "home") {
          await this.updateAppHome(event.user, client);
        }
      } catch (error) {
        logger.error("Error handling app home opened:", error);
      }
    });
  }

  /**
   * Handle user request by routing to appropriate queue
   */
  private async handleUserRequest(
    context: SlackContext,
    userRequest: string,
    client: any
  ): Promise<void> {
    const requestStartTime = Date.now();
    logger.info(
      `[TIMING] handleUserRequest started at: ${new Date(requestStartTime).toISOString()}`
    );

    // Normalize threadTs BEFORE session key generation to ensure consistency
    // If this is not already a thread, use the current message timestamp as thread_ts
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

    // Check if session is already active - allow multiple messages, worker will queue them
    const existingSession = this.activeSessions.get(sessionKey);
    logger.info(
      `Existing session status for ${sessionKey}: ${existingSession?.status || "none"}`
    );

    // Don't block - let worker handle sequential processing

    try {
      // Get user's GitHub username mapping
      const username = await this.getOrCreateUserMapping(
        context.userId,
        client
      );

      // Generate unique Claude session ID for each message to ensure each gets its own bot response
      // Don't cache - each user message should create a new Claude session and bot message
      const existingClaudeSessionId = randomUUID();
      const isNewSession = true; // Always treat as new session
      logger.info(
        `Generated new Claude session ID ${existingClaudeSessionId} for message ${context.messageTs} in thread ${sessionKey}`
      );

      // Check repository cache first
      let repository;
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

      // Use the normalized threadTs
      const threadTs = normalizedThreadTs;

      // Create thread session
      const threadSession: ThreadSession = {
        sessionKey,
        threadTs: threadTs,
        channelId: context.channelId,
        userId: context.userId,
        username,
        repositoryUrl: repository.repositoryUrl,
        agentSessionId: existingClaudeSessionId,
        lastActivity: Date.now(),
        status: "pending",
        createdAt: Date.now(),
      };

      this.activeSessions.set(sessionKey, threadSession);

      // Add immediate acknowledgment reaction
      try {
        console.log(
          `👀 REACTION CHANGE: Adding acknowledgment reaction 'eyes' to message ${context.messageTs} in channel ${context.channelId} (user: ${context.userId})`
        );
        await client.reactions.add({
          channel: context.channelId,
          timestamp: context.messageTs,
          name: "eyes",
        });
        console.log(
          `✅ REACTION ADDED: 'eyes' successfully added to message ${context.messageTs} - bot is processing request`
        );
        logger.info(`Added eyes reaction to message ${context.messageTs}`);
      } catch (reactionError) {
        console.log(
          `❌ REACTION FAILED: Could not add 'eyes' reaction to message ${context.messageTs}:`,
          reactionError
        );
        logger.warn("Failed to add eyes reaction:", reactionError);
      }

      // Determine if this is a new conversation or continuation
      // For the first message in any thread (including DMs), always create new session
      const isNewConversation = !context.threadTs || isNewSession;

      if (isNewConversation) {
        const deploymentPayload: WorkerDeploymentPayload = {
          userId: context.userId,
          botId: this.getBotId(),
          agentSessionId: existingClaudeSessionId || sessionKey,
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
            slackResponseTs: context.messageTs, // Use actual message timestamp for unique bot response
            originalMessageTs: context.messageTs,
            botResponseTs: threadSession.botResponseTs, // Track bot's response for updates
          },
          claudeOptions: {
            allowedTools: this.config.claude.allowedTools,
            model: this.config.claude.model,
            timeoutMinutes: this.config.sessionTimeoutMinutes.toString(),
            // Always use sessionId to create new sessions - disable resume functionality
            sessionId: existingClaudeSessionId,
          },
        };

        const jobId =
          await this.queueProducer.enqueueWorkerDeployment(deploymentPayload);

        logger.info(
          `Enqueued direct message job ${jobId} for session ${sessionKey}`
        );
        threadSession.status = "pending";
      } else {
        // Enqueue to user-specific queue (worker should already exist)
        const threadPayload: ThreadMessagePayload = {
          botId: this.getBotId(),
          userId: context.userId,
          threadId: threadTs,
          platform: "slack",
          channelId: context.channelId,
          messageId: context.messageTs,
          messageText: userRequest,
          agentSessionId: existingClaudeSessionId,
          platformMetadata: {
            teamId: context.teamId,
            userDisplayName: context.userDisplayName,
            repositoryUrl: repository.repositoryUrl,
            slackResponseChannel: context.channelId,
            slackResponseTs: context.messageTs, // Use actual message timestamp for unique bot response
            originalMessageTs: context.messageTs,
            botResponseTs: threadSession.botResponseTs, // Track bot's response for updates
          },
          claudeOptions: {
            ...this.config.claude,
            timeoutMinutes: this.config.sessionTimeoutMinutes.toString(),
            // Always use sessionId to create new sessions - disable resume functionality
            sessionId: existingClaudeSessionId,
          },
          // Add routing metadata for thread-specific processing
          routingMetadata: {
            targetThreadId: threadTs,
            agentSessionId: existingClaudeSessionId || sessionKey,
            userId: context.userId,
          },
        };

        const jobId =
          await this.queueProducer.enqueueThreadMessage(threadPayload);

        logger.info(
          `Enqueued thread message job ${jobId} for continuing session ${existingClaudeSessionId}`
        );
        threadSession.status = "running"; // Mark as running since worker is processing
      }
    } catch (error) {
      logger.error(
        `Failed to handle request for session ${sessionKey}:`,
        error
      );

      // Try to update reaction to error
      try {
        console.log(
          `🔄 REACTION CHANGE: Removing 'eyes' reaction from message ${context.messageTs} due to error`
        );
        await client.reactions.remove({
          channel: context.channelId,
          timestamp: context.messageTs,
          name: "eyes",
        });
        console.log(
          `✅ REACTION REMOVED: 'eyes' removed from message ${context.messageTs}`
        );

        console.log(
          `🔴 REACTION CHANGE: Adding error reaction 'x' to message ${context.messageTs}`
        );
        await client.reactions.add({
          channel: context.channelId,
          timestamp: context.messageTs,
          name: "x",
        });
        console.log(
          `✅ REACTION ADDED: 'x' successfully added to message ${context.messageTs} - indicating error`
        );
      } catch (reactionError) {
        console.log(
          `❌ REACTION FAILED: Could not update reactions on message ${context.messageTs}:`,
          reactionError
        );
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
  private extractSlackContext(event: any): SlackContext {
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
  private extractUserRequest(text: string): string {
    const cleaned = text.replace(/<@[^>]+>/g, "").trim();

    if (!cleaned) {
      return "Hello! How can I help you today?";
    }

    return cleaned;
  }

  /**
   * Check if user is allowed to use the bot
   */
  private isUserAllowed(userId: string): boolean {
    const { allowedUsers, blockedUsers } = this.config.slack;

    if (blockedUsers?.includes(userId)) {
      return false;
    }

    if (allowedUsers && allowedUsers.length > 0) {
      return allowedUsers.includes(userId);
    }

    return true;
  }

  private async getOrCreateUserMapping(
    slackUserId: string,
    client: any
  ): Promise<string> {
    const existingMapping = this.userMappings.get(slackUserId);
    if (existingMapping) {
      return existingMapping;
    }

    try {
      const userInfo = await client.users.info({ user: slackUserId });
      const user = userInfo.user;

      let username =
        user.profile?.display_name || user.profile?.real_name || user.name;
      username = username
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");

      username = `user-${username}`;
      this.userMappings.set(slackUserId, username);

      logger.info(`Created user mapping: ${slackUserId} -> ${username}`);
      return username;
    } catch (error) {
      logger.error(`Failed to get user info for ${slackUserId}:`, error);
      const fallbackUsername = slackUserId
        ? `user-${slackUserId.substring(0, 8)}`
        : "user-unknown";
      if (slackUserId) {
        this.userMappings.set(slackUserId, fallbackUsername);
      }
      return fallbackUsername;
    }
  }

  private startCachePrewarming(): void {
    setInterval(() => {
      const now = Date.now();
      for (const [username, cached] of this.repositoryCache.entries()) {
        if (now - cached.timestamp > this.CACHE_TTL) {
          this.repositoryCache.delete(username);
          logger.info(`Evicted stale repository cache for ${username}`);
        }
      }
    }, 60000);
  }

  private async handleGitHubPullRequestAction(
    actionId: string,
    userId: string,
    channelId: string,
    messageTs: string,
    body: any,
    client: any
  ): Promise<void> {
    logger.info(`Handling GitHub PR action: ${actionId}`);
    
    try {
      // Extract the PR details from the button's value
      const action = (body as any).actions?.[0];
      if (!action?.value) {
        throw new Error("No PR data found in button");
      }

      const prData = JSON.parse(action.value);
      const { prompt } = prData;
      
      // Create a context for the user request
      const context: SlackContext = {
        channelId,
        userId,
        userDisplayName: "Unknown User", // Will be fetched if needed
        teamId: body.team?.id || "",
        messageTs,
        threadTs: messageTs,
        text: prompt || "Cleanup and create a pull request for me",
      };
      
      // Post the PR request as a user message to show intent
      const formattedInput = prompt || "Cleanup and create a pull request for me";
      
      const inputMessage = await client.chat.postMessage({
        channel: channelId,
        thread_ts: messageTs,
        text: formattedInput,
        blocks: [
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: `<@${userId}> clicked "🔀 Pull Request" button`,
              },
            ],
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: formattedInput,
            },
          },
        ],
      });
      
      // Update the context with the new message timestamp
      context.messageTs = inputMessage.ts as string;
      
      // Handle the PR creation request
      await this.handleUserRequest(context, formattedInput, client);
      
    } catch (error) {
      logger.error(`Failed to handle GitHub PR action ${actionId}:`, error);
      
      await client.chat.postEphemeral({
        channel: channelId,
        user: userId,
        text: `❌ Failed to create pull request: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    }
  }

  private async handleBlockAction(
    actionId: string,
    userId: string,
    channelId: string,
    messageTs: string,
    body: any,
    client: any
  ): Promise<void> {
    logger.info(`Handling block action: ${actionId}`);

    switch (actionId) {
      case "github_login":
        await this.handleGitHubLogin(userId, client);
        break;

      case "github_logout":
        await this.handleGitHubLogout(userId, client);
        break;

      case "open_repository_modal":
        await this.openRepositoryModal(userId, body, client);
        break;

      case "select_repository":
        await this.handleRepositorySelection(userId, body, client);
        break;

      default:
        // Handle blockkit form button clicks
        if (actionId.startsWith("blockkit_form_")) {
          await handleBlockkitForm(
            actionId,
            userId,
            channelId,
            messageTs,
            body,
            client
          );
        }
        // Handle executable code block buttons (bash, python, etc.)
        else if (
          actionId.match(/^(bash|python|javascript|js|typescript|ts|sql|sh)_/)
        ) {
          await handleExecutableCodeBlock(
            actionId,
            userId,
            channelId,
            messageTs,
            body,
            client,
            this.handleUserRequest.bind(this)
          );
        }
        // Handle stop worker button clicks
        else if (actionId.startsWith("stop_worker_")) {
          const deploymentName = actionId.replace("stop_worker_", "");
          await handleStopWorker(
            deploymentName,
            userId,
            channelId,
            messageTs,
            client
          );
        }
        // Handle GitHub Pull Request button clicks
        else if (actionId.startsWith("github_pr_")) {
          await this.handleGitHubPullRequestAction(
            actionId,
            userId,
            channelId,
            messageTs,
            body,
            client
          );
        }
        // Handle GitHub Code button clicks (no action needed, just log)
        else if (actionId.startsWith("github_code_")) {
          logger.info(
            `GitHub Code button clicked: ${actionId} by user ${userId}`
          );
          // URL buttons handle navigation automatically, no additional action needed
        } else {
          // Log unsupported actions but don't send messages to users
          logger.info(
            `Unsupported action: ${actionId} from user ${userId} in channel ${channelId}`
          );
          // Silently acknowledge - no user notification needed
        }
    }
  }

  private async updateAppHome(userId: string, client: any): Promise<void> {
    logger.info(
      `Updating app home for user: ${userId} with README from active repository`
    );

    try {
      const username = await this.getOrCreateUserMapping(userId, client);
      
      // Check if user has GitHub token
      const githubUser = await this.getUserGitHubInfo(userId);
      const isGitHubConnected = !!githubUser.token;
      
      let repository;
      
      // Initialize readme section as null
      let readmeSection: string | null = null;
      
      // Try to get or create repository
      try {
        // First, try to get existing repository from cache (pass Slack user ID for database lookup)
        repository = await this.repoManager.getUserRepository(username, userId);
        
        // If no cached repository and we have a token, create one
        if (!repository && (this.config.github.token || isGitHubConnected)) {
          repository = await this.repoManager.ensureUserRepository(username);
        }
        
        // Fetch README.md content if we have a repository
        if (repository) {
          const readmeContent = await this.fetchRepositoryReadme(
            repository.repositoryUrl
          );
          if (readmeContent) {
            readmeSection = `*📖 README :*\n\`\`\`\n${readmeContent.slice(0, 500)}${readmeContent.length > 500 ? '...' : ''}\n\`\`\``;
          }
        }
      } catch (error) {
        logger.warn(`Could not get/ensure repository for user ${username}:`, error);
        // Continue without repository - user can login with GitHub
      }

      const blocks: any[] = [
        {
          type: "section",
          text: { type: "mrkdwn", text: "*Welcome to Peerbot!* 👋" },
        },
        {
          type: "divider",
        },
      ];

      // GitHub connection section
      if (isGitHubConnected) {
        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*GitHub Connected:* ✅ @${githubUser.username || 'Connected'}`,
          },
          accessory: {
            type: "button",
            text: {
              type: "plain_text",
              text: "Logout",
            },
            action_id: "github_logout",
            style: "danger",
            confirm: {
              title: {
                type: "plain_text",
                text: "Disconnect GitHub?",
              },
              text: {
                type: "mrkdwn",
                text: "Are you sure you want to disconnect your GitHub account?",
              },
              confirm: {
                type: "plain_text",
                text: "Yes, disconnect",
              },
              deny: {
                type: "plain_text",
                text: "Cancel",
              },
            },
          },
        });

        // Repository selector button that opens modal
        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: repository ? `*Current Repository:* <${repository.repositoryUrl}|${repository.repositoryName}>` : "*Repository Settings:*",
          },
          accessory: {
            type: "button",
            text: {
              type: "plain_text",
              text: "Change Repository",
            },
            action_id: "open_repository_modal",
          },
        });
      } else {
        // Show login button if GitHub OAuth is configured
        if (this.config.github.clientId) {
          // Use INGRESS_URL if provided, otherwise use default dispatcher URL
          const oauthBaseUrl = this.config.github.ingressUrl || 
            (process.env.NODE_ENV === 'development' ? 'http://localhost:8080' : 'http://dispatcher:8080');
          
          blocks.push({
            type: "section",
            text: {
              type: "mrkdwn",
              text: "*GitHub:* Not connected",
            },
            accessory: {
              type: "button",
              text: {
                type: "plain_text",
                text: "Login with GitHub",
              },
              action_id: "github_login",
              style: "primary",
              url: `${oauthBaseUrl}/api/github/oauth/authorize?user_id=${userId}`,
            },
          });
        }
      }
      
      // Add "How I Work" instructions
      blocks.push(
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*📚 How I Work:*
• Each conversation gets its sandbox environment
• I commit my work automatically as I go
• You can review the generated app and the code anytime
• Once your fix/feature is complete, you can create Pull Request for engineering review`,
          },
        },
        {
          type: "divider",
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "💬 *Get Started:*\nSend me a message or mention me in a channel to start coding together!",
          },
        }
      );

      blocks.push(
        {
          type: "divider",
        }
      );
      
      // Add README section if we have one
      if (readmeSection) {
        blocks.push(
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: readmeSection,
            },
          },
          {
            type: "divider",
          }
        );
      }
      
      const homeView = {
        type: "home",
        blocks: blocks,
      };
      

      await client.views.publish({ user_id: userId, view: homeView });
    } catch (error) {
      logger.error(`Error updating app home for user ${userId}:`, error);

      // Fallback home view if repository lookup fails
      const fallbackHomeView = {
        type: "home",
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: "*Welcome to Peerbot!* 👋" },
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "💬 Send me a message or mention me in a channel to start coding together!",
            },
          },
        ],
      };

      await client.views.publish({ user_id: userId, view: fallbackHomeView });
    }
  }

  /**
   * Handle GitHub login
   */
  private async handleGitHubLogin(userId: string, client: any): Promise<void> {
    try {
      // Generate OAuth URL with user ID
      const baseUrl = process.env.INGRESS_URL || 'http://localhost:8080';
      const authUrl = `${baseUrl}/api/github/oauth/authorize?user_id=${userId}`;
      
      // Send ephemeral message with link
      const im = await client.conversations.open({ users: userId });
      const channelId = im.channel.id;
      await client.chat.postMessage({
        channel: channelId,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "Click the link below to connect your GitHub account:"
            }
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `<${authUrl}|🔗 Connect with GitHub>`
            }
          },
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: "This will open in your browser. You'll be redirected to GitHub to authorize access."
              }
            ]
          }
        ],
        text: `Connect with GitHub: ${authUrl}`
      });
    } catch (error) {
      logger.error(`Failed to initiate GitHub login for user ${userId}:`, error);
      try {
        const im = await client.conversations.open({ users: userId });
        await client.chat.postMessage({ channel: im.channel.id, text: "❌ Failed to start GitHub login. Please try again." });
      } catch {}
    }
  }

  /**
   * Handle GitHub logout
   */
  private async handleGitHubLogout(userId: string, client: any): Promise<void> {
    try {
      // Remove GitHub token from database
      const { getDbPool } = await import('../db');
      const dbPool = getDbPool(process.env.DATABASE_URL || this.config.queues.connectionString);

      await dbPool.query(
        `DELETE FROM user_environ 
         WHERE user_id = (SELECT id FROM users WHERE platform = 'slack' AND platform_user_id = $1)
         AND name IN ('GITHUB_TOKEN', 'GITHUB_USER')`,
        [userId.toUpperCase()]
      );

      // Refresh home tab
      await this.updateAppHome(userId, client);

      // Send confirmation
      try {
        const im = await client.conversations.open({ users: userId });
        await client.chat.postMessage({ channel: im.channel.id, text: "✅ Successfully disconnected from GitHub" });
      } catch {}
    } catch (error) {
      logger.error(`Failed to logout user ${userId}:`, error);
      try {
        const im = await client.conversations.open({ users: userId });
        await client.chat.postMessage({ channel: im.channel.id, text: "❌ Failed to disconnect from GitHub. Please try again." });
      } catch {}
    }
  }

  /**
   * Handle repository modal submission
   */
  private async handleRepositoryModalSubmission(userId: string, view: any, client: any): Promise<void> {
    try {
      const values = view.state.values;
      
      // Get the repository URL from input or dropdown
      let selectedRepo = values.repository_input?.repository_url?.value;
      
      // If no manual input, check the dropdown selection
      if (!selectedRepo && values.repository_select?.repository_dropdown?.selected_option) {
        selectedRepo = values.repository_select.repository_dropdown.selected_option.value;
      }
      
      if (!selectedRepo) {
        // Send error message if neither field was filled
        const im = await client.conversations.open({ users: userId });
        await client.chat.postMessage({ channel: im.channel.id, text: "❌ Please enter a repository URL or select from the dropdown" });
        return;
      }

      const username = await this.getOrCreateUserMapping(userId, client);

      // Clean up the repository URL
      selectedRepo = selectedRepo.trim();
      if (!selectedRepo.startsWith('http')) {
        selectedRepo = `https://github.com/${selectedRepo}`;
      }

      // Update the repository cache with the selected repository
      const repoName = selectedRepo.split('/').pop()?.replace('.git', '') || 'unknown';
      const repository: UserRepository = {
        username,
        repositoryName: repoName,
        repositoryUrl: selectedRepo.replace('.git', ''),
        cloneUrl: selectedRepo.endsWith('.git') ? selectedRepo : `${selectedRepo}.git`,
        createdAt: Date.now(),
        lastUsed: Date.now(),
      };

      this.repositoryCache.set(username, {
        repository,
        timestamp: Date.now(),
      });

      // Persist selection
      await this.saveSelectedRepository(userId, repository.repositoryUrl);

      // Refresh home tab and confirm via DM
      await this.updateAppHome(userId, client);
      const im2 = await client.conversations.open({ users: userId });
      await client.chat.postMessage({ channel: im2.channel.id, text: `✅ Repository updated to: ${repository.repositoryUrl}` });
    } catch (error) {
      logger.error(`Failed to handle repository modal submission for user ${userId}:`, error);
    }
  }

  /**
   * Open repository selection modal
   */
  private async openRepositoryModal(userId: string, body: any, client: any): Promise<void> {
    try {
      // Get user's GitHub info to pre-populate suggestions
      const githubUser = await this.getUserGitHubInfo(userId);
      
      // Create modal view
      const modalView = {
        type: "modal",
        callback_id: "repository_modal",
        title: {
          type: "plain_text",
          text: "Select Repository",
        },
        submit: {
          type: "plain_text",
          text: "Save",
        },
        close: {
          type: "plain_text",
          text: "Cancel",
        },
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "Enter a GitHub repository URL or select from your repositories:",
            },
          },
          {
            type: "input",
            block_id: "repository_input",
            label: {
              type: "plain_text",
              text: "Repository URL",
            },
            element: {
              type: "plain_text_input",
              action_id: "repository_url",
              placeholder: {
                type: "plain_text",
                text: "https://github.com/owner/repo",
              },
            },
            hint: {
              type: "plain_text",
              text: "Enter the full GitHub repository URL",
            },
            optional: true,
          },
        ],
      };

      // Add external select if user is logged in with GitHub
      if (githubUser.token) {
        modalView.blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: "Or select from your repositories:",
          },
        } as any);
        
        modalView.blocks.push({
          type: "input",
          block_id: "repository_select",
          label: {
            type: "plain_text",
            text: "Your Repositories",
          },
          element: {
            type: "external_select",
            action_id: "repository_dropdown",
            placeholder: {
              type: "plain_text",
              text: "Type to search repositories...",
            },
            min_query_length: 0, // Show all repos immediately
          },
          optional: true,
        } as any);
      }

      // Open the modal
      await client.views.open({
        trigger_id: body.trigger_id,
        view: modalView,
      });
    } catch (error) {
      logger.error(`Failed to open repository modal for user ${userId}:`, error);
    }
  }

  /**
   * Handle repository selection
   */
  private async handleRepositorySelection(userId: string, body: any, client: any): Promise<void> {
    try {
      const selectedRepo = body.actions?.[0]?.selected_option?.value;
      if (!selectedRepo) {
        return;
      }

      const username = await this.getOrCreateUserMapping(userId, client);

      // Update the repository cache with the selected repository
      const repoName = selectedRepo.split('/').pop()?.replace('.git', '') || 'unknown';
      const repository: UserRepository = {
        username,
        repositoryName: repoName,
        repositoryUrl: selectedRepo.replace('.git', '').replace('https://github.com/', 'https://github.com/'),
        cloneUrl: selectedRepo,
        createdAt: Date.now(),
        lastUsed: Date.now(),
      };

      this.repositoryCache.set(username, {
        repository,
        timestamp: Date.now(),
      });

      // Persist selection
      await this.saveSelectedRepository(userId, repository.repositoryUrl);

      // Send confirmation
      const im = await client.conversations.open({ users: userId });
      await client.chat.postMessage({ channel: im.channel.id, text: `✅ Repository set to: ${repoName}` });
    } catch (error) {
      logger.error(`Failed to select repository for user ${userId}:`, error);
      try {
        const im = await client.conversations.open({ users: userId });
        await client.chat.postMessage({ channel: im.channel.id, text: "❌ Failed to select repository. Please try again." });
      } catch {}
    }
  }

  /**
   * Get user's GitHub info from database
   */
  private async getUserGitHubInfo(userId: string): Promise<{ token?: string; username?: string }> {
    try {
      // Import Pool type and create connection
      const { getDbPool } = await import('../db');
      const dbPool = getDbPool(process.env.DATABASE_URL || this.config.queues.connectionString);

      const result = await dbPool.query(
        `SELECT name, value FROM user_environ
         WHERE user_id = (
           SELECT id FROM users
           WHERE platform = 'slack' AND platform_user_id = $1
         )
         AND name IN ('GITHUB_TOKEN', 'GITHUB_USER')`,
        [userId.toUpperCase()]
      );

      const info: { token?: string; username?: string } = {};
      for (const row of result.rows) {
        if (row.name === 'GITHUB_TOKEN') {
          try {
            info.token = this.decryptValue(row.value as string);
          } catch (e) {
            logger.warn('Failed to decrypt stored GitHub token');
          }
        } else if (row.name === 'GITHUB_USER') {
          info.username = row.value;
        }
      }

      return info;
    } catch (error) {
      logger.error(`Failed to get GitHub info for user ${userId}:`, error);
      return {};
    }
  }

  private decryptValue(payload: string): string {
    const crypto = require('node:crypto');
    const key: string = (process.env.ENCRYPTION_KEY || 'default-32-char-encryption-key!!').padEnd(32).slice(0, 32);
    const parts = payload.split(':');
    if (parts.length !== 3) throw new Error('Invalid encrypted payload');
    const iv = Buffer.from(parts[0]!, 'hex');
    const tag = Buffer.from(parts[1]!, 'hex');
    const data = Buffer.from(parts[2]!, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(key, 'utf8'), iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return decrypted.toString('utf8');
  }

  /**
   * Persist selected repository for a Slack user
   */
  private async saveSelectedRepository(userId: string, repoUrl: string): Promise<void> {
    const { getDbPool } = await import('../db');
    const dbPool = getDbPool(process.env.DATABASE_URL || this.config.queues.connectionString);

    await dbPool.query(
      `INSERT INTO users (platform, platform_user_id) 
       VALUES ('slack', $1) 
       ON CONFLICT (platform, platform_user_id) DO NOTHING`,
      [userId.toUpperCase()]
    );

    const userResult = await dbPool.query(
      `SELECT id FROM users WHERE platform = 'slack' AND platform_user_id = $1`,
      [userId.toUpperCase()]
    );

    if (userResult.rows.length > 0) {
      const userDbId = userResult.rows[0].id;
      await dbPool.query(
        `INSERT INTO user_environ (user_id, name, value, type) 
         VALUES ($1, 'SELECTED_REPOSITORY', $2, 'system') 
         ON CONFLICT (user_id, name) 
         DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [userDbId, repoUrl]
      );
    }
  }

  /**
   * Fetch README content from a repository URL
   */
  private async fetchRepositoryReadme(
    repositoryUrl: string
  ): Promise<string | null> {
    try {
      // Extract owner and repo name from GitHub URL
      // Updated regex to handle dots in repo names properly
      const match = repositoryUrl.match(
        /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/
      );
      if (!match || !match[1] || !match[2]) {
        logger.warn(`Could not parse repository URL: ${repositoryUrl}`);
        return null;
      }

      const owner = match[1];
      const repo = match[2];

      return await this.repoManager.fetchReadmeContent(owner, repo);
    } catch (error) {
      logger.error(
        `Failed to fetch README for repository ${repositoryUrl}:`,
        error
      );
      return null;
    }
  }


  private extractViewInputs(stateValues: any): string {
    // This method was kept for backward compatibility but could be moved to form-handlers
    const inputs: string[] = [];
    for (const [blockId, block] of Object.entries(stateValues || {})) {
      for (const [actionId, action] of Object.entries(block as any)) {
        let value = "";

        // Handle different types of Slack form inputs
        if ((action as any).value) {
          value = (action as any).value;
        } else if ((action as any).selected_option?.value) {
          value = (action as any).selected_option.value;
        }

        if (value?.toString().trim()) {
          const label = actionId || blockId;
          const readableLabel = label
            .replace(/[_-]/g, " ")
            .replace(/([a-z])([A-Z])/g, "$1 $2")
            .split(" ")
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
            .join(" ");

          inputs.push(`*${readableLabel}:* ${value}`);
        }
      }
    }

    return inputs.join("\n");
  }

  /**
   * Get user mappings (for thread response consumer)
   */
  getUserMappings(): Map<string, string> {
    return this.userMappings;
  }

  /**
   * Cleanup all sessions
   */
  async cleanup(): Promise<void> {
    this.activeSessions.clear();
    this.userMappings.clear();
    this.repositoryCache.clear();
  }
}
