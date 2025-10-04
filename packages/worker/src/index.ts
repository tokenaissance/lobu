#!/usr/bin/env bun

import { initSentry, createLogger } from "@peerbot/shared";

// Force rebuild to deploy MCP config fix - timestamp: 1756399400

// Initialize Sentry monitoring
initSentry();

import { moduleRegistry } from "../../../modules";

const logger = createLogger("worker");

import { QueuePersistentClaudeWorker } from "./persistent-task-worker";
import {
  startProcessManager,
  stopProcessManager,
} from "./process-manager-integration";
import { QueueIntegration } from "./task-queue-integration";

// Re-export ClaudeWorker for backward compatibility
export { ClaudeWorker } from "./claude-worker";

/**
 * Main entry point - now supports both queue-based and legacy workers
 */
async function main() {
  // Initialize available modules
  await moduleRegistry.initAll();
  logger.info("✅ Modules initialized");

  logger.info(
    "🔄 Starting in queue mode (dynamic deployment-based persistent worker)"
  );

  // Get user ID and optional target thread from environment
  const userId = process.env.USER_ID;
  const targetThreadId = process.env.TARGET_THREAD_ID; // Optional - for thread-specific workers

  if (!userId) {
    logger.error("❌ USER_ID environment variable is required for queue mode");
    process.exit(1);
  }

  try {
    // Set workspace directory for MCP process manager based on deployment name
    const deploymentName = process.env.DEPLOYMENT_NAME || process.env.HOSTNAME;
    if (deploymentName) {
      // Extract thread ID from deployment name (e.g., peerbot-worker-1756766056.836119)
      const threadMatch = deploymentName.match(/(\d+\.\d+)/);
      if (threadMatch) {
        const workspaceDir = `/workspace/${threadMatch[1]}`;
        process.env.WORKSPACE_DIR = workspaceDir;
        logger.info(
          `📁 Set WORKSPACE_DIR for process manager: ${workspaceDir}`
        );
      }
    }

    // Start the integrated process manager HTTP server
    const processManager = await startProcessManager();
    logger.info(`🔧 Process manager started on port ${processManager.port}`);

    const queueWorker = new QueuePersistentClaudeWorker(userId, targetThreadId);
    await queueWorker.start();

    // Keep the process running for persistent queue consumption
    process.on("SIGTERM", async () => {
      logger.info(
        "Received SIGTERM, shutting down queue worker and process manager..."
      );
      await queueWorker.stop();
      await stopProcessManager();
      process.exit(0);
    });

    process.on("SIGINT", async () => {
      logger.info(
        "Received SIGINT, shutting down queue worker and process manager..."
      );
      await queueWorker.stop();
      await stopProcessManager();
      process.exit(0);
    });

    // Keep process alive
    await new Promise(() => {
      // Keep process running indefinitely
    }); // Wait forever
  } catch (error) {
    logger.error("❌ Queue worker failed:", error);
    process.exit(1);
  }
}

// Handle process signals
process.on("SIGTERM", async () => {
  logger.info("Received SIGTERM, shutting down gracefully...");
  await appendTerminationMessage("SIGTERM");
  process.exit(0);
});

process.on("SIGINT", async () => {
  logger.info("Received SIGINT, shutting down gracefully...");
  await appendTerminationMessage("SIGINT");
  process.exit(0);
});

/**
 * Append termination message via queue when worker is terminated
 */
async function appendTerminationMessage(signal: string): Promise<void> {
  try {
    const databaseUrl = `postgresql://${process.env.PEERBOT_DATABASE_USERNAME}:${process.env.PEERBOT_DATABASE_PASSWORD}@${process.env.PEERBOT_DATABASE_HOST}:${process.env.PEERBOT_DATABASE_PORT}/peerbot`;

    const queueIntegration = new QueueIntegration({
      databaseUrl,
      responseChannel: process.env.SLACK_RESPONSE_CHANNEL,
      responseTs: process.env.SLACK_RESPONSE_TS,
      messageId: process.env.SLACK_RESPONSE_TS,
    });

    await queueIntegration.start();
    await queueIntegration.updateProgress(
      `🛑 *Worker terminated (${signal})* - The host is terminated and not processing further requests.`
    );
    await queueIntegration.signalDone();

    // Reactions are now handled by dispatcher based on message isDone status
    // No direct reaction calls needed here

    await queueIntegration.stop();
  } catch (error) {
    logger.error(
      `Failed to send ${signal} termination message via queue:`,
      error
    );
  }
}

export type { WorkerConfig } from "./types";

main();

// Cache bust Sat Aug 30 18:38:05 BST 2025
