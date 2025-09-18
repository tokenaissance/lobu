#!/usr/bin/env bun

// import { execSync } from "node:child_process";
import fs from "node:fs";
import { join } from "node:path";
import * as Sentry from "@sentry/node";
import { parseClaudeOutput } from "./claude-response-parser";
import { ClaudeSessionRunner } from "./core";
import logger from "./logger";
import { QueueIntegration } from "./task-queue-integration";
import type { WorkerConfig } from "./types";
import { WorkspaceManager } from "./workspace-manager";

export class ClaudeWorker {
  private sessionRunner: ClaudeSessionRunner;
  private workspaceManager: WorkspaceManager;
  public queueIntegration: QueueIntegration; // Made public for error handling access
  private config: WorkerConfig;

  constructor(config: WorkerConfig) {
    this.config = config;

    // Initialize components
    this.sessionRunner = new ClaudeSessionRunner();
    this.workspaceManager = new WorkspaceManager(config.workspace);

    // Construct database URL from environment variables
    if (
      !process.env.PEERBOT_DATABASE_HOST ||
      !process.env.PEERBOT_DATABASE_PORT ||
      !process.env.PEERBOT_DATABASE_USERNAME ||
      !process.env.PEERBOT_DATABASE_PASSWORD
    ) {
      throw new Error(
        "Database connection environment variables are required (PEERBOT_DATABASE_HOST, PEERBOT_DATABASE_PORT, PEERBOT_DATABASE_USERNAME, PEERBOT_DATABASE_PASSWORD)"
      );
    }

    const databaseUrl = `postgresql://${encodeURIComponent(process.env.PEERBOT_DATABASE_USERNAME)}:${encodeURIComponent(process.env.PEERBOT_DATABASE_PASSWORD)}@${process.env.PEERBOT_DATABASE_HOST}:${process.env.PEERBOT_DATABASE_PORT}/peerbot`;

    this.queueIntegration = new QueueIntegration({
      databaseUrl: databaseUrl,
      responseChannel: config.slackResponseChannel,
      responseTs: config.slackResponseTs,
      messageId: config.slackResponseTs, // Always use the actual message timestamp from config
      botResponseTs: config.botResponseTs, // Pass bot response timestamp from config
      workspaceManager: this.workspaceManager,
      // Only use actual session IDs, not the special "continue" value
      claudeSessionId:
        config.sessionId ||
        (config.resumeSessionId === "continue"
          ? undefined
          : config.resumeSessionId),
    });
  }

  private listAppDirectories(rootDirectory: string): string[] {
    const foundDirectories: string[] = [];
    const ignored = new Set([
      "node_modules",
      ".git",
      ".next",
      "dist",
      "build",
      "vendor",
      "target",
      ".venv",
      "venv",
    ]);

    const buildConfigFiles = new Set([
      "Makefile",
      "makefile",
      "package.json",
      "pyproject.toml",
      "Cargo.toml",
      "pom.xml",
      "build.gradle",
      "build.gradle.kts",
      "CMakeLists.txt",
      "go.mod",
    ]);

    const walk = (dir: string): void => {
      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }

      // Check if current directory has any build config files
      const hasConfigFile = entries.some(
        (entry) => entry.isFile() && buildConfigFiles.has(entry.name)
      );

      if (hasConfigFile) {
        foundDirectories.push(dir);
      }

      // Recursively walk subdirectories
      for (const entry of entries) {
        const p = `${dir}/${entry.name}`;
        if (entry.isDirectory() && !ignored.has(entry.name)) {
          walk(p);
        }
      }
    };

    walk(rootDirectory);
    return foundDirectories;
  }

  private getMakeTargetsSummary(): string {
    // Use the actual workspace directory from workspace manager
    const root = this.workspaceManager.getCurrentWorkingDirectory();
    const appDirectories = this.listAppDirectories(root);
    if (appDirectories.length === 0) return "  - none";

    const lines: string[] = [];
    for (const dir of appDirectories) {
      lines.push(`  - ${dir}`);
    }
    return lines.join("\n");
  }

  /**
   * Execute the worker job
   */
  async execute(): Promise<void> {
    const executeStartTime = Date.now();
    // Original message timestamp available via process.env.ORIGINAL_MESSAGE_TS if needed

    try {
      logger.info(
        `🚀 Starting Claude worker for session: ${this.config.sessionKey} [test-change]`
      );
      logger.info(
        `[TIMING] Worker execute() started at: ${new Date(executeStartTime).toISOString()}`
      );

      // Start queue integration
      await this.queueIntegration.start();

      // Reactions are now handled by dispatcher based on message isDone status

      // Show stop button when worker starts processing
      this.queueIntegration.showStopButton();

      // Decode user prompt first
      const userPrompt = Buffer.from(this.config.userPrompt, "base64").toString(
        "utf-8"
      );
      logger.info(`User prompt: ${userPrompt.substring(0, 100)}...`);

      // Check if this is a resumed session to show appropriate message
      const isResumedSession = !!this.config.resumeSessionId;
      const workspaceMessage = isResumedSession
        ? "💻 Resuming workspace..."
        : "💻 Setting up new workspace...";

      // Update initial message with appropriate status
      await this.queueIntegration.updateProgress(workspaceMessage);

      // Setup workspace
      logger.info(
        isResumedSession ? "Resuming workspace..." : "Setting up workspace..."
      );
      await Sentry.startSpan(
        {
          name: "worker.workspace_setup",
          op: "worker.setup",
          attributes: {
            "user.id": this.config.userId,
            "repository.url": this.config.repositoryUrl,
            "session.key": this.config.sessionKey,
          },
        },
        async () => {
          await this.workspaceManager.setupWorkspace(
            this.config.repositoryUrl,
            this.config.userId,
            this.config.sessionKey
          );

          // Create or checkout session branch
          logger.info("Setting up session branch...");
          await this.workspaceManager.createSessionBranch(
            this.config.sessionKey
          );
        }
      );
      // Prepare session context
      const sessionContext = {
        platform: "slack" as const,
        channelId: this.config.channelId,
        userId: this.config.userId,
        userDisplayName: this.config.userId,
        threadTs: this.config.threadTs,
        messageTs: this.config.slackResponseTs,
        repositoryUrl: this.config.repositoryUrl,
        workingDirectory: this.workspaceManager.getCurrentWorkingDirectory(),
        customInstructions: this.generateCustomInstructions(),
      };

      // Execute Claude session with conversation history
      logger.info(
        `[TIMING] Starting Claude session at: ${new Date().toISOString()}`
      );
      const claudeStartTime = Date.now();
      logger.info(
        `[TIMING] Total worker startup time: ${claudeStartTime - executeStartTime}ms`
      );

      let firstOutputLogged = false;
      const result = await Sentry.startSpan(
        {
          name: "worker.claude_execution",
          op: "ai.inference",
          attributes: {
            "user.id": this.config.userId,
            "session.key": this.config.sessionKey,
            "thread.id": this.config.threadTs,
            model: JSON.parse(this.config.claudeOptions).model || "unknown",
            is_resume: !!this.config.resumeSessionId,
          },
        },
        async () => {
          return await this.sessionRunner.executeSession({
            sessionKey: this.config.sessionKey,
            userPrompt,
            context: sessionContext,
            options: {
              ...JSON.parse(this.config.claudeOptions),
              // Simple session management:
              // - If resumeSessionId is set, it will trigger --continue
              // - If sessionId is set, use it for new session
              // - Otherwise let Claude generate one
              ...(this.config.resumeSessionId
                ? { resumeSessionId: this.config.resumeSessionId }
                : this.config.sessionId
                  ? { sessionId: this.config.sessionId }
                  : {}),
            },
            onProgress: async (update) => {
              // Log timing for first output
              if (!firstOutputLogged && update.type === "output") {
                logger.info(
                  `[TIMING] First Claude output at: ${new Date().toISOString()} (${Date.now() - claudeStartTime}ms after Claude start)`
                );
                firstOutputLogged = true;
                // Update progress to show Claude is now actively working
                await this.queueIntegration.sendTyping();
              }
              // Stream progress via queue
              if (update.type === "output" && update.data) {
                await this.queueIntegration.streamProgress(update.data);
              }
            },
          });
        }
      );

      // Handle final result

      logger.info("=== FINAL RESULT DEBUG ===");
      logger.info("result.success:", result.success);
      logger.info("result.output exists:", !!result.output);
      logger.info("result.output length:", result.output?.length);
      logger.info("result.output sample:", result.output?.substring(0, 300));
      logger.info("About to update Slack...");

      // Do a final push of any remaining changes
      let pushFailed = false;
      let pushErrorMsg = "";
      try {
        const status = await this.workspaceManager.getRepositoryStatus();
        if (status.hasChanges) {
          logger.info("Final push: Committing remaining changes...");
          await this.workspaceManager.commitAndPush(
            `Session complete: ${status.changedFiles.length} file(s) modified`
          );
        }
      } catch (pushError: any) {
        logger.warn("Final push failed:", pushError);
        pushFailed = true;
        // Check if it's a permission error
        if (pushError?.message?.includes("403") || pushError?.message?.includes("Permission")) {
          pushErrorMsg = "\n\n⚠️ Note: Changes were saved locally but couldn't be pushed to GitHub (permission denied). You may need to manually push the changes.";
        } else {
          pushErrorMsg = "\n\n⚠️ Note: Changes were saved locally but couldn't be pushed to GitHub. Make sure you have the correct permissions on the repository, login with github and try again.";
        }
      }

      if (result.success) {
        // Update with Claude's response and completion status
        const claudeResponse = this.formatClaudeResponse(result.output);

        // IMPORTANT: Always update with a message, even if Claude didn't provide final text
        // This ensures the "thinking" message is replaced
        let finalMessage = claudeResponse?.trim()
          ? claudeResponse
          : "✅ Task completed successfully";
        
        // Append push failure warning if needed
        if (pushFailed) {
          finalMessage += pushErrorMsg;
        }

        logger.info(`Sending final message via queue: ${finalMessage}...`);
        await this.queueIntegration.updateProgress(finalMessage);
        await this.queueIntegration.signalDone(finalMessage);

        // Hide stop button and update reaction to success
        this.queueIntegration.hideStopButton();

        // Reactions are now handled by dispatcher based on message isDone status
      } else {
        // Hide stop button and show error
        this.queueIntegration.hideStopButton();

        const errorMsg = result.error || "Unknown error";
        await this.queueIntegration.updateProgress(
          `❌ Session failed: ${errorMsg}`
        );
        await this.queueIntegration.signalError(new Error(errorMsg));

        // Reactions are now handled by dispatcher based on error status
      }

      logger.info(
        `Worker completed with ${result.success ? "success" : "failure"}`
      );
    } catch (error) {
      logger.error("Worker execution failed:", error);

      // Try to push any pending changes before failing
      try {
        const status = await this.workspaceManager.getRepositoryStatus();
        if (status?.hasChanges) {
          await this.workspaceManager.commitAndPush(
            `Session error: Saving ${status.changedFiles.length} file(s) before exit`
          );
        }
      } catch (pushError) {
        logger.warn("Error push failed:", pushError);
      }

      // Try to send error via queue
      try {
        // Hide stop button before showing error
        this.queueIntegration.hideStopButton();

        // Create more informative error message
        let errorMessage = `💥 Worker crashed`;
        if (error instanceof Error) {
          errorMessage += `: ${error.message}`;
          // Add error type if it's not generic
          if (error.constructor.name !== "Error") {
            errorMessage = `💥 Worker crashed (${error.constructor.name}): ${error.message}`;
          }
        } else {
          errorMessage += ": Unknown error";
        }

        await this.queueIntegration.updateProgress(errorMessage);
        await this.queueIntegration.signalError(
          error instanceof Error ? error : new Error(String(error))
        );

        // Reactions are now handled by dispatcher based on error status
      } catch (queueError) {
        logger.error("Failed to send error via queue:", queueError);
      }

      // Re-throw to ensure container exits with error code
      throw error;
    }
  }

  /**
   * Generate custom instructions for Claude
   */
  private generateCustomInstructions(): string {
    try {
      const templatePath = join(__dirname, "..", "custom-instructions.md");
      logger.debug(`[CUSTOM-INSTRUCTIONS] Loading from: ${templatePath}`);

      const template = fs.readFileSync(templatePath, "utf-8");

      // Replace placeholders with actual values
      const processed = template
        .replace(/{{userId}}/g, this.config.userId)
        .replace(/{{repositoryUrl}}/g, this.config.repositoryUrl)
        .replace(/{{sessionKey}}/g, this.config.sessionKey)
        .replace(
          /{{sessionKeyFormatted}}/g,
          this.config.sessionKey.replace(/\./g, "-")
        )
        .replace(/{{makeTargetsSummary}}/g, this.getMakeTargetsSummary())
        .replace(
          /{{workingDirectory}}/g,
          this.workspaceManager.getCurrentWorkingDirectory()
        );

      logger.info(`[CUSTOM-INSTRUCTIONS] \n${processed}`);

      return processed;
    } catch (error) {
      logger.error("Failed to read custom instructions template:", error);
      logger.error(
        `Template path attempted: ${join(__dirname, "custom-instructions.md")}`
      );
      // Fallback to basic instructions
      const fallback = `You are a helpful Claude Code agent for user ${this.config.userId}.`;
      logger.warn(`[CUSTOM-INSTRUCTIONS] Using fallback: ${fallback}`);
      return fallback;
    }
  }

  private formatClaudeResponse(output: string | undefined): string {
    logger.info("=== formatClaudeResponse DEBUG ===");
    logger.info(`output exists? ${!!output}`);
    logger.info(`output length: ${output?.length}`);
    logger.info(`output first 200 chars: ${output?.substring(0, 200)}`);

    if (!output) {
      return "";
    }

    const parsed = parseClaudeOutput(output);
    logger.info(`parsed response: ${parsed}`);
    logger.info(`parsed length: ${parsed.length}`);

    // Return the parsed markdown with tool details - slack-integration will handle conversion
    return parsed || "";
  }

  /**
   * Cleanup worker resources
   */
  async cleanup(): Promise<void> {
    try {
      logger.info("Cleaning up worker resources...");

      // Cleanup queue integration
      this.queueIntegration.cleanup();
      await this.queueIntegration.stop();

      // Cleanup session runner
      await this.sessionRunner.cleanupSession(this.config.sessionKey);

      // Cleanup workspace (this also does a final commit/push)
      await this.workspaceManager.cleanup();

      logger.info("Worker cleanup completed");
    } catch (error) {
      logger.error("Error during cleanup:", error);
    }
  }
}

export type { WorkerConfig } from "./types";
