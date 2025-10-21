#!/usr/bin/env bun

import fs from "node:fs";
import { createLogger } from "@peerbot/core";
import * as Sentry from "@sentry/node";
import { ClaudeSessionRunner } from "./claude/executor";
import { GatewayIntegration } from "./gateway/client";
import type { WorkerConfig } from "./types";
import type { WorkerExecutor, GatewayIntegrationInterface } from "./interfaces";
import { WorkspaceManager } from "./workspace";
import {
  InstructionBuilder,
  CoreInstructionProvider,
  SlackInstructionProvider,
  ProjectsInstructionProvider,
  ProcessManagerInstructionProvider,
} from "./instructions";

const logger = createLogger("worker");

// ============================================================================
// ERROR HANDLER
// ============================================================================

/**
 * Centralized error handling for worker execution
 */
class WorkerErrorHandler {
  /**
   * Check if error is a repository access/authentication issue
   */
  isRepositoryAccessError(error: unknown): boolean {
    return (
      (error as any)?.isAuthenticationError === true ||
      (error as any)?.cause?.isAuthenticationError === true ||
      (error as any)?.gitExitCode === 128
    );
  }

  /**
   * Format error message for display
   */
  formatErrorMessage(error: unknown): string {
    let errorMsg = `💥 Worker crashed`;

    if (error instanceof Error) {
      errorMsg += `: ${error.message}`;
      // Add error type if it's not generic
      if (
        error.constructor.name !== "Error" &&
        error.constructor.name !== "WorkspaceError"
      ) {
        errorMsg = `💥 Worker crashed (${error.constructor.name}): ${error.message}`;
      }
    } else {
      errorMsg += ": Unknown error";
    }

    return errorMsg;
  }

  /**
   * Handle authentication errors with helpful messages
   */
  async handleAuthenticationError(
    config: WorkerConfig,
    gateway: GatewayIntegrationInterface
  ): Promise<void> {
    const isDM = config.channelId?.startsWith("D");
    let userMessage: string;

    if (isDM) {
      // In DM, provide authentication options
      userMessage = `🔐 **Authentication Required**

I need access to a GitHub repository to help you. You have two options:

**Option 1: Authenticate with GitHub**
• Type \`login\` or click the button below to connect your GitHub account
• This gives you full access to your repositories

**Option 2: Try the Demo**
• Type \`demo\` to use a sample repository
• Great for exploring what I can do

Type \`welcome\` for more information about getting started.`;
    } else {
      // In channel, be more concise
      userMessage = `🔐 Repository access required. Please authenticate with GitHub or use the demo. Type \`welcome\` for help.`;
    }

    // Send the helpful message
    await gateway.sendContent(userMessage);
  }

  /**
   * Handle execution error - decides between authentication and generic errors
   */
  async handleExecutionError(
    error: unknown,
    config: WorkerConfig,
    gateway: GatewayIntegrationInterface
  ): Promise<void> {
    logger.error("Worker execution failed:", error);

    try {
      if (this.isRepositoryAccessError(error)) {
        // This is a repository access issue - provide helpful guidance
        await this.handleAuthenticationError(config, gateway);
      } else {
        // Other errors - show generic error message
        const errorMsg = this.formatErrorMessage(error);
        await gateway.sendContent(errorMsg);
        await gateway.signalError(
          error instanceof Error ? error : new Error(String(error))
        );
      }
    } catch (gatewayError) {
      logger.error("Failed to send error via gateway:", gatewayError);
      // Re-throw the original error
      throw error;
    }
  }
}

// Singleton error handler instance
const errorHandler = new WorkerErrorHandler();

// ============================================================================
// PROGRESS PROCESSOR
// ============================================================================

interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
  activeForm: string;
}

/**
 * Processes Claude CLI streaming updates and extracts user-friendly content
 * Implements chronological display with task progress and mixed text/tool output
 */
class ProgressProcessor {
  private currentTodos: TodoItem[] = [];
  private chronologicalOutput: string = "";

  /**
   * Process streaming update and return formatted content for Slack
   * Returns null if the update should be skipped
   * Now handles SDK message format directly
   */
  processUpdate(data: any): string | null {
    try {
      // Skip if no data
      if (!data || typeof data !== "object") {
        return null;
      }

      // Handle SDK message types
      switch (data.type) {
        case "assistant":
          return this.processAssistantMessage(data);

        case "tool_call":
          return this.processToolCall(data);

        case "result":
          // Final result from SDK - compare with what we accumulated
          if (data.result && String(data.result).trim()) {
            const resultText = String(data.result).trim();
            const accumulatedText = this.chronologicalOutput.trim();

            logger.info(`Result message length: ${resultText.length} chars`);
            logger.info(`Accumulated length: ${accumulatedText.length} chars`);
            logger.info(`Result starts with: ${resultText.substring(0, 100)}`);
            logger.info(
              `Accumulated starts with: ${accumulatedText.substring(0, 100)}`
            );

            // Check if result contains content not in accumulated
            if (!accumulatedText.includes(resultText.substring(0, 50))) {
              logger.warn(
                `⚠️  Result contains different content than accumulated text!`
              );
              logger.warn(`Result preview: ${resultText.substring(0, 200)}`);
            }
          }
          return null;

        case "system":
          // Skip system messages (init, completion, etc.)
          return null;

        case "error":
          logger.error(`SDK error: ${JSON.stringify(data.error)}`);
          return null;

        default:
          // For backwards compatibility with old subprocess format
          return this.processLegacyFormat(data);
      }
    } catch (error) {
      logger.error("Failed to process progress update:", error);
      return null;
    }
  }

  /**
   * Process SDK assistant messages
   * SDK wraps content in message.message.content structure
   */
  private processAssistantMessage(message: any): string | null {
    let hasUpdate = false;

    // SDK format: message.message.content (nested)
    const nestedMessage = message.message;
    const content = nestedMessage?.content || message.content;

    // Handle string content
    if (typeof content === "string" && content.trim()) {
      this.chronologicalOutput += `${content}\n`;
      hasUpdate = true;
    }
    // Handle content blocks (array format)
    else if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === "text" && block.text?.trim()) {
          this.chronologicalOutput += `${block.text}\n`;
          hasUpdate = true;
        } else if (block.type === "tool_use") {
          // Check for TodoWrite updates
          if (block.name === "TodoWrite" && block.input?.todos) {
            this.currentTodos = block.input.todos;
            hasUpdate = true;
          }
          // Format and append tool execution
          const toolExecution = this.formatToolExecution(block);
          logger.info(`🔧 Tool use: ${toolExecution}`);
          this.chronologicalOutput += `${toolExecution}\n`;
          hasUpdate = true;
        }
      }
    }

    return hasUpdate ? this.formatFullUpdate() : null;
  }

  /**
   * Process SDK tool call messages
   */
  private processToolCall(message: any): string | null {
    const toolExecution = this.formatToolExecution({
      name: message.tool_name,
      input: message.input,
    });
    logger.info(`🔧 Tool call: ${toolExecution}`);
    this.chronologicalOutput += `${toolExecution}\n`;
    return this.formatFullUpdate();
  }

  /**
   * Process legacy subprocess JSON format (for backwards compatibility)
   */
  private processLegacyFormat(data: any): string | null {
    // Try to extract TodoWrite from old format
    const dataStr = JSON.stringify(data);
    const todoData = this.extractTodoList(dataStr);
    if (todoData) {
      this.currentTodos = todoData;
      return this.formatFullUpdate();
    }

    // Try old assistant message format
    if (data.type === "assistant" && data.message?.content) {
      let hasUpdate = false;
      for (const contentItem of data.message.content) {
        if (contentItem.type === "text" && contentItem.text?.trim()) {
          this.chronologicalOutput += `${contentItem.text}\n`;
          hasUpdate = true;
        } else if (contentItem.type === "tool_use") {
          const toolExecution = this.formatToolExecution(contentItem);
          this.chronologicalOutput += `${toolExecution}\n`;
          hasUpdate = true;
        }
      }
      if (hasUpdate) {
        return this.formatFullUpdate();
      }
    }

    return null;
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
        }
      }
    } catch (_error) {
      // Not JSON or parsing failed
    }
    return null;
  }

  /**
   * Get the final formatted output including chronological history
   */
  getFinalOutput(finalSummary?: string): string {
    const sections: string[] = [];

    // Section 1: Task Progress (if todos exist)
    if (this.currentTodos.length > 0) {
      const todoLines = this.currentTodos.map((todo) => {
        const checkbox = todo.status === "completed" ? "☑️" : "☐";
        if (todo.status === "in_progress") {
          return `🪚 *${todo.activeForm}*`;
        }
        return `${checkbox} ${todo.content}`;
      });
      sections.push(`📝 **Task Progress**\n${todoLines.join("\n")}`);
    }

    // Section 2: Chronological output (text and tools mixed in order)
    if (this.chronologicalOutput.trim()) {
      const divider = this.currentTodos.length > 0 ? "━━━━━━━━━━━━━━" : "";
      sections.push(
        divider
          ? `${divider}\n${this.chronologicalOutput.trim()}`
          : this.chronologicalOutput.trim()
      );
    }

    // Section 3: Final summary (if provided)
    if (finalSummary?.trim()) {
      const divider = this.chronologicalOutput.trim() ? "\n━━━━━━━━━━━━━━" : "";
      sections.push(`${divider}\n${finalSummary.trim()}`);
    }

    // Join all sections
    return sections.filter((s) => s).join("\n");
  }

  /**
   * Format tool execution for user-friendly display in bullet lists
   */
  private formatToolExecution(toolUse: any): string {
    const toolName = toolUse.name;
    const params = toolUse.input || {};

    switch (toolName) {
      case "Write":
        return `└ ✏️ **Writing** \`${params.file_path}\``;
      case "Edit":
        return `└ ✏️ **Editing** \`${params.file_path}\``;
      case "Bash": {
        const command = params.command || params.description || "command";
        return `└ 👾 **Running** \`${command.length > 50 ? `${command.substring(0, 50)}...` : command}\``;
      }
      case "Read":
        return `└ 📖 **Reading** \`${params.file_path}\``;
      case "Grep":
        return `└ 🔍 **Searching** \`${params.pattern}\``;
      case "Glob":
        return `└ 🔍 **Finding** \`${params.pattern}\``;
      case "TodoWrite":
        return "└ 📝 Updating task list";
      case "WebFetch":
        return `└ 🌐 **Fetching** \`${params.url}\``;
      case "WebSearch":
        return `└ 🔎 **Searching web** \`${params.query}\``;
      default:
        return `└ 🔧 **Using** ${toolName}`;
    }
  }

  /**
   * Format full update with tasks and chronological output
   */
  private formatFullUpdate(): string {
    const sections: string[] = [];

    // Section 1: Task Progress (if todos exist)
    if (this.currentTodos.length > 0) {
      const todoLines = this.currentTodos.map((todo) => {
        const checkbox = todo.status === "completed" ? "☑️" : "☐";
        if (todo.status === "in_progress") {
          return `🪚 *${todo.activeForm}*`;
        }
        return `${checkbox} ${todo.content}`;
      });
      sections.push(`📝 **Task Progress**\n${todoLines.join("\n")}`);
    }

    // Section 2: Chronological output (text and tools mixed in order)
    if (this.chronologicalOutput.trim()) {
      const divider = this.currentTodos.length > 0 ? "━━━━━━━━━━━━━━" : "";
      sections.push(
        divider
          ? `${divider}\n${this.chronologicalOutput.trim()}`
          : this.chronologicalOutput.trim()
      );
    }

    // Join all sections
    return sections.filter((s) => s).join("\n");
  }
}

// ============================================================================
// CLAUDE WORKER
// ============================================================================

export class ClaudeWorker implements WorkerExecutor {
  private sessionRunner: ClaudeSessionRunner;
  private workspaceManager: WorkspaceManager;
  public gatewayIntegration: GatewayIntegration;
  private config: WorkerConfig;
  private progressProcessor: ProgressProcessor;

  constructor(config: WorkerConfig) {
    this.config = config;

    // Initialize components
    this.sessionRunner = new ClaudeSessionRunner();
    this.workspaceManager = new WorkspaceManager(config.workspace);
    this.progressProcessor = new ProgressProcessor();

    // Verify required environment variables
    const dispatcherUrl = process.env.DISPATCHER_URL;
    const workerToken = process.env.WORKER_TOKEN;

    if (!dispatcherUrl || !workerToken) {
      throw new Error(
        "DISPATCHER_URL and WORKER_TOKEN environment variables are required"
      );
    }

    // Determine session ID - only use actual IDs, not "continue"
    const sessionId =
      config.sessionId ||
      (config.resumeSessionId === "continue"
        ? undefined
        : config.resumeSessionId);

    this.gatewayIntegration = new GatewayIntegration(
      dispatcherUrl,
      workerToken,
      config.userId,
      config.channelId,
      config.threadTs || "",
      config.slackResponseTs,
      sessionId,
      config.botResponseTs
    );
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

  /**
   * Execute the worker job
   */
  async execute(): Promise<void> {
    const executeStartTime = Date.now();

    try {
      logger.info(
        `🚀 Starting Claude worker for session: ${this.config.sessionKey}`
      );
      logger.info(
        `[TIMING] Worker execute() started at: ${new Date(executeStartTime).toISOString()}`
      );

      // Decode user prompt
      const userPrompt = Buffer.from(this.config.userPrompt, "base64").toString(
        "utf-8"
      );
      logger.info(`User prompt: ${userPrompt.substring(0, 100)}...`);

      const isResumedSession = !!this.config.resumeSessionId;

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
            "session.key": this.config.sessionKey,
          },
        },
        async () => {
          await this.workspaceManager.setupWorkspace(
            this.config.userId,
            this.config.sessionKey
          );

          const { initModuleWorkspace } = await import(
            "./integrations/modules"
          );
          await initModuleWorkspace({
            workspaceDir: this.workspaceManager.getCurrentWorkingDirectory(),
            username: this.config.userId,
            sessionKey: this.config.sessionKey,
          });
        }
      );

      // Prepare session context
      let customInstructions = await this.generateCustomInstructions();

      // Call module onSessionStart hooks to allow modules to modify system prompt
      try {
        const { onSessionStart } = await import("./integrations/modules");
        const moduleContext = await onSessionStart({
          platform: "slack" as const,
          channelId: this.config.channelId,
          userId: this.config.userId,
          threadTs: this.config.threadTs,
          messageTs: this.config.slackResponseTs,
          workingDirectory: this.workspaceManager.getCurrentWorkingDirectory(),
          customInstructions,
        });
        // Update custom instructions with module modifications
        if (moduleContext.customInstructions) {
          customInstructions = moduleContext.customInstructions;
        }
      } catch (error) {
        logger.error("Failed to call onSessionStart hooks:", error);
      }

      const sessionContext = {
        platform: "slack" as const,
        channelId: this.config.channelId,
        userId: this.config.userId,
        userDisplayName: this.config.userId,
        threadTs: this.config.threadTs,
        messageTs: this.config.slackResponseTs,
        workingDirectory: this.workspaceManager.getCurrentWorkingDirectory(),
        customInstructions,
      };

      // Execute Claude session
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
              // Pass custom instructions as system prompt for higher priority
              ...(customInstructions
                ? { appendSystemPrompt: customInstructions }
                : {}),
              ...(this.config.resumeSessionId
                ? { resumeSessionId: this.config.resumeSessionId }
                : this.config.sessionId
                  ? { sessionId: this.config.sessionId }
                  : {}),
            },
            onProgress: async (update) => {
              if (!firstOutputLogged && update.type === "output") {
                logger.info(
                  `[TIMING] First Claude output at: ${new Date().toISOString()} (${Date.now() - claudeStartTime}ms after Claude start)`
                );
                firstOutputLogged = true;
              }
              if (update.type === "output" && update.data) {
                // Skip system messages - they should not be sent to Slack
                if (
                  typeof update.data === "object" &&
                  update.data.type === "system"
                ) {
                  logger.debug(
                    `Skipping system message: ${update.data.subtype || "unknown"}`
                  );
                  return;
                }

                // Process the update to extract user-friendly content
                const formattedContent = this.progressProcessor.processUpdate(
                  update.data
                );

                // Only send if we have formatted content (skip internal events)
                if (formattedContent) {
                  await this.gatewayIntegration.sendContent(formattedContent);
                }
              }
            },
          });
        }
      );

      // Collect module data before sending final response
      const { collectModuleData } = await import("./integrations/modules");
      const moduleData = await collectModuleData({
        workspaceDir: this.workspaceManager.getCurrentWorkingDirectory(),
        userId: this.config.userId,
        threadId: this.config.threadTs || "",
      });
      this.gatewayIntegration.setModuleData(moduleData);

      if (result.success) {
        // Get complete output from chronological history (no need for final summary - all text is already captured)
        const completeMessage = this.progressProcessor.getFinalOutput();
        const finalMessage = completeMessage?.trim()
          ? completeMessage
          : "✅ Task completed successfully";

        logger.info(
          `Sending final message via queue: ${finalMessage.substring(0, 200)}...`
        );
        await this.gatewayIntegration.signalDone(finalMessage);
      } else {
        const errorMsg = result.error || "Unknown error";

        // Check if this is a timeout (exit code 124)
        // Timeouts will be retried automatically, so don't signal error (no ❌ emoji)
        const isTimeout = result.exitCode === 124;

        if (isTimeout) {
          logger.info(
            `Session timed out (exit code 124) - will be retried automatically, not showing error to user`
          );
          // Don't send error content or signal error for timeouts (no ❌ emoji)
          // But still throw an error so pg-boss retries the job
          throw new Error("SESSION_TIMEOUT");
        } else {
          // For non-timeout errors, show the error to the user
          await this.gatewayIntegration.sendContent(
            `❌ Session failed: ${errorMsg}`
          );
          await this.gatewayIntegration.signalError(new Error(errorMsg));
        }
      }

      logger.info(
        `Worker completed with ${result.success ? "success" : "failure"}`
      );
    } catch (error) {
      // Use error handler to process and send appropriate error message
      await errorHandler.handleExecutionError(
        error,
        this.config,
        this.gatewayIntegration
      );
    }
  }

  /**
   * Generate custom instructions for Claude using modular providers
   */
  private async generateCustomInstructions(): Promise<string> {
    try {
      const builder = new InstructionBuilder();

      // Register all instruction providers
      builder.registerProvider(new CoreInstructionProvider());
      builder.registerProvider(new SlackInstructionProvider());
      builder.registerProvider(new ProjectsInstructionProvider());
      builder.registerProvider(new ProcessManagerInstructionProvider());

      // Build instructions with context
      const instructions = await builder.build({
        userId: this.config.userId,
        sessionKey: this.config.sessionKey,
        workingDirectory: this.workspaceManager.getCurrentWorkingDirectory(),
        availableProjects: this.listAppDirectories(
          this.workspaceManager.getCurrentWorkingDirectory()
        ),
      });

      logger.info(
        `[CUSTOM-INSTRUCTIONS] Generated ${instructions.length} characters`
      );
      logger.debug(`[CUSTOM-INSTRUCTIONS] \n${instructions}`);

      return instructions;
    } catch (error) {
      logger.error("Failed to generate custom instructions:", error);
      const fallback = `You are a helpful Claude Code agent for user ${this.config.userId}.`;
      logger.warn(`[CUSTOM-INSTRUCTIONS] Using fallback: ${fallback}`);
      return fallback;
    }
  }

  /**
   * Cleanup worker resources
   */
  async cleanup(): Promise<void> {
    try {
      logger.info("Cleaning up worker resources...");
      await this.sessionRunner.cleanupSession(this.config.sessionKey);
      logger.info("Worker cleanup completed");
    } catch (error) {
      logger.error("Error during cleanup:", error);
    }
  }

  /**
   * Get the gateway integration for sending updates
   * Implements WorkerExecutor interface
   */
  getGatewayIntegration(): GatewayIntegrationInterface | null {
    return this.gatewayIntegration;
  }
}

export type { WorkerConfig } from "./types";
