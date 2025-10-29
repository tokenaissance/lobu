#!/usr/bin/env bun

import type { Options as SDKOptions } from "@anthropic-ai/claude-agent-sdk";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { createLogger } from "@peerbot/core";
import type { ProgressCallback } from "../core/types";
import { ensureBaseUrl } from "../core/url-utils";
import { createCustomToolsServer } from "./custom-tools";
import { getSessionContext } from "./session-manager";

const logger = createLogger("claude-sdk");

// ============================================================================
// TYPES
// ============================================================================

// Claude-specific execution options
export interface ClaudeExecutionOptions {
  allowedTools?: string | string[];
  disallowedTools?: string | string[];
  maxTurns?: string;
  systemPrompt?: string;
  appendSystemPrompt?: string;
  claudeEnv?: string;
  fallbackModel?: string;
  timeoutMinutes?: string | number;
  model?: string;
  continue?: boolean;
}

export interface ClaudeExecutionResult {
  success: boolean;
  exitCode: number;
  output: string;
  error?: string;
}

// ============================================================================
// SDK EXECUTION
// ============================================================================

/**
 * Execute Claude session using the SDK
 */
export async function runClaudeWithSDK(
  userPrompt: string,
  options: ClaudeExecutionOptions,
  onProgress?: ProgressCallback,
  workingDirectory?: string,
  customToolsConfig?: { channelId: string; threadId: string }
): Promise<ClaudeExecutionResult> {
  logger.info("Starting Claude SDK execution");

  try {
    // Fetch session context (MCP config + gateway instructions) in a single request
    const { mcpServers, gatewayInstructions } = await getSessionContext();

    const normalizeToolList = (
      value?: string | string[]
    ): string[] | undefined => {
      if (!value) {
        return undefined;
      }

      const rawList = Array.isArray(value) ? value : value.split(/[,\n]/);

      const cleaned = rawList
        .map((entry) =>
          typeof entry === "string" ? entry.trim() : String(entry).trim()
        )
        .filter((entry) => entry.length > 0);

      if (cleaned.length === 0) {
        return undefined;
      }

      return Array.from(new Set(cleaned));
    };

    // Authentication flow:
    // 1. Worker sets ANTHROPIC_API_KEY to its worker token (not a real API key)
    // 2. Claude SDK sends worker token in x-api-key header to gateway
    // 3. Gateway proxy validates token, extracts userId, and swaps with real API key
    // 4. Gateway forwards request to Anthropic with real credentials
    const workerToken = process.env.WORKER_TOKEN;
    const dispatcherUrl = process.env.DISPATCHER_URL;

    if (!workerToken) {
      throw new Error("WORKER_TOKEN is required for Claude SDK authentication");
    }

    // Track errors from stderr
    let stderrError: Error | null = null;

    const sdkOptions: SDKOptions = {
      model: options.model,
      cwd: workingDirectory || process.cwd(),
      permissionMode: "bypassPermissions",
      strictMcpConfig: false, // Allow MCP failures without stopping execution
      env: {
        ...process.env,
        DEBUG: "0",
        // Use worker token as API key - SDK will send this in x-api-key header
        ANTHROPIC_API_KEY: workerToken,
        // Proxy all Anthropic API requests through gateway
        ...(dispatcherUrl
          ? {
              ANTHROPIC_BASE_URL: `${ensureBaseUrl(dispatcherUrl)}/api/anthropic`,
            }
          : {}),
      },
      stderr: (message: string) => {
        logger.error(`[Claude CLI stderr] ${message}`);
      },
    };

    // Add session management
    if (options.continue) {
      sdkOptions.continue = true;
      logger.info("Continuing most recent Claude session");
    }

    // Add system prompts
    // Merge gateway instructions (platform + MCP) with worker instructions
    const mergedInstructions = [
      gatewayInstructions, // From gateway (platform + MCP built from status)
      options.appendSystemPrompt, // From worker (core + projects + process manager)
    ]
      .filter(Boolean)
      .join("\n\n");

    if (options.systemPrompt && mergedInstructions) {
      sdkOptions.systemPrompt = {
        type: "preset",
        preset: "claude_code",
        append: mergedInstructions,
      };
      logger.info(
        `Using merged instructions: gateway (${gatewayInstructions.length} chars) + worker (${options.appendSystemPrompt?.length || 0} chars)`
      );
    } else if (options.systemPrompt) {
      sdkOptions.systemPrompt = options.systemPrompt;
    }

    // Add MCP servers (merge gateway MCP servers with custom tools)
    const allMcpServers = { ...mcpServers };

    // Add custom tools server if config provided
    if (customToolsConfig && dispatcherUrl && workerToken) {
      const customTools = createCustomToolsServer(
        dispatcherUrl,
        workerToken,
        customToolsConfig.channelId,
        customToolsConfig.threadId
      );
      allMcpServers.peerbot = customTools;
      logger.info("Added custom tools server: peerbot");
    }

    if (Object.keys(allMcpServers).length > 0) {
      sdkOptions.mcpServers = allMcpServers;
      logger.info(
        `MCP servers configured: ${Object.keys(allMcpServers).join(", ")}`
      );
    }

    // Add tool restrictions
    const allowedTools = normalizeToolList(options.allowedTools);
    if (allowedTools) {
      sdkOptions.allowedTools = allowedTools;
    }

    const disallowedTools = normalizeToolList(options.disallowedTools);
    if (disallowedTools) {
      sdkOptions.disallowedTools = disallowedTools;
    }

    // Add max turns
    if (options.maxTurns) {
      const maxTurnsNum = parseInt(options.maxTurns, 10);
      if (!Number.isNaN(maxTurnsNum) && maxTurnsNum > 0) {
        sdkOptions.maxTurns = maxTurnsNum;
      }
    }

    logger.info(`SDK options: ${JSON.stringify(sdkOptions, null, 2)}`);

    // Execute query
    const response = query({
      prompt: userPrompt,
      options: sdkOptions,
    });

    let output = "";
    let capturedSessionId: string | undefined;
    let messageCount = 0;
    let lastMessageTime = Date.now();
    let hasSuccessfulResult = false;

    // Process streaming responses with timeout check
    const messageIterator = response[Symbol.asyncIterator]();
    let iteratorDone = false;

    while (!iteratorDone) {
      // Don't check for stderr errors here - we need to process all messages first
      // Errors will be checked after the loop completes

      const messagePromise = messageIterator.next();

      const result = await Promise.race([
        messagePromise,
        // timeoutPromise
      ]);

      if (result.done) {
        iteratorDone = true;
        break;
      }

      const message = result.value;

      messageCount++;
      const now = Date.now();
      const timeSinceLastMessage = now - lastMessageTime;
      lastMessageTime = now;

      logger.info(
        `SDK message #${messageCount} (${timeSinceLastMessage}ms since last): ${message.type}`,
        {
          messageType: message.type,
          subtype: "subtype" in message ? message.subtype : undefined,
          timeSinceLastMessage,
        }
      );

      // Send progress updates
      if (onProgress) {
        await onProgress({
          type: "output",
          data: message,
          timestamp: Date.now(),
        });
      }

      // Handle different message types
      switch (message.type) {
        case "system":
          if (message.subtype === "init") {
            capturedSessionId = message.session_id;
            logger.info(`SDK session started: ${capturedSessionId}`);
          }
          logger.info(`System message subtype: ${message.subtype}`, {
            subtype: message.subtype,
            sessionId: message.session_id,
          });
          break;

        case "assistant": {
          const assistantMsg = message.message;
          if (assistantMsg && Array.isArray(assistantMsg.content)) {
            logger.info(
              `Assistant message (${assistantMsg.content.length} blocks)`
            );
            for (const block of assistantMsg.content) {
              if (block.type === "text" && block.text) {
                logger.info(`  Text block: ${block.text.substring(0, 100)}`);
                output += `${block.text}\n`;
              } else if (block.type === "tool_use") {
                logger.info(
                  `🔧 Tool use: ${block.name} with params: ${JSON.stringify(block.input)}`
                );
              }
            }
          } else {
            logger.warn(`Unexpected assistant message structure`, {
              hasMessage: "message" in message,
              messageType: typeof message.message,
            });
          }
          break;
        }

        case "result": {
          if (message.subtype === "success" && "result" in message) {
            const resultStr = String(message.result);
            logger.info(
              `SDK result received (${resultStr.length} chars): ${resultStr.substring(0, 200)}`
            );
            output = resultStr;
            hasSuccessfulResult = true;
            // Clear any stderr errors since we got a successful result
            // (Claude CLI may log post-completion errors like metrics opt-out checks)
            stderrError = null;
          } else {
            logger.warn(`Result message without success: ${message.subtype}`, {
              subtype: message.subtype,
              isError: message.is_error,
            });
          }
          break;
        }

        case "stream_event":
          logger.debug(`Stream event received`);
          break;

        case "user": {
          const userMsg = message.message;
          if (userMsg?.content?.[0]?.type === "tool_result") {
            logger.debug(`Tool result returned to Claude`);
          }
          break;
        }
      }
    }

    // Final check for stderr errors after loop completes
    // Skip if we already received a successful result (post-completion errors are benign)
    if (stderrError && !hasSuccessfulResult) {
      logger.error("Error detected in stderr after message loop completed");
      throw stderrError;
    } else if (stderrError && hasSuccessfulResult) {
      logger.info(
        "Ignoring post-completion stderr error (session completed successfully)"
      );
    }

    logger.info(
      `Claude SDK execution completed successfully (${messageCount} messages received, final output: ${output.length} chars)`
    );

    // Call completion callback
    if (onProgress) {
      await onProgress({
        type: "completion",
        data: { success: true, sessionId: capturedSessionId },
        timestamp: Date.now(),
      });
    }

    return {
      success: true,
      exitCode: 0,
      output: output.trim(),
    };
  } catch (error) {
    logger.error("Claude SDK execution failed:", {
      error,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
      errorType: error?.constructor?.name,
      errorKeys:
        error && typeof error === "object" ? Object.keys(error) : undefined,
    });

    const errorMessage = error instanceof Error ? error.message : String(error);

    // Call error callback
    if (onProgress) {
      await onProgress({
        type: "error",
        data: { error: errorMessage },
        timestamp: Date.now(),
      });
    }

    return {
      success: false,
      exitCode: 1,
      output: "",
      error: errorMessage,
    };
  }
}
