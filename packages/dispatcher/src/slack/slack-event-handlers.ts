#!/usr/bin/env bun

import type { App } from "@slack/bolt";
import { createLogger } from "@peerbot/shared";

const logger = createLogger("slack-events");
import type { GitHubRepositoryManager } from "../github/repository-manager";
import type { QueueProducer } from "../queue/task-queue-producer";
import type { DispatcherConfig } from "../types";
import {
  setupFileHandlers,
  setupMessageHandlers,
  setupUserHandlers,
} from "./event-handlers";
import { handleBlockkitFormSubmission } from "./event-handlers/form-handlers";
import { setupTeamJoinHandler } from "./handlers/welcome-handler";
import { MessageHandler } from "./handlers/message-handler";
import { ActionHandler } from "./handlers/action-handler";
import { ShortcutCommandHandler } from "./handlers/shortcut-command-handler";
import { getUserGitHubInfo } from "./handlers/github-handler";

/**
 * Queue-based Slack event handlers that route messages to appropriate queues
 * This is the main orchestrator that delegates to specialized handlers
 */
export class SlackEventHandlers {
  private messageHandler: MessageHandler;
  private actionHandler: ActionHandler;
  private shortcutCommandHandler: ShortcutCommandHandler;

  constructor(
    private app: App,
    queueProducer: QueueProducer,
    repoManager: GitHubRepositoryManager,
    private config: DispatcherConfig
  ) {
    // Initialize specialized handlers
    this.messageHandler = new MessageHandler(
      queueProducer,
      repoManager,
      config
    );
    this.actionHandler = new ActionHandler(
      repoManager,
      queueProducer,
      config,
      this.messageHandler
    );
    this.shortcutCommandHandler = new ShortcutCommandHandler(
      app,
      config,
      this.messageHandler,
      this.actionHandler
    );

    // Set the ShortcutCommandHandler reference in MessageHandler so it can use sendContextAwareWelcome
    this.messageHandler.setShortcutCommandHandler(this.shortcutCommandHandler);

    // Setup all event handlers
    this.setupEventHandlers();
    // Setup options handlers for dropdowns/selects
    this.setupOptionsHandlers();
  }

  /**
   * Setup options handlers for external selects
   */
  private setupOptionsHandlers(): void {
    logger.info("Setting up options handlers for external selects");

    // Handle repository search
    this.app.options("existing_repo_select", async ({ options, ack, body }) => {
      // Handle both initial load and search
      const query = options?.value || "";
      const userId = body.user?.id;

      logger.info(
        `Repository search triggered - query: "${query}", user: ${userId}`
      );

      try {
        // Get user's GitHub token
        logger.info(`Fetching GitHub info for user ${userId}`);
        const githubUser = await getUserGitHubInfo(userId);
        logger.info(
          `GitHub user info retrieved: token=${!!githubUser.token}, username=${githubUser.username}`
        );

        if (!githubUser.token) {
          // No token = no suggestions
          logger.info(`No GitHub token found for user ${userId}`);
          await ack({ options: [] });
          return;
        }

        // Search both user repos and org repos in parallel
        const [userRepos, orgRepos] = await Promise.all([
          this.searchUserRepos(query, githubUser.token),
          this.searchOrgRepos(query, githubUser.token),
        ]);

        logger.info(
          `Found ${userRepos.length} user repos, ${orgRepos.length} org repos`
        );

        // Combine and deduplicate
        const allRepos = [...userRepos, ...orgRepos];
        const uniqueRepos = Array.from(
          new Map(allRepos.map((repo) => [repo.html_url, repo])).values()
        );

        // Format for Slack (limit to 100)
        const options = uniqueRepos.slice(0, 100).map((repo) => ({
          text: {
            type: "plain_text" as const,
            text: repo.full_name, // Shows "owner/repo"
          },
          value: repo.html_url,
        }));

        logger.info(`Returning ${options.length} repository options`);
        await ack({ options });
      } catch (error) {
        // Log error but still return empty options
        logger.error("Error in repository search handler:", error);
        await ack({ options: [] });
      }
    });
  }

  /**
   * Search user's accessible repositories
   */
  private async searchUserRepos(query: string, token: string): Promise<any[]> {
    try {
      let url: string;

      if (query) {
        // Search user's repos with query
        url = `https://api.github.com/user/repos?per_page=100&sort=updated`;
      } else {
        // Get recent repos if no query
        url = `https://api.github.com/user/repos?per_page=20&sort=updated`;
      }

      const response = await fetch(url, {
        headers: {
          Authorization: `token ${token}`,
          Accept: "application/vnd.github.v3+json",
        },
      });

      if (!response.ok) {
        logger.warn(
          `GitHub API error for user repos: ${response.status} ${response.statusText}`
        );
        return [];
      }

      const repos = (await response.json()) as any;

      // Filter by query if provided
      if (query) {
        const lowerQuery = query.toLowerCase();
        return repos.filter(
          (repo: any) =>
            repo.name.toLowerCase().includes(lowerQuery) ||
            repo.full_name.toLowerCase().includes(lowerQuery)
        );
      }

      return repos;
    } catch {
      return [];
    }
  }

  /**
   * Search organization repositories
   */
  private async searchOrgRepos(query: string, token: string): Promise<any[]> {
    const org = process.env.GITHUB_ORGANIZATION;

    if (!org) return [];

    try {
      // Get organization repos
      const response = await fetch(
        `https://api.github.com/orgs/${org}/repos?per_page=100&sort=updated`,
        {
          headers: {
            Authorization: `token ${token}`,
            Accept: "application/vnd.github.v3+json",
          },
        }
      );

      if (!response.ok) {
        logger.warn(
          `GitHub API error for org repos: ${response.status} ${response.statusText}`
        );
        return [];
      }

      const repos = (await response.json()) as any;

      // Filter by query if provided
      if (query) {
        const lowerQuery = query.toLowerCase();
        return repos.filter(
          (repo: any) =>
            repo.name.toLowerCase().includes(lowerQuery) ||
            repo.full_name.toLowerCase().includes(lowerQuery)
        );
      }

      // Return top 20 if no query
      return repos.slice(0, 20);
    } catch {
      return [];
    }
  }

  /**
   * Get bot ID from configuration
   */
  private getBotId(): string {
    return this.config.slack.botId || "default-slack-bot";
  }

  /**
   * Setup all Slack event handlers
   */
  private setupEventHandlers(): void {
    logger.info("Setting up Queue-based Slack event handlers...");

    // Setup modular event handlers for files, messages, and users
    setupMessageHandlers(this.app);
    setupUserHandlers(
      this.app,
      (userId: string, channelId: string, client: any) =>
        this.shortcutCommandHandler.sendContextAwareWelcome(
          userId,
          channelId,
          client
        )
    );
    setupFileHandlers(this.app);

    // Setup team join event handler for welcome messages
    setupTeamJoinHandler(
      this.app,
      this.getBotId(),
      (userId: string, channelId: string, client: any, threadTs?: string) =>
        this.shortcutCommandHandler.sendContextAwareWelcome(
          userId,
          channelId,
          client,
          threadTs
        )
    );

    // Setup shortcuts, slash commands, and view submissions
    this.shortcutCommandHandler.setupHandlers();

    // Handle app mentions
    this.setupAppMentionHandler();

    // Handle direct messages
    this.setupDirectMessageHandler();

    // Handle all button/action interactions
    this.setupActionHandler();

    // Handle form submissions
    this.setupFormSubmissionHandler();

    // Handle app home opened event
    this.setupAppHomeHandler();

    logger.info("All Slack event handlers registered successfully");
  }

  /**
   * Handle app mentions in channels
   */
  private setupAppMentionHandler(): void {
    logger.info("Registering app_mention event handler");

    this.app.event("app_mention", async ({ event, client, say }) => {
      // Ignore mentions generated by our own bot only (not other bots)
      const botUserId = this.config.slack.botUserId;
      const botId = this.config.slack.botId;
      const eventAny = event as any;
      const isSelf =
        (botId && eventAny.bot_id && eventAny.bot_id === botId) ||
        (botUserId && eventAny.user === botUserId);
      if (isSelf) {
        logger.debug(
          `Ignoring self-generated app_mention (bot_id=${eventAny.bot_id}, user=${eventAny.user})`
        );
        return;
      }

      logger.info(`App mentioned by ${event.user} in channel ${event.channel}`);

      // Check if user is allowed
      if (!this.messageHandler.isUserAllowed(event.user || "")) {
        logger.warn(`User ${event.user} not in allowed users list`);
        await say({
          text: "Sorry, you don't have permission to use this bot. Please contact your administrator.",
          thread_ts: event.thread_ts || event.ts,
        });
        return;
      }

      // Extract the actual message text (removing the bot mention)
      const userRequest = this.messageHandler.extractUserRequest(event.text);
      const messageText = userRequest.toLowerCase().trim();

      // Check for text commands first (same as DM handler)
      if (
        messageText === "welcome" ||
        messageText === "help" ||
        messageText === "start" ||
        messageText === "onboard"
      ) {
        logger.info(`Handling welcome command via app_mention: ${messageText}`);
        await this.shortcutCommandHandler.handleTextCommand(
          "welcome",
          event.user || "",
          event.channel,
          client,
          event.thread_ts || event.ts
        );
        return;
      } else if (messageText === "login" || messageText === "connect github") {
        logger.info(`Handling login command via app_mention: ${messageText}`);
        await this.shortcutCommandHandler.handleTextCommand(
          "login",
          event.user || "",
          event.channel,
          client,
          event.thread_ts || event.ts
        );
        return;
      }

      // Normal message processing
      const context = this.messageHandler.extractSlackContext(event);
      await this.messageHandler.handleUserRequest(context, userRequest, client);
    });
  }

  /**
   * Handle direct messages to the bot
   */
  private setupDirectMessageHandler(): void {
    logger.info("Registering direct message handler");

    this.app.message(async ({ message, client }) => {
      // Only handle direct messages
      if (!message.subtype && (message as any).channel_type === "im") {
        const event = message as any;

        // Ignore messages generated by our own bot only (not other bots)
        const botUserId = this.config.slack.botUserId;
        const botId = this.config.slack.botId;
        const isSelf =
          (botId && event.bot_id && event.bot_id === botId) ||
          (botUserId && event.user === botUserId);
        if (isSelf) {
          logger.debug(
            `Ignoring self DM message (bot_id=${event.bot_id}, user=${event.user})`
          );
          return;
        }

        logger.info(`Direct message from ${event.user}: ${event.text}`);

        // Check if user is allowed
        if (!this.messageHandler.isUserAllowed(event.user || "")) {
          logger.warn(`User ${event.user} not in allowed users list`);
          await client.chat.postMessage({
            channel: event.channel,
            text: "Sorry, you don't have permission to use this bot. Please contact your administrator.",
            thread_ts: event.thread_ts || event.ts,
          });
          return;
        }

        // Check for text commands first
        const messageText = event.text?.toLowerCase().trim();
        logger.info(`Checking for text command: "${messageText}"`);

        // Handle text commands that mimic slash commands
        if (
          messageText === "welcome" ||
          messageText === "help" ||
          messageText === "start" ||
          messageText === "onboard"
        ) {
          logger.info(`Handling welcome command via text: ${messageText}`);
          // Reuse the slash command handler's welcome functionality
          await this.shortcutCommandHandler.handleTextCommand(
            "welcome",
            event.user,
            event.channel,
            client,
            event.thread_ts || event.ts
          );
          return;
        } else if (
          messageText === "login" ||
          messageText === "connect github"
        ) {
          logger.info(`Handling login command via text: ${messageText}`);
          // Reuse the slash command handler's login functionality
          await this.shortcutCommandHandler.handleTextCommand(
            "login",
            event.user,
            event.channel,
            client,
            event.thread_ts || event.ts
          );
          return;
        }

        // Normal message processing
        const context = this.messageHandler.extractSlackContext(event);
        const userRequest = this.messageHandler.extractUserRequest(event.text);

        await this.messageHandler.handleUserRequest(
          context,
          userRequest,
          client
        );
      }
    });
  }

  /**
   * Handle all button and interactive component actions
   */
  private setupActionHandler(): void {
    logger.info(
      "Registering action handler for buttons and interactive components"
    );

    this.app.action(/.*/, async ({ action, ack, client, body }) => {
      await ack();

      const actionId = (action as any).action_id;
      const userId = body.user.id;
      const channelId =
        (body as any).channel?.id || (body as any).container?.channel_id;
      const messageTs = (body as any).message?.ts || "";

      logger.info(`Action received: ${actionId} from user ${userId}`);

      // Delegate to action handler
      await this.actionHandler.handleBlockAction(
        actionId,
        userId,
        channelId,
        messageTs,
        body,
        client
      );
    });
  }

  /**
   * Handle form submission events
   */
  private setupFormSubmissionHandler(): void {
    logger.info("Registering view_submission handler for forms");

    // Register handler for blockkit form modal submissions
    this.app.view(
      "blockkit_form_modal",
      async ({ ack, body, view, client }) => {
        await ack();

        const userId = body.user.id;

        logger.info(
          `Form submission from user ${userId} for blockkit_form_modal`
        );

        await handleBlockkitFormSubmission(
          userId,
          view,
          client,
          async (context: any, userRequest: string, client: any) =>
            this.messageHandler.handleUserRequest(context, userRequest, client)
        );
      }
    );

    // Keep the old handler for backward compatibility
    this.app.view(
      "blockkit_form_submission",
      async ({ ack, body, view, client }) => {
        await ack();

        const userId = body.user.id;

        logger.info(
          `Form submission from user ${userId} for blockkit_form_submission`
        );

        await handleBlockkitFormSubmission(
          userId,
          view,
          client,
          async (context: any, userRequest: string, client: any) =>
            this.messageHandler.handleUserRequest(context, userRequest, client)
        );
      }
    );
  }

  /**
   * Handle app home opened events
   */
  private setupAppHomeHandler(): void {
    logger.info("Registering app_home_opened event handler");

    this.app.event("app_home_opened", async ({ event, client }) => {
      try {
        if (event.tab === "home") {
          await this.actionHandler.updateAppHome(event.user, client);
        }
      } catch (error) {
        logger.error("Error handling app home opened:", error);
      }
    });
  }

  /**
   * Cleanup method for graceful shutdown
   */
  cleanup(): void {
    logger.info("Cleaning up Slack event handlers");
    this.messageHandler.cleanupExpiredData();
  }

  /**
   * Get user mappings (required by ThreadResponseConsumer)
   */
  getUserMappings(): Map<string, string> {
    return this.messageHandler.getUserMappings();
  }

  /**
   * Get or create user mapping (required by external components)
   */
  async getOrCreateUserMapping(
    slackUserId: string,
    client: any
  ): Promise<string> {
    return this.messageHandler.getOrCreateUserMapping(slackUserId, client);
  }
}
