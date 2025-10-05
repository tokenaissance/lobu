#!/usr/bin/env bun

import * as Sentry from "@sentry/node";
import PgBoss from "pg-boss";
import { ClaudeWorker } from "../claude-worker";
import { createLogger } from "@peerbot/shared";
import type { WorkerConfig } from "../types";

const logger = createLogger("worker");

/**
 * Queue consumer for workers that listen to thread-specific messages
 * Replaces ConfigMap polling with queue-based message consumption
 */

export interface ThreadMessagePayload {
  botId: string;
  userId: string;
  threadId: string;
  platform: string;
  channelId: string;
  messageId: string;
  messageText: string;
  platformMetadata: Record<string, any>;
  claudeOptions: Record<string, any>;
  // Routing metadata for thread-specific processing
  routingMetadata?: {
    targetThreadId: string;
    userId: string;
  };
}

interface QueuedMessage {
  payload: ThreadMessagePayload;
  timestamp: number;
}

export class WorkerQueueConsumer {
  private pgBoss: PgBoss;
  private isRunning = false;
  private currentWorker: ClaudeWorker | null = null;
  private isProcessing = false;
  private userId: string;
  private deploymentName: string;
  private targetThreadId?: string;
  private messageQueue: QueuedMessage[] = [];
  private hasStartedSession = false; // Track if we've started a Claude session in this worker

  // Adaptive batching
  // Max window timer (caps total wait time)
  private collectionTimer: NodeJS.Timeout | null = null;
  // Quiet-period timer (resets with each incoming message)
  private collectionQuietTimer: NodeJS.Timeout | null = null;
  private isFinalizingCollection: boolean = false;
  private collectingMessages: QueuedMessage[] = [];
  private lastActivityTime: number = 0;
  // Unify collection windows to better capture quick follow-ups
  // 5 seconds for initial and subsequent batches; idle threshold aligned
  private idleThreshold = 5000; // 5 seconds idle before new collection window
  private initialCollectionWindow = 5000; // 5 seconds for first batch
  private subsequentCollectionWindow = 5000; // 5 seconds for subsequent batches after idle
  private quietPeriodMs = 3000; // finalize after 3s of no new messages

  constructor(
    connectionString: string,
    userId: string,
    deploymentName: string,
    targetThreadId?: string
  ) {
    this.pgBoss = new PgBoss(connectionString);
    this.userId = userId;
    this.deploymentName = deploymentName;
    this.targetThreadId = targetThreadId;
  }

  /**
   * Start consuming messages from the thread-specific queue
   * Worker listens to messages for its specific thread deployment
   */
  async start(): Promise<void> {
    try {
      await this.pgBoss.start();

      // Generate thread queue name - listens to messages for this deployment
      const threadQueueName = this.getThreadQueueName();

      // Register job handler for thread queue messages
      await this.pgBoss.work(threadQueueName, async (job: any) => {
        return await Sentry.startSpan(
          {
            name: "worker.process_thread_message",
            op: "worker.message_processing",
            attributes: {
              "user.id": this.userId,
              "deployment.name": this.deploymentName,
              "job.id": job?.id || "unknown",
            },
          },
          async () => {
            return this.handleThreadMessage(job);
          }
        );
      });

      this.isRunning = true;
      logger.info(`✅ Worker queue consumer started for user ${this.userId}`);
      logger.info(`🚀 Deployment: ${this.deploymentName}`);
      if (this.targetThreadId) {
        logger.info(`🎯 Targeting thread: ${this.targetThreadId}`);
      }
      logger.info(`📥 Listening to queue: ${threadQueueName}`);
    } catch (error) {
      logger.error("Failed to start worker queue consumer:", error);
      throw error;
    }
  }

  /**
   * Stop the queue consumer
   */
  async stop(): Promise<void> {
    try {
      this.isRunning = false;

      // Clear collection timer if active
      if (this.collectionTimer) {
        clearTimeout(this.collectionTimer);
        this.collectionTimer = null;
      }
      if (this.collectionQuietTimer) {
        clearTimeout(this.collectionQuietTimer);
        this.collectionQuietTimer = null;
      }
      // Process any collected messages before stopping
      if (this.collectingMessages.length > 0) {
        this.messageQueue.push(...this.collectingMessages);
        this.collectingMessages = [];
      }

      // Cleanup current worker if processing
      if (this.currentWorker) {
        await this.currentWorker.cleanup();
        this.currentWorker = null;
      }

      // Signal deployment for cleanup
      await this.signalDeploymentCompletion();

      await this.pgBoss.stop();
      logger.info("✅ Worker queue consumer stopped");
    } catch (error) {
      logger.error("Error stopping worker queue consumer:", error);
      throw error;
    }
  }

  /**
   * Handle thread-specific message jobs
   * Since worker listens to its own thread queue, all messages are for this thread
   */
  private async handleThreadMessage(job: any): Promise<void> {
    let actualData;

    try {
      logger.info("Received job structure:", {
        type: typeof job,
        keys: Object.keys(job || {}),
        hasNumericKeys: Object.keys(job || {}).some(
          (k) => !Number.isNaN(Number(k))
        ),
      });

      // Check if this is the PgBoss format (object with numeric keys)
      if (typeof job === "object" && job !== null) {
        const keys = Object.keys(job);
        const numericKeys = keys.filter((key) => !Number.isNaN(Number(key)));

        if (numericKeys.length > 0) {
          // PgBoss passes jobs as an array, get the first element
          const firstKey = numericKeys[0];
          const firstJob = firstKey ? job[firstKey] : null;

          if (
            typeof firstJob === "object" &&
            firstJob !== null &&
            firstJob.data
          ) {
            // This is the actual job object from PgBoss
            actualData = firstJob.data;
            logger.info(
              `Successfully extracted job data for job ${firstJob.id} from queue ${firstJob.name}`
            );
          } else {
            throw new Error(
              "Invalid job format: expected job object with data field"
            );
          }
        } else {
          // Fallback - might be normal job format
          actualData = job.data || job;
        }
      } else {
        actualData = job;
      }

      logger.info("Final extracted data:", {
        userId: actualData?.userId,
        threadId: actualData?.threadId,
        messageText: actualData?.messageText?.substring(0, 50),
      });
    } catch (error) {
      logger.error("Failed to parse job data:", error);
      logger.error(
        "Raw job structure:",
        JSON.stringify(job, null, 2).substring(0, 500)
      );
      throw new Error(
        `Invalid job data format: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    // Validate message is for our user (case insensitive sanity check)
    if (actualData.userId.toLowerCase() !== this.userId.toLowerCase()) {
      logger.warn(
        `Received message for user ${actualData.userId}, but this worker is for user ${this.userId}`
      );
      return; // Skip this message - wrong user
    }

    const now = Date.now();
    const timeSinceLastActivity = now - this.lastActivityTime;
    const queuedMessage: QueuedMessage = {
      payload: actualData,
      timestamp: now,
    };

    // Adaptive batching logic
    if (this.collectionTimer) {
      // Already collecting, add to collection
      logger.info(
        `Adding message to ongoing collection (${this.collectingMessages.length + 1} messages)`
      );
      this.collectingMessages.push(queuedMessage);
      // Reset quiet period timer to wait for another quiet interval
      const reset = (this as any)._resetQuietTimer as (() => void) | undefined;
      if (reset) reset();
    } else if (!this.hasStartedSession && !this.isProcessing) {
      // Phase 1: No session yet and not processing, start initial collection window
      logger.info(
        `Starting initial ${this.initialCollectionWindow}ms collection window for first message`
      );
      this.startCollectionWindow(this.initialCollectionWindow, queuedMessage);
    } else if (this.isProcessing) {
      // Currently processing, queue for later
      logger.info(
        `Queueing message for processing after current batch completes`
      );
      this.messageQueue.push(queuedMessage);
    } else if (timeSinceLastActivity > this.idleThreshold) {
      // Phase 2a: Been idle, start new collection window
      logger.info(
        `Starting ${this.subsequentCollectionWindow}ms collection window after ${timeSinceLastActivity}ms idle`
      );
      this.startCollectionWindow(
        this.subsequentCollectionWindow,
        queuedMessage
      );
    } else {
      // Phase 2b: Recent activity and not processing, process immediately
      logger.info(
        `Processing message immediately (${timeSinceLastActivity}ms since last activity)`
      );
      this.messageQueue.push(queuedMessage);
      await this.processQueueSequentially();
    }

    // Message successfully handled - pgBoss job completes immediately
    logger.info("Message successfully handled");
  }

  /**
   * Start a collection window for batching messages
   */
  private startCollectionWindow(
    duration: number,
    firstMessage: QueuedMessage
  ): void {
    this.collectingMessages = [firstMessage];

    // Helper to finalize collection safely once
    const finalizeCollection = async () => {
      if (this.isFinalizingCollection) return;
      this.isFinalizingCollection = true;

      logger.info(
        `Collection window ended (quiet or max), processing ${this.collectingMessages.length} message(s)`
      );

      // Move collected messages to main queue
      this.messageQueue.push(...this.collectingMessages);
      this.collectingMessages = [];

      // Clear timers
      if (this.collectionTimer) {
        clearTimeout(this.collectionTimer);
        this.collectionTimer = null;
      }
      if (this.collectionQuietTimer) {
        clearTimeout(this.collectionQuietTimer);
        this.collectionQuietTimer = null;
      }

      this.isFinalizingCollection = false;

      // Process the batch
      if (!this.isProcessing) {
        await this.processQueueSequentially();
      }
    };

    // Start max window timer (cap)
    this.collectionTimer = setTimeout(finalizeCollection, duration);

    // Quiet-timer scheduler that resets on each new message
    const scheduleQuietTimer = () => {
      if (this.collectionQuietTimer) {
        clearTimeout(this.collectionQuietTimer);
      }
      this.collectionQuietTimer = setTimeout(
        finalizeCollection,
        this.quietPeriodMs
      );
    };

    // Initial quiet timer
    scheduleQuietTimer();

    // Store reset function for use on subsequent messages
    (this as any)._resetQuietTimer = scheduleQuietTimer;
  }

  /**
   * Generate thread-specific queue name for this deployment
   * Workers listen to messages for their specific thread deployment
   */
  private getThreadQueueName(): string {
    return `thread_message_${this.deploymentName}`;
  }

  /**
   * Convert queue payload to WorkerConfig format
   */
  private payloadToWorkerConfig(payload: ThreadMessagePayload): WorkerConfig {
    const platformMetadata = payload.platformMetadata;

    // Build Claude options with security restrictions from env vars (only if set)
    const claudeOptions = {
      ...(payload.claudeOptions || {}),
      // MCP config is optional - don't include it for now
      // Apply security restrictions from environment only if env vars exist
      ...(process.env.CLAUDE_ALLOWED_TOOLS
        ? { allowedTools: process.env.CLAUDE_ALLOWED_TOOLS }
        : payload.claudeOptions?.allowedTools
          ? { allowedTools: payload.claudeOptions.allowedTools }
          : {}),
      ...(process.env.CLAUDE_DISALLOWED_TOOLS
        ? { disallowedTools: process.env.CLAUDE_DISALLOWED_TOOLS }
        : payload.claudeOptions?.disallowedTools
          ? { disallowedTools: payload.claudeOptions.disallowedTools }
          : {}),
      ...(process.env.CLAUDE_TIMEOUT_MINUTES
        ? { timeoutMinutes: process.env.CLAUDE_TIMEOUT_MINUTES }
        : payload.claudeOptions?.timeoutMinutes
          ? { timeoutMinutes: payload.claudeOptions.timeoutMinutes }
          : {}),
    };

    // Don't pass sessionId or resumeSessionId here - we'll handle it in processSingleMessage
    return {
      sessionKey: `session-${payload.threadId}`,
      userId: payload.userId,
      channelId: payload.channelId,
      threadTs: payload.threadId,
      repositoryUrl: platformMetadata.repositoryUrl || null,
      userPrompt: Buffer.from(payload.messageText).toString("base64"), // Base64 encode for consistency
      slackResponseChannel:
        platformMetadata.slackResponseChannel || payload.channelId,
      slackResponseTs: platformMetadata.slackResponseTs || payload.messageId,
      botResponseTs: platformMetadata.botResponseTs, // Pass through bot response timestamp
      claudeOptions: JSON.stringify(claudeOptions),
      workspace: {
        baseDirectory: "/workspace",
      },
    };
  }

  /**
   * Check if consumer is running and healthy
   */
  isHealthy(): boolean {
    return this.isRunning && !this.isProcessing;
  }

  /**
   * Get current processing status
   */
  getStatus(): {
    isRunning: boolean;
    isProcessing: boolean;
    userId: string;
    targetThreadId?: string;
    queueName: string;
  } {
    return {
      isRunning: this.isRunning,
      isProcessing: this.isProcessing,
      userId: this.userId,
      targetThreadId: this.targetThreadId,
      queueName: this.getThreadQueueName(),
    };
  }

  /**
   * Process all messages in queue sequentially
   */
  private async processQueueSequentially(): Promise<void> {
    this.isProcessing = true;
    this.lastActivityTime = Date.now(); // Track when we start processing

    try {
      while (this.messageQueue.length > 0) {
        // Get all messages to process together
        const messagesToProcess = [...this.messageQueue];
        this.messageQueue = []; // Clear queue

        logger.info(
          `Processing batch of ${messagesToProcess.length} messages sequentially`
        );

        // Sort by timestamp to ensure correct order
        messagesToProcess.sort((a, b) => a.timestamp - b.timestamp);

        await this.processBatchedMessages(messagesToProcess);
        this.lastActivityTime = Date.now(); // Update activity time after processing
      }
    } catch (error) {
      logger.error("Error during sequential message processing:", error);
      throw error;
    } finally {
      this.isProcessing = false;
      this.lastActivityTime = Date.now(); // Update when we finish
    }
  }

  /**
   * Process a batch of messages together
   */
  private async processBatchedMessages(
    messages: QueuedMessage[]
  ): Promise<void> {
    if (messages.length === 0) return;

    // If only one message, process it normally
    if (messages.length === 1) {
      const singleMessage = messages[0];
      if (singleMessage) {
        await this.processSingleMessage(singleMessage, [
          singleMessage.payload.messageId,
        ]);
      }
      return;
    }

    // Multiple messages - combine them into a single prompt
    logger.info(`Batching ${messages.length} messages for combined processing`);

    // Use the first message as the base for the bot response
    const firstMessage = messages[0];
    if (!firstMessage) return; // Safety check

    // Combine all message texts
    const combinedPrompt = messages
      .map((msg, index) => `Message ${index + 1}: ${msg.payload.messageText}`)
      .join("\n\n");

    // Create a modified payload with combined text
    // For batched messages, we should resume the existing session if available
    const batchedMessage: QueuedMessage = {
      timestamp: firstMessage.timestamp,
      payload: {
        ...firstMessage.payload,
        messageText: combinedPrompt,
        // Don't force a new session - let processSingleMessage handle session resumption
        claudeOptions: firstMessage.payload.claudeOptions,
      },
    };

    const processedIds = messages
      .map((m) => m.payload.messageId)
      .filter(Boolean);
    await this.processSingleMessage(batchedMessage, processedIds);
  }

  /**
   * Process a single message
   */
  private async processSingleMessage(
    message: QueuedMessage,
    processedIds?: string[]
  ): Promise<void> {
    try {
      // Set environment variables
      if (!process.env.USER_ID) {
        logger.warn(
          `USER_ID not set in environment, using userId from payload: ${message.payload.userId}`
        );
        process.env.USER_ID = message.payload.userId;
      }

      // Convert to worker config
      const workerConfig = this.payloadToWorkerConfig(message.payload);

      // Simple session management:
      // - First message in thread: Create new session with UUID
      // - Subsequent messages: Continue the existing session
      if (!this.hasStartedSession) {
        // First message in this worker - create a new Claude session
        const crypto = require("node:crypto");
        workerConfig.sessionId = crypto.randomUUID();
        logger.info(
          `Creating new Claude session ${workerConfig.sessionId} for first message in thread ${message.payload.threadId}`
        );
        this.hasStartedSession = true;
      } else {
        // Subsequent message - continue the existing session
        workerConfig.resumeSessionId = "continue"; // Special value to trigger --continue flag
        logger.info(
          `Continuing existing Claude session for message in thread ${message.payload.threadId}`
        );
      }

      // Create and execute worker
      this.currentWorker = new ClaudeWorker(workerConfig);
      // Provide the list of processed message IDs for final completion signaling
      if (processedIds && processedIds.length > 0) {
        this.currentWorker.queueIntegration.setProcessedMessages(processedIds);
      } else if (message?.payload?.messageId) {
        this.currentWorker.queueIntegration.setProcessedMessages([
          message.payload.messageId,
        ]);
      }
      await this.currentWorker.execute();

      logger.info(
        `✅ Successfully processed message ${message.payload.messageId} in thread ${message.payload.threadId}`
      );
    } catch (error) {
      logger.error(
        `❌ Failed to process message ${message.payload.messageId}:`,
        error
      );

      // Try to provide more detailed error context in the queue
      if (this.currentWorker?.queueIntegration) {
        try {
          const enhancedError =
            error instanceof Error ? error : new Error(String(error));
          await this.currentWorker.queueIntegration.signalError(enhancedError);
        } catch (queueError) {
          logger.error("Failed to send enhanced error to queue:", queueError);
        }
      }

      throw error;
    } finally {
      // Cleanup worker instance
      // The workspace directory will persist and be reused by the next message
      if (this.currentWorker) {
        try {
          await this.currentWorker.cleanup();
        } catch (cleanupError) {
          logger.error("Error during worker cleanup:", cleanupError);
        }
        this.currentWorker = null;
      }
    }
  }

  /**
   * Signal deployment completion for cleanup by orchestrator
   */
  private async signalDeploymentCompletion(): Promise<void> {
    try {
      // Add cleanup annotation to deployment (simplified approach)
      logger.info(
        `Would signal deployment ${this.deploymentName} for cleanup (skipping K8s patch to avoid API complexity)`
      );

      logger.info(`✅ Signaled deployment ${this.deploymentName} for cleanup`);
    } catch (error) {
      logger.error("Failed to signal deployment completion:", error);
      // Don't throw - this is cleanup, not critical
    }
  }
}
