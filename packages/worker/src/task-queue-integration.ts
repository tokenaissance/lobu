#!/usr/bin/env bun

import PgBoss from "pg-boss";
import { createLogger } from "@peerbot/shared";
import type { GitHubModule } from "../../../modules/github";

const logger = createLogger("worker");

interface TodoItem {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed";
}

interface ThreadResponsePayload {
  messageId: string;
  channelId: string;
  threadTs: string;
  userId: string;
  content?: string;
  error?: string;
  timestamp: number;
  originalMessageTs?: string; // User's original message timestamp for reactions
  gitBranch?: string; // Current git branch for Edit button URLs
  hasGitChanges?: boolean; // Whether there are uncommitted/unpushed changes
  pullRequestUrl?: string; // URL of existing PR if any
  botResponseTs?: string; // Bot's response message timestamp for updates
  claudeSessionId?: string; // Claude session ID for tracking bot messages per session
  processedMessageIds?: string[]; // List of processed message IDs (signals completion when present)
}

export class QueueIntegration {
  private pgBoss: PgBoss;
  private isConnected = false;
  private responseChannel: string;
  private responseTs: string;
  private messageId: string;
  private botResponseTs?: string; // Track bot's response message timestamp
  private lastUpdateTime = 0;
  private updateQueue: string[] = [];
  private isProcessingQueue = false;
  private currentTodos: TodoItem[] = [];
  private currentToolExecution: string = "";
  private deploymentName?: string;
  private workspaceManager?: any; // WorkspaceManager dependency
  private claudeSessionId?: string; // Claude session ID
  private processedMessageIds?: string[]; // Processed message IDs to include on completion

  constructor(config: {
    databaseUrl: string;
    responseChannel?: string;
    responseTs?: string;
    messageId?: string;
    botResponseTs?: string;
    workspaceManager?: any;
    claudeSessionId?: string;
  }) {
    this.pgBoss = new PgBoss(config.databaseUrl);
    this.workspaceManager = config.workspaceManager;

    // Get response location from config or environment
    this.responseChannel =
      config.responseChannel || process.env.SLACK_RESPONSE_CHANNEL!;
    this.responseTs =
      config.responseTs ||
      process.env.INITIAL_SLACK_RESPONSE_TS ||
      process.env.SLACK_RESPONSE_TS!;
    this.messageId =
      config.messageId ||
      process.env.INITIAL_SLACK_MESSAGE_ID ||
      process.env.SLACK_MESSAGE_ID!;
    this.botResponseTs = config.botResponseTs || process.env.BOT_RESPONSE_TS; // Bot's response message timestamp from config or env
    this.claudeSessionId = config.claudeSessionId; // Claude session ID

    // Get deployment name from environment for stop button
    this.deploymentName = process.env.DEPLOYMENT_NAME;

    // Validate required values
    if (!this.responseChannel || !this.responseTs || !this.messageId) {
      const error = new Error(
        `Missing required response location - channel: "${this.responseChannel}", ts: "${this.responseTs}", messageId: "${this.messageId}"`
      );
      logger.error(`QueueIntegration initialization failed: ${error.message}`);
      throw error;
    }

    logger.info(
      `QueueIntegration initialized - channel: ${this.responseChannel}, ts: ${this.responseTs}, messageId: ${this.messageId}, claudeSessionId: ${this.claudeSessionId || "undefined"}`
    );
  }

  /**
   * Start the queue connection
   */
  async start(): Promise<void> {
    try {
      await this.pgBoss.start();
      this.isConnected = true;

      // Create the thread_response queue if it doesn't exist
      await this.pgBoss.createQueue("thread_response");
      logger.info("✅ Queue integration started successfully");
    } catch (error) {
      logger.error("Failed to start queue integration:", error);
      throw error;
    }
  }

  /**
   * Stop the queue connection
   */
  async stop(): Promise<void> {
    try {
      this.isConnected = false;
      await this.pgBoss.stop();
      logger.info("✅ Queue integration stopped");
    } catch (error) {
      logger.error("Error stopping queue integration:", error);
      throw error;
    }
  }

  /**
   * Update progress message via queue
   */
  async updateProgress(content: string): Promise<void> {
    try {
      // Ensure we always have content to update with
      if (!content || content.trim() === "") {
        logger.warn(
          "updateProgress called with empty content, using default message"
        );
        content = "✅ Task completed";
      }

      // Rate limiting: don't update more than once every 2 seconds
      const now = Date.now();
      if (now - this.lastUpdateTime < 2000) {
        // Queue the update
        this.updateQueue.push(content);
        this.processQueue();
        return;
      }

      await this.performUpdate(content);
      this.lastUpdateTime = now;
    } catch (error) {
      logger.error("Failed to send progress update to queue:", error);
      // Don't throw - worker should continue even if queue updates fail
    }
  }

  /**
   * Stream progress updates (for real-time Claude output)
   */
  async streamProgress(data: any): Promise<void> {
    try {
      // Handle both string and object data
      let dataToCheck: string;

      if (typeof data === "string" && data.trim()) {
        dataToCheck = data;
      } else if (typeof data === "object") {
        dataToCheck = JSON.stringify(data);
        logger.info(
          `📊 StreamProgress received object data: ${dataToCheck.substring(0, 200)}...`
        );
      } else {
        return;
      }

      // Priority 1: TodoWrite updates (full todo list refresh)
      const todoData = this.extractTodoList(dataToCheck);
      if (todoData) {
        this.currentTodos = todoData;
        this.currentToolExecution = ""; // Clear tool execution on todo update
        await this.updateProgressWithTodos();
        return;
      }

      // Priority 2: Tool execution tracking (between todo updates)
      const toolExecution = this.extractToolExecution(dataToCheck);
      if (toolExecution && toolExecution !== this.currentToolExecution) {
        logger.info(`🔧 Detected tool execution: ${toolExecution}`);
        this.currentToolExecution = toolExecution;
        // this.lastToolUpdate = Date.now();
        // Update with todos if available, otherwise show just the tool execution
        if (this.currentTodos.length > 0) {
          logger.info(`📝 Updating progress with todos + tool execution`);
          await this.updateProgressWithTodos();
        } else {
          logger.info(
            `🔧 Showing tool execution without todos: ${toolExecution}`
          );
          await this.updateProgress(toolExecution);
        }
        return;
      }

      // Priority 3: Regular content streaming
      if (typeof data === "string") {
        await this.updateProgress(data);
      } else if (typeof data === "object" && data.content) {
        await this.updateProgress(data.content);
      }
    } catch (error) {
      logger.error("Failed to stream progress:", error);
    }
  }

  /**
   * Process queued updates
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessingQueue || this.updateQueue.length === 0) {
      return;
    }

    this.isProcessingQueue = true;

    try {
      // Wait for rate limit, then send the latest update
      const delay = Math.max(0, 2000 - (Date.now() - this.lastUpdateTime));
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      // Get the latest update from queue
      const latestUpdate = this.updateQueue.pop();
      this.updateQueue = []; // Clear queue

      if (latestUpdate) {
        await this.performUpdate(latestUpdate);
        this.lastUpdateTime = Date.now();
      }
    } finally {
      this.isProcessingQueue = false;
    }
  }

  /**
   * Get the current git branch name only if the session has made changes
   */
  /**
   * Get comprehensive git status including changes and PR status
   */
  private async getGitStatus(): Promise<{
    branch?: string;
    hasGitChanges: boolean;
    pullRequestUrl?: string;
  }> {
    try {
      logger.info("getGitStatus called - checking repository status");

      if (!this.workspaceManager) {
        logger.warn("No workspace manager available for git status");
        return { hasGitChanges: false };
      }

      const status = await this.workspaceManager.getRepositoryStatus();
      const branch = status.branch;
      logger.info(
        `Git branch detected: ${branch}, has changes: ${status.hasChanges}`
      );

      // Check for PR using gh CLI
      let pullRequestUrl: string | undefined;
      logger.info(
        `Branch value: "${branch}", Type: ${typeof branch}, starts with claude/: ${branch?.startsWith("claude/")}`
      );

      if (branch?.startsWith("claude/")) {
        logger.info(`Entering PR detection block for branch: ${branch}`);
        try {
          const { execSync } = require("node:child_process");
          const workingDir = this.workspaceManager.getCurrentWorkingDirectory();
          logger.info(
            `About to check for PR in directory: ${workingDir}, branch: ${branch}`
          );

          // Check if GitHub CLI is authenticated through module
          let isAuthenticated = false;
          try {
            const { moduleRegistry } = await import("../../../modules");
            const githubModule =
              moduleRegistry.getModule<GitHubModule>("github");
            if (githubModule && "isGitHubCLIAuthenticated" in githubModule) {
              isAuthenticated = await (
                githubModule as any
              ).isGitHubCLIAuthenticated(workingDir);
              logger.info(
                `GitHub CLI authentication status: ${isAuthenticated}`
              );
            } else {
              // Fallback to direct check
              logger.info("Checking GitHub CLI authentication (fallback)...");
              execSync("gh auth status", {
                cwd: workingDir,
                stdio: "pipe",
                timeout: 3000,
              });
              isAuthenticated = true;
            }
          } catch (authError: any) {
            logger.warn("GitHub CLI not authenticated, skipping PR detection");
            return {
              branch,
              hasGitChanges: status.hasChanges,
              pullRequestUrl: undefined,
            };
          }

          if (!isAuthenticated) {
            logger.warn("GitHub CLI not authenticated, skipping PR detection");
            return {
              branch,
              hasGitChanges: status.hasChanges,
              pullRequestUrl: undefined,
            };
          }

          // Try to get PR information
          let prInfo: string | undefined;
          try {
            logger.info("Checking for existing PR with gh pr view...");
            // Use gh pr list to check if a PR exists for this branch first
            const prList = execSync(
              `gh pr list --head "${branch}" --json url,state --limit 1`,
              {
                cwd: workingDir,
                encoding: "utf8",
                stdio: "pipe",
                timeout: 5000, // 5 second timeout
              }
            );

            logger.info(`PR list result: ${prList}`);

            const prs = JSON.parse(prList || "[]");
            if (prs.length > 0) {
              prInfo = JSON.stringify(prs[0]);
              logger.info(`Found PR: ${prInfo}`);
            } else {
              logger.info(`No PR exists for branch ${branch}`);
              return {
                branch,
                hasGitChanges: status.hasChanges,
                pullRequestUrl: undefined,
              };
            }
          } catch (prError: any) {
            logger.warn(`Error checking PR: ${prError.message}`);
            return {
              branch,
              hasGitChanges: status.hasChanges,
              pullRequestUrl: undefined,
            };
          }

          const parsed = JSON.parse(prInfo);
          if (parsed.url && parsed.state === "OPEN") {
            pullRequestUrl = parsed.url;
            logger.info(
              `Found existing PR for branch ${branch}: ${pullRequestUrl}`
            );
          } else {
            logger.debug(`PR exists but not open. State: ${parsed.state}`);
          }
        } catch (error: any) {
          // Unexpected error
          logger.error(
            `Unexpected error checking PR for branch ${branch}:`,
            error.message
          );
        }
      } else {
        logger.info(
          `Skipping PR detection: branch="${branch}" doesn't start with "claude/" or is undefined`
        );
      }

      return {
        branch,
        hasGitChanges: status.hasChanges,
        pullRequestUrl,
      };
    } catch (error) {
      logger.warn("Failed to get git status:", error);
      return { hasGitChanges: false };
    }
  }

  /**
   * Perform the actual queue update
   */
  private async performUpdate(content: string): Promise<void> {
    if (!this.isConnected) {
      logger.warn("Queue not connected, skipping update");
      return;
    }

    try {
      // Final safety check - ensure we have content
      if (!content || content.trim() === "") {
        logger.warn("performUpdate called with empty content, using fallback");
        content = "✅ Task completed";
      }

      // Get git status with PR info
      const gitStatus = await this.getGitStatus();

      const payload: ThreadResponsePayload = {
        messageId: this.messageId,
        channelId: this.responseChannel,
        threadTs: this.responseTs,
        userId: process.env.USER_ID || "unknown",
        content: content,
        timestamp: Date.now(),
        originalMessageTs: this.messageId, // User's original message for reactions - no fallback to avoid stuck values
        gitBranch: gitStatus.branch, // Current git branch
        hasGitChanges: gitStatus.hasGitChanges, // Whether there are uncommitted/unpushed changes
        pullRequestUrl: gitStatus.pullRequestUrl, // URL of existing PR if any
        botResponseTs: this.botResponseTs, // Bot's response message for updates
        claudeSessionId: this.claudeSessionId, // Claude session ID for tracking bot messages
      };

      logger.info(
        `Sending thread_response with claudeSessionId: ${payload.claudeSessionId || "undefined"}`
      );

      // Send to thread_response queue
      const jobId = await this.pgBoss.send("thread_response", payload, {
        priority: 0,
        retryLimit: 3,
        retryDelay: 5,
        expireInHours: 1,
      });

      logger.info(
        `Sent progress update to queue with job id: ${jobId}, claudeSessionId: ${payload.claudeSessionId}`
      );
    } catch (error: any) {
      logger.error("Failed to send update to thread_response queue:", error);
      throw error;
    }
  }

  // Reaction methods removed - dispatcher now handles reactions based on processedMessageIds

  // Store processed message IDs for inclusion on completion
  setProcessedMessages(list: string[]): void {
    this.processedMessageIds = Array.from(new Set(list.filter(Boolean)));
  }

  /**
   * Send typing indicator via queue
   */
  async sendTyping(): Promise<void> {
    try {
      // Show current todos if available, otherwise show thinking message
      if (this.currentTodos.length > 0) {
        await this.updateProgressWithTodos();
      } else {
        await this.updateProgress("💭 Peerbot is thinking...");
      }
    } catch (error) {
      logger.error("Failed to send typing indicator:", error);
    }
  }

  /**
   * Signal that the agent is done processing
   */
  async signalDone(finalMessage?: string): Promise<void> {
    if (!this.isConnected) {
      logger.warn("Queue not connected, skipping done signal");
      return;
    }

    try {
      // Get git status with PR info
      const gitStatus = await this.getGitStatus();

      const payload: ThreadResponsePayload = {
        messageId: this.messageId,
        channelId: this.responseChannel,
        threadTs: this.responseTs,
        userId: process.env.USER_ID || "unknown",
        content: finalMessage,
        timestamp: Date.now(),
        originalMessageTs: this.messageId, // User's original message for reactions - no fallback to avoid stuck values
        gitBranch: gitStatus.branch, // Current git branch
        hasGitChanges: gitStatus.hasGitChanges, // Whether there are uncommitted/unpushed changes
        pullRequestUrl: gitStatus.pullRequestUrl, // URL of existing PR if any
        botResponseTs: this.botResponseTs, // Bot's response message for updates
        claudeSessionId: this.claudeSessionId, // Claude session ID for tracking bot messages
        processedMessageIds: this.processedMessageIds, // Signal completion with processed messages
      };

      const jobId = await this.pgBoss.send("thread_response", payload, {
        priority: 1, // Higher priority for completion signals
        retryLimit: 5,
        retryDelay: 5,
        expireInHours: 1,
      });

      logger.info(`Sent completion signal to queue with job id: ${jobId}`);
    } catch (error: any) {
      logger.error("Failed to send completion signal to queue:", error);
      throw error;
    }
  }

  /**
   * Signal that an error occurred
   */
  async signalError(error: Error): Promise<void> {
    if (!this.isConnected) {
      logger.warn("Queue not connected, skipping error signal");
      return;
    }

    try {
      // Create user-friendly error message without stack trace
      let userFriendlyError = error.message;

      // Add error type if it's not a generic Error and not WorkspaceError
      if (
        error.constructor.name !== "Error" &&
        error.constructor.name !== "WorkspaceError"
      ) {
        userFriendlyError = `${error.constructor.name}: ${userFriendlyError}`;
      }

      // Log the full error with stack trace for debugging
      logger.error("Full error details:", error);

      // Check for common error patterns and add specific context
      if (
        error.message.includes("repository") &&
        error.message.includes("not found")
      ) {
        userFriendlyError =
          "Repository not found. Please authenticate with GitHub or use the demo to continue.";
      } else if (
        error.message.includes("Permission denied") ||
        error.message.includes("EACCES")
      ) {
        userFriendlyError +=
          "\n\n💡 This appears to be a permission error. Check file/directory permissions or authentication.";
      } else if (error.message.includes("git")) {
        userFriendlyError +=
          "\n\n💡 This appears to be a Git-related error. Check repository access, credentials, or branch state.";
      } else if (
        error.message.includes("timeout") ||
        error.message.includes("ETIMEDOUT")
      ) {
        userFriendlyError +=
          "\n\n💡 This appears to be a timeout error. The operation may need more time or there could be a network issue.";
      }

      // Get git status with PR info
      const gitStatus = await this.getGitStatus();

      const payload: ThreadResponsePayload = {
        messageId: this.messageId,
        channelId: this.responseChannel,
        threadTs: this.responseTs,
        userId: process.env.USER_ID || "unknown",
        error: userFriendlyError,
        timestamp: Date.now(),
        originalMessageTs: this.messageId, // User's original message for reactions - no fallback to avoid stuck values
        gitBranch: gitStatus.branch, // Current git branch
        hasGitChanges: gitStatus.hasGitChanges, // Whether there are uncommitted/unpushed changes
        pullRequestUrl: gitStatus.pullRequestUrl, // URL of existing PR if any
        botResponseTs: this.botResponseTs, // Bot's response message for updates
        claudeSessionId: this.claudeSessionId, // Claude session ID for tracking bot messages
      };

      const jobId = await this.pgBoss.send("thread_response", payload, {
        priority: 1, // Higher priority for error signals
        retryLimit: 5,
        retryDelay: 5,
        expireInHours: 1,
      });

      logger.info(`Sent error signal to queue with job id: ${jobId}`);
    } catch (sendError: any) {
      logger.error("Failed to send error signal to queue:", sendError);
      // Don't throw here - we're already handling an error
    }
  }

  /**
   * Send authentication prompt with helpful buttons
   */
  async sendAuthenticationPrompt(message: string): Promise<void> {
    if (!this.isConnected) {
      logger.warn("Queue not connected, skipping authentication prompt");
      return;
    }

    try {
      // Generate GitHub OAuth URL for authentication through module
      let authUrl = `${process.env.INGRESS_URL || "http://localhost:8080"}/login`;
      try {
        const { moduleRegistry } = await import("../../../modules");
        const githubModule = moduleRegistry.getModule<GitHubModule>("github");
        if (githubModule && "generateOAuthUrl" in githubModule) {
          authUrl = (githubModule as any).generateOAuthUrl(
            process.env.USER_ID || ""
          );
        }
      } catch (moduleError) {
        console.warn(
          "Failed to get GitHub OAuth URL from module, using fallback:",
          moduleError
        );
      }

      // Create a rich message with buttons
      const blocks = [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: message,
          },
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: {
                type: "plain_text",
                text: "🔐 Connect GitHub",
              },
              url: authUrl,
              action_id: "github_login",
            },
            {
              type: "button",
              text: {
                type: "plain_text",
                text: "🎮 Try Demo",
              },
              action_id: "demo_mode",
              value: "demo",
            },
            {
              type: "button",
              text: {
                type: "plain_text",
                text: "❓ Get Help",
              },
              action_id: "welcome",
              value: "welcome",
            },
          ],
        },
      ];

      // Send as a formatted message with blocks
      const payload: ThreadResponsePayload = {
        messageId: this.messageId,
        channelId: this.responseChannel,
        threadTs: this.responseTs,
        userId: process.env.USER_ID || "unknown",
        content: JSON.stringify({ blocks }), // Send blocks as JSON
        timestamp: Date.now(),
        originalMessageTs: this.messageId,
        botResponseTs: this.botResponseTs,
        claudeSessionId: this.claudeSessionId,
      };

      const jobId = await this.pgBoss.send("thread_response", payload, {
        priority: 1,
        retryLimit: 5,
        retryDelay: 5,
        expireInHours: 1,
      });

      logger.info(`Sent authentication prompt to queue with job id: ${jobId}`);
    } catch (sendError: any) {
      logger.error("Failed to send authentication prompt to queue:", sendError);
      // Fall back to simple error message
      await this.signalError(
        new Error("Authentication required. Please type 'welcome' for help.")
      );
    }
  }

  /**
   * Extract todo list from Claude's JSON output
   */
  private extractTodoList(data: string): TodoItem[] | null {
    try {
      const lines = data.split("\n");
      for (const line of lines) {
        if (line.trim().startsWith("{")) {
          const parsed = JSON.parse(line);

          // Check if this is a tool_use for TodoWrite
          if (parsed.type === "assistant" && parsed.message?.content) {
            for (const content of parsed.message.content) {
              if (
                content.type === "tool_use" &&
                content.name === "TodoWrite" &&
                content.input?.todos
              ) {
                return content.input.todos;
              }
            }
          }

          // Check if this is a tool_result from TodoWrite
          if (parsed.type === "user" && parsed.message?.content) {
            for (const content of parsed.message.content) {
              if (
                content.type === "tool_result" &&
                content.content?.includes(
                  "Todos have been modified successfully"
                )
              ) {
                // Try to extract todos from previous context
                return null; // Let the assistant message handle this
              }
            }
          }
        }
      }
    } catch (_error) {
      // Not JSON or parsing failed
    }
    return null;
  }

  /**
   * Extract tool execution details from Claude's JSON output
   */
  private extractToolExecution(data: string): string | null {
    try {
      const lines = data.split("\n");
      for (const line of lines) {
        if (line.trim().startsWith("{")) {
          const parsed = JSON.parse(line);

          // Detect tool usage
          if (parsed.type === "assistant" && parsed.message?.content) {
            for (const content of parsed.message.content) {
              if (content.type === "tool_use") {
                return this.formatToolExecution(content);
              }
            }
          }
        }
      }
    } catch (_e) {
      // Silently continue - not all lines are valid JSON
    }
    return null;
  }

  /**
   * Format tool execution for user-friendly display
   */
  private formatToolExecution(toolUse: any): string {
    const toolName = toolUse.name;
    const params = toolUse.input || {};

    switch (toolName) {
      case "Write":
        return `✏️ **Writing file:** \`${params.file_path}\``;
      case "Edit":
        return `✏️ **Editing file:** \`${params.file_path}\``;
      case "Bash": {
        const command = params.command || params.description || "command";
        return `🔧 **Running:** \`${command.length > 50 ? `${command.substring(0, 50)}...` : command}\``;
      }
      case "Read":
        return `📖 **Reading file:** \`${params.file_path}\``;
      case "Grep":
        return `🔍 **Searching:** "${params.pattern}"`;
      case "TodoWrite":
        return "📝 **Updating task list...**";
      default:
        return `🔧 **Using tool:** ${toolName}`;
    }
  }

  /**
   * Update progress with todo list display
   */
  private async updateProgressWithTodos(): Promise<void> {
    if (this.currentTodos.length === 0) {
      await this.updateProgress("📝 Task list updated");
      return;
    }

    const todoDisplay = this.formatTodoList(this.currentTodos);
    await this.updateProgress(todoDisplay);
  }

  /**
   * Format todo list for display
   */
  private formatTodoList(todos: TodoItem[]): string {
    const todoLines = todos.map((todo) => {
      const checkbox = todo.status === "completed" ? "☑️" : "☐";
      if (todo.status === "in_progress") {
        return `🪚 *${todo.content}*`;
      }
      return `${checkbox} ${todo.content}`;
    });

    let content = `📝 **Task Progress**\n\n${todoLines.join("\n")}`;

    // Add current tool execution if available
    if (this.currentToolExecution) {
      content += `\n\n${this.currentToolExecution}`;
    }

    return content;
  }

  /**
   * Show stop button in messages
   * Called when Claude worker starts processing
   */
  showStopButton(): void {
    // this.stopButtonVisible = true;
    logger.info("Stop button enabled for deployment:", this.deploymentName);
  }

  /**
   * Hide stop button from messages
   * Called when Claude worker finishes or times out
   */
  hideStopButton(): void {
    // this.stopButtonVisible = false;
    logger.info("Stop button disabled for deployment:", this.deploymentName);
  }

  /**
   * Cleanup queue integration
   */
  cleanup(): void {
    // Hide stop button before cleanup
    this.hideStopButton();

    // Clear any pending updates
    this.updateQueue = [];
    this.isProcessingQueue = false;
    this.currentTodos = [];
    this.currentToolExecution = "";
  }

  /**
   * Check if queue integration is connected
   */
  isHealthy(): boolean {
    return this.isConnected;
  }
}
