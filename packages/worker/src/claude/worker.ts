#!/usr/bin/env bun

import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { createLogger } from "@peerbot/core";
import { BaseWorker } from "../core/base-worker";
import type { InstructionProvider } from "@peerbot/core";
import type {
  ProgressUpdate,
  SessionExecutionResult,
  WorkerConfig,
} from "../core/types";
import { ClaudeCoreInstructionProvider } from "./instructions";
import { ProgressProcessor } from "./processor";
import { type ClaudeExecutionOptions, runClaudeWithSDK } from "./sdk-adapter";
import * as fs from "fs/promises";
import * as path from "path";

const logger = createLogger("claude-worker");

// ============================================================================
// CLAUDE WORKER
// ============================================================================

/**
 * Claude Code worker implementation
 * Extends BaseWorker with Claude SDK-specific execution logic
 */
export class ClaudeWorker extends BaseWorker {
  private progressProcessor: ProgressProcessor;

  constructor(config: WorkerConfig) {
    super(config);
    this.progressProcessor = new ProgressProcessor();
  }

  protected getAgentName(): string {
    return "Claude Code";
  }

  protected getCoreInstructionProvider(): InstructionProvider {
    return new ClaudeCoreInstructionProvider();
  }

  protected getLoadingMessages(isResumedSession: boolean): string[] {
    return [
      isResumedSession ? "⚙️ resuming workspace" : "⚙️ setting up workspace",
      "⚙️ preparing Claude session",
      "🚀 starting Claude Code",
      "💭 thinking",
      "🔥 burning tokens",
    ];
  }

  protected async runAISession(
    userPrompt: string,
    customInstructions: string,
    onProgress: (update: ProgressUpdate) => Promise<void>
  ): Promise<SessionExecutionResult> {
    try {
      logger.info(`Creating Claude SDK session ${this.config.sessionKey}`);

      // Parse Claude options
      const agentOptions: ClaudeExecutionOptions = JSON.parse(
        this.config.agentOptions
      );

      // Check if Claude session exists in workspace
      const workspaceDir = this.getWorkingDirectory();
      const sessionExists = await this.checkClaudeSessionExists(workspaceDir);

      // Decide whether to continue or start new session
      const resumeSessionId = sessionExists ? "continue" : undefined;

      logger.info(
        sessionExists
          ? `Continuing existing Claude session for thread ${this.config.threadId}`
          : `Starting new Claude session for thread ${this.config.threadId}`
      );

      // Capture Claude session ID from progress callback
      let capturedClaudeSessionId: string | undefined;

      // Execute Claude with SDK
      const result = await runClaudeWithSDK(
        userPrompt,
        {
          ...agentOptions,
          appendSystemPrompt: customInstructions,
          ...(resumeSessionId ? { resumeSessionId } : {}),
        },
        async (update) => {
          // Capture session ID from completion event
          if (update.type === "completion" && update.data?.sessionId) {
            capturedClaudeSessionId = update.data.sessionId;
            logger.info(
              `Captured Claude session ID: ${capturedClaudeSessionId}`
            );
          }
          await onProgress(update);
        },
        this.getWorkingDirectory(),
        {
          channelId: this.config.channelId,
          threadId: this.config.threadId || "",
        }
      );

      return {
        ...result,
        sessionKey: this.config.sessionKey,
        persisted: false,
        storagePath: `${this.config.platform || "platform"}://thread`,
        claudeSessionId: capturedClaudeSessionId,
      };
    } catch (error) {
      logger.error(
        `Session ${this.config.sessionKey} execution failed:`,
        error
      );

      return {
        success: false,
        exitCode: 1,
        output: "",
        error: error instanceof Error ? error.message : "Unknown error",
        sessionKey: this.config.sessionKey,
      };
    }
  }

  protected async processProgressUpdate(
    update: ProgressUpdate
  ): Promise<string | null> {
    // Type guard to check if data is an SDKMessage
    const isSDKMessage = (data: unknown): data is SDKMessage => {
      return typeof data === "object" && data !== null && "type" in data;
    };

    // Skip system messages
    if (isSDKMessage(update.data) && update.data.type === "system") {
      logger.debug(
        `Skipping system message: ${"subtype" in update.data ? update.data.subtype : "unknown"}`
      );
      return null;
    }

    // Process the update to extract user-friendly content (only for SDKMessage types)
    if (!isSDKMessage(update.data)) {
      return null;
    }
    const processResult = this.progressProcessor.processUpdate(update.data);

    // Check if this is a final result message
    if (processResult?.isFinal) {
      this.progressProcessor.setFinalResult(processResult);
      logger.info(
        `📦 Stored final result (${processResult.text.length} chars) for deduplication`
      );
      return null;
    }

    // Show thinking content as status if present
    const thinkingContent = this.progressProcessor.getCurrentThinking();
    if (thinkingContent) {
      const maxLength = 100;
      const displayThinking =
        thinkingContent.length > maxLength
          ? `${thinkingContent.substring(0, maxLength)}...`
          : thinkingContent;
      logger.info(`💭 Sending thinking status update: ${displayThinking}`);
      await this.gatewayIntegration.updateStatus(displayThinking);
    }

    // Get delta and return
    return this.progressProcessor.getDelta();
  }

  protected getFinalResult(): { text: string; isFinal: boolean } | null {
    return this.progressProcessor.getFinalResult();
  }

  protected resetProgressState(): void {
    this.progressProcessor.reset();
  }

  protected async cleanupSession(sessionKey: string): Promise<void> {
    logger.info(`Cleanup for ${sessionKey} (no-op in stateless mode)`);
  }

  /**
   * Check if Claude CLI session exists
   * With HOME=/workspace, Claude SDK stores sessions in /workspace/.claude/
   */
  private async checkClaudeSessionExists(
    _workspaceDir: string
  ): Promise<boolean> {
    try {
      // Claude SDK stores sessions in HOME directory
      // Since HOME=/workspace, sessions are in /workspace/.claude/
      const homeDir = process.env.HOME || "/workspace";
      const claudeDir = path.join(homeDir, ".claude");
      const stats = await fs.stat(claudeDir);

      if (!stats.isDirectory()) {
        return false;
      }

      // Check if there are any session files
      const files = await fs.readdir(claudeDir);
      return files.length > 0;
    } catch {
      // Directory doesn't exist or not accessible
      return false;
    }
  }
}
