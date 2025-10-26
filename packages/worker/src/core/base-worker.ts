#!/usr/bin/env bun

import { createLogger, type InstructionProvider } from "@peerbot/core";
import * as Sentry from "@sentry/node";
import { GatewayIntegration } from "../gateway/gateway-integration";
import { generateCustomInstructions } from "../instructions/builder";
import { WorkspaceManager } from "./workspace";
import { handleExecutionError } from "./error-handler";
import { listAppDirectories } from "./project-scanner";
import * as fs from "fs/promises";
import * as path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import type {
  GatewayIntegrationInterface,
  WorkerExecutor,
  WorkerConfig,
  ProgressUpdate,
  SessionExecutionResult,
} from "./types";

const logger = createLogger("base-worker");

/**
 * Abstract base class for AI agent workers
 * Handles common workflow: workspace setup, instruction generation, module integration
 * Subclasses implement agent-specific execution logic
 */
export abstract class BaseWorker implements WorkerExecutor {
  protected workspaceManager: WorkspaceManager;
  public gatewayIntegration: GatewayIntegration;
  protected config: WorkerConfig;

  constructor(config: WorkerConfig) {
    this.config = config;
    this.workspaceManager = new WorkspaceManager(config.workspace);

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
      config.resumeSessionId === "continue"
        ? undefined
        : config.resumeSessionId;

    this.gatewayIntegration = new GatewayIntegration(
      dispatcherUrl,
      workerToken,
      config.userId,
      config.channelId,
      config.threadId || "",
      config.responseId,
      sessionId,
      config.botResponseId,
      config.teamId
    );
  }

  /**
   * Get the agent name for logging (e.g., "Claude Code", "Codex")
   */
  protected abstract getAgentName(): string;

  /**
   * Get the core instruction provider for this agent
   */
  protected abstract getCoreInstructionProvider(): InstructionProvider;

  /**
   * Get initial loading messages for status display
   */
  protected abstract getLoadingMessages(isResumedSession: boolean): string[];

  /**
   * Execute the AI session with agent-specific logic
   * This is the main method that subclasses must implement
   */
  protected abstract runAISession(
    userPrompt: string,
    customInstructions: string,
    onProgress: (update: ProgressUpdate) => Promise<void>
  ): Promise<SessionExecutionResult>;

  /**
   * Process a progress update from the AI session
   * Returns delta content to send to gateway, or null if nothing to send
   */
  protected abstract processProgressUpdate(
    update: ProgressUpdate
  ): Promise<string | null>;

  /**
   * Get final result from AI session
   * Returns content to send as final message, or null if already sent
   */
  protected abstract getFinalResult(): {
    text: string;
    isFinal: boolean;
  } | null;

  /**
   * Reset progress processor state for new message
   */
  protected abstract resetProgressState(): void;

  /**
   * Cleanup session resources
   */
  protected abstract cleanupSession(sessionKey: string): Promise<void>;

  /**
   * Main execution workflow (template method pattern)
   * Handles all generic logic, delegates to abstract methods for agent-specific parts
   */
  async execute(): Promise<void> {
    const executeStartTime = Date.now();

    try {
      // Reset progress state for new message
      this.resetProgressState();

      logger.info(
        `🚀 Starting ${this.getAgentName()} worker for session: ${this.config.sessionKey}`
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

          const { initModuleWorkspace } = await import("../modules/lifecycle");
          await initModuleWorkspace({
            workspaceDir: this.workspaceManager.getCurrentWorkingDirectory(),
            username: this.config.userId,
            sessionKey: this.config.sessionKey,
          });
        }
      );

      // Setup I/O directories for file handling
      await this.setupIODirectories();

      // Download input files if any
      await this.downloadInputFiles();

      // Generate custom instructions
      let customInstructions = await generateCustomInstructions(
        this.getCoreInstructionProvider(),
        {
          userId: this.config.userId,
          sessionKey: this.config.sessionKey,
          workingDirectory: this.workspaceManager.getCurrentWorkingDirectory(),
          availableProjects: listAppDirectories(
            this.workspaceManager.getCurrentWorkingDirectory()
          ),
        }
      );

      // Add file I/O instructions
      customInstructions += this.getFileIOInstructions();

      // Call module onSessionStart hooks to allow modules to modify system prompt
      try {
        const { onSessionStart } = await import("../modules/lifecycle");
        const moduleContext = await onSessionStart({
          platform: this.config.platform || "slack",
          channelId: this.config.channelId,
          userId: this.config.userId,
          threadId: this.config.threadId,
          messageId: this.config.responseId,
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

      // Update status with loading messages
      const loadingMessages = this.getLoadingMessages(isResumedSession);
      await this.gatewayIntegration.updateStatus(
        "is running..",
        loadingMessages
      );

      // Execute AI session
      logger.info(
        `[TIMING] Starting ${this.getAgentName()} session at: ${new Date().toISOString()}`
      );
      const aiStartTime = Date.now();
      logger.info(
        `[TIMING] Total worker startup time: ${aiStartTime - executeStartTime}ms`
      );

      let firstOutputLogged = false;

      const result = await Sentry.startSpan(
        {
          name: `worker.${this.getAgentName().toLowerCase().replace(/\s+/g, "_")}_execution`,
          op: "ai.inference",
          attributes: {
            "user.id": this.config.userId,
            "session.key": this.config.sessionKey,
            "thread.id": this.config.threadId,
            agent: this.getAgentName(),
            is_resume: !!this.config.resumeSessionId,
          },
        },
        async () => {
          return await this.runAISession(
            userPrompt,
            customInstructions,
            async (update) => {
              if (!firstOutputLogged && update.type === "output") {
                logger.info(
                  `[TIMING] First ${this.getAgentName()} output at: ${new Date().toISOString()} (${Date.now() - aiStartTime}ms after start)`
                );
                firstOutputLogged = true;
              }

              // Handle status updates
              if (update.type === "status" && update.data?.status) {
                await this.gatewayIntegration.updateStatus(
                  update.data.status as string
                );
                return;
              }

              // Process progress updates (agent-specific)
              if (update.type === "output" && update.data) {
                const delta = await this.processProgressUpdate(update);
                if (delta) {
                  await this.gatewayIntegration.sendStreamDelta(delta, false);
                }
              }
            }
          );
        }
      );

      // Collect module data before sending final response
      const { collectModuleData } = await import("../modules/lifecycle");
      const moduleData = await collectModuleData({
        workspaceDir: this.workspaceManager.getCurrentWorkingDirectory(),
        userId: this.config.userId,
        threadId: this.config.threadId || "",
      });
      this.gatewayIntegration.setModuleData(moduleData);

      // Handle result
      if (result.success) {
        // Check if we have a final result to send as safety net
        const finalResult = this.getFinalResult();
        if (finalResult) {
          logger.info(
            `📤 Sending final result (${finalResult.text.length} chars) with deduplication flag`
          );
          await this.gatewayIntegration.sendStreamDelta(
            finalResult.text,
            false,
            finalResult.isFinal
          );
        } else {
          logger.info(
            "Session completed successfully - all content already streamed"
          );
        }
        await this.gatewayIntegration.signalDone();
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
          // But still throw an error so the queue retries the job
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
      await handleExecutionError(error, this.gatewayIntegration);
    }
  }

  /**
   * Cleanup worker resources
   */
  async cleanup(): Promise<void> {
    try {
      logger.info("Cleaning up worker resources...");
      await this.cleanupSession(this.config.sessionKey);
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

  /**
   * Get working directory for current session
   */
  protected getWorkingDirectory(): string {
    return this.workspaceManager.getCurrentWorkingDirectory();
  }

  /**
   * Setup input/output directories for file handling
   */
  private async setupIODirectories(): Promise<void> {
    const workspaceDir = this.workspaceManager.getCurrentWorkingDirectory();
    const inputDir = path.join(workspaceDir, "input");
    const outputDir = path.join(workspaceDir, "output");
    const tempDir = path.join(workspaceDir, "temp");

    // Create directories
    await fs.mkdir(inputDir, { recursive: true });
    await fs.mkdir(outputDir, { recursive: true });
    await fs.mkdir(tempDir, { recursive: true });

    // Clear output directory for clean session
    try {
      const files = await fs.readdir(outputDir);
      for (const file of files) {
        await fs.unlink(path.join(outputDir, file)).catch(() => {});
      }
    } catch (error) {
      logger.debug("Could not clear output directory:", error);
    }

    logger.info("I/O directories setup completed");
  }

  /**
   * Download input files from Slack
   */
  private async downloadInputFiles(): Promise<void> {
    const files = (this.config as any).platformMetadata?.files || [];
    if (files.length === 0) {
      return;
    }

    logger.info(`Downloading ${files.length} input files...`);
    const workspaceDir = this.workspaceManager.getCurrentWorkingDirectory();
    const inputDir = path.join(workspaceDir, "input");
    const dispatcherUrl = process.env.DISPATCHER_URL!;
    const workerToken = process.env.WORKER_TOKEN!;

    for (const file of files) {
      try {
        logger.info(`Downloading file: ${file.name} (${file.id})`);

        const response = await fetch(
          `${dispatcherUrl}/internal/files/download?fileId=${file.id}`,
          {
            headers: {
              Authorization: `Bearer ${workerToken}`,
            },
          }
        );

        if (!response.ok) {
          logger.error(
            `Failed to download file ${file.name}: ${response.statusText}`
          );
          continue;
        }

        const destPath = path.join(inputDir, file.name);
        const fileStream = Readable.fromWeb(response.body as any);
        const writeStream = (await import("fs")).createWriteStream(destPath);

        await pipeline(fileStream, writeStream);
        logger.info(`Downloaded: ${file.name} to input directory`);
      } catch (error) {
        logger.error(`Error downloading file ${file.name}:`, error);
      }
    }
  }

  /**
   * Get file I/O instructions for the AI agent
   */
  private getFileIOInstructions(): string {
    const workspaceDir = this.workspaceManager.getCurrentWorkingDirectory();
    return `

## File Generation & Output

**When to Create Files:**
Create and show files for any output that helps answer the user's request:
- **Charts & visualizations**: pie charts, bar graphs, plots, diagrams
- **Reports & documents**: analysis reports, summaries, PDFs  
- **Data files**: CSV exports, JSON data, spreadsheets
- **Code files**: scripts, configurations, examples
- **Images**: generated images, processed photos, screenshots

**Rule: Direct Execution = File Output**
When user gives direct instructions ("create chart", "generate report", "build app"):
1. Execute the task immediately with tools
2. Create output file if applicable
3. Use \`show_to_user\` tool to share the result

### Reading User Files
- Input files from the user: ${workspaceDir}/input/
- Example: \`cat ${workspaceDir}/input/data.csv\`
- Never show sensitive files (secrets, credentials, .env files)
`;
  }
}
