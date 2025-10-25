#!/usr/bin/env bun

import {
  createLogger,
  type AgentOptions,
  type ThreadResponsePayload,
} from "@peerbot/core";
import type {
  GatewayIntegrationInterface,
  WorkerExecutor,
  WorkerConfig,
} from "../core/types";

const logger = createLogger("gateway");

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

/**
 * Platform-specific metadata (e.g., Slack team_id, channel, thread_ts)
 */
export interface PlatformMetadata {
  team_id?: string;
  channel?: string;
  ts?: string;
  thread_ts?: string;
  [key: string]: string | number | boolean | undefined;
}

/**
 * Message payload for agent execution
 */
export interface MessagePayload {
  botId: string;
  userId: string;
  threadId: string;
  platform: string;
  channelId: string;
  messageId: string;
  messageText: string;
  platformMetadata: PlatformMetadata;
  agentOptions: AgentOptions;
  jobId?: string; // Optional job ID from gateway
  routingMetadata?: {
    targetThreadId: string;
    userId: string;
  };
}

export interface QueuedMessage {
  payload: MessagePayload;
  timestamp: number;
}

/**
 * Response data sent back to gateway
 */
type ResponseData = ThreadResponsePayload & {
  originalMessageId: string;
};

export interface BatcherConfig {
  onBatchReady?: (messages: QueuedMessage[]) => Promise<void>;
  batchWindowMs?: number;
}

// ============================================================================
// MESSAGE BATCHER
// ============================================================================

/**
 * Simple message batcher - collects messages for a short window, then processes
 */
export class MessageBatcher {
  private messageQueue: QueuedMessage[] = [];
  private isProcessing = false;
  private batchTimer: NodeJS.Timeout | null = null;
  private readonly batchWindowMs: number;
  private readonly onBatchReady?: (messages: QueuedMessage[]) => Promise<void>;

  constructor(config: BatcherConfig = {}) {
    this.batchWindowMs = config.batchWindowMs ?? 2000; // 2 second window by default
    this.onBatchReady = config.onBatchReady;
  }

  async addMessage(message: QueuedMessage): Promise<void> {
    this.messageQueue.push(message);

    // If already processing, message will be picked up in next batch
    if (this.isProcessing) {
      logger.info(
        `Message queued (${this.messageQueue.length} pending, processing in progress)`
      );
      return;
    }

    // If no batch timer running, start one
    if (!this.batchTimer) {
      logger.info(
        `Starting ${this.batchWindowMs}ms batch window (${this.messageQueue.length} message(s))`
      );
      this.batchTimer = setTimeout(() => {
        this.processBatch();
      }, this.batchWindowMs);
    } else {
      logger.info(
        `Message added to batch window (${this.messageQueue.length} pending)`
      );
    }
  }

  private async processBatch(): Promise<void> {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    if (this.messageQueue.length === 0) {
      return;
    }

    this.isProcessing = true;

    try {
      const messagesToProcess = [...this.messageQueue];
      this.messageQueue = [];

      logger.info(`Processing batch of ${messagesToProcess.length} messages`);
      messagesToProcess.sort((a, b) => a.timestamp - b.timestamp);

      if (this.onBatchReady) {
        await this.onBatchReady(messagesToProcess);
      }

      // If more messages arrived during processing, start new batch
      if (this.messageQueue.length > 0 && !this.batchTimer) {
        logger.info(
          `Starting new batch window for ${this.messageQueue.length} queued messages`
        );
        this.batchTimer = setTimeout(() => {
          this.processBatch();
        }, this.batchWindowMs);
      }
    } catch (error) {
      logger.error("Error during batch processing:", error);
      throw error;
    } finally {
      this.isProcessing = false;
    }
  }

  stop(): void {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
  }

  isCurrentlyProcessing(): boolean {
    return this.isProcessing;
  }

  getPendingCount(): number {
    return this.messageQueue.length;
  }
}

// ============================================================================
// GATEWAY INTEGRATION
// ============================================================================

/**
 * Gateway integration for sending worker responses to dispatcher via HTTP
 */
export class GatewayIntegration implements GatewayIntegrationInterface {
  private dispatcherUrl: string;
  private workerToken: string;
  private userId: string;
  private channelId: string;
  private threadId: string;
  private originalMessageTs: string;
  private claudeSessionId?: string;
  private botResponseTs?: string;
  private processedMessageIds: string[] = [];
  private jobId?: string;
  private moduleData?: Record<string, unknown>;
  private teamId?: string;
  private usedStreaming: boolean = false;
  private finalContent?: string;
  private lastStatus?: string;
  private accumulatedStreamContent: string = "";
  private recentActivities: string[] = [];
  private readonly maxActivities = 5;

  constructor(
    dispatcherUrl: string,
    workerToken: string,
    userId: string,
    channelId: string,
    threadId: string,
    originalMessageTs: string,
    claudeSessionId: string | undefined = undefined,
    botResponseTs: string | undefined = undefined,
    teamId: string | undefined = undefined,
    processedMessageIds: string[] = []
  ) {
    this.dispatcherUrl = dispatcherUrl;
    this.workerToken = workerToken;
    this.userId = userId;
    this.channelId = channelId;
    this.threadId = threadId;
    this.originalMessageTs = originalMessageTs;
    this.claudeSessionId = claudeSessionId;
    this.botResponseTs = botResponseTs;
    this.teamId = teamId;
    this.processedMessageIds = processedMessageIds;
  }

  setJobId(jobId: string): void {
    this.jobId = jobId;
  }

  setModuleData(moduleData: Record<string, unknown>): void {
    this.moduleData = moduleData;
  }

  /**
   * Add emoji prefix to activity based on content
   */
  private addEmojiToActivity(activity: string): string {
    // If already has emoji, return as-is
    if (/^[\u{1F300}-\u{1F9FF}]|^[\u{2600}-\u{26FF}]/u.test(activity)) {
      return activity;
    }

    // Add appropriate emoji based on activity type
    if (activity.includes("running") || activity.includes("executing"))
      return `⚡ ${activity}`;
    if (activity.includes("reading") || activity.includes("loading"))
      return `📖 ${activity}`;
    if (activity.includes("writing") || activity.includes("saving"))
      return `📝 ${activity}`;
    if (activity.includes("editing")) return `✏️ ${activity}`;
    if (activity.includes("searching") || activity.includes("finding"))
      return `🔍 ${activity}`;
    if (activity.includes("thinking") || activity.includes("analyzing"))
      return `💭 ${activity}`;
    if (activity.includes("launching") || activity.includes("starting"))
      return `🚀 ${activity}`;
    if (activity.includes("fetching") || activity.includes("downloading"))
      return `🌐 ${activity}`;
    if (activity.includes("asking")) return `❓ ${activity}`;
    if (activity.includes("updating")) return `🔄 ${activity}`;
    if (
      activity.includes("setting up") ||
      activity.includes("preparing") ||
      activity.includes("resuming")
    )
      return `⚙️ ${activity}`;
    if (activity.includes("burning")) return `🔥 ${activity}`;

    // Default emoji
    return `🔧 ${activity}`;
  }

  async updateStatus(
    status: string,
    loadingMessages?: string[]
  ): Promise<void> {
    // Skip duplicate status updates
    if (status === this.lastStatus && status !== "") {
      return;
    }

    this.lastStatus = status || undefined;

    // Add status to recent activities if non-empty
    if (status && status.trim() !== "") {
      const activityWithEmoji = this.addEmojiToActivity(status);
      this.recentActivities.push(activityWithEmoji);

      // Keep only last N activities
      if (this.recentActivities.length > this.maxActivities) {
        this.recentActivities.shift();
      }
    }

    const statusPayload: NonNullable<ThreadResponsePayload["statusUpdate"]> = {
      status,
    };
    // Use provided loadingMessages or fall back to tracked activities
    if (loadingMessages && loadingMessages.length > 0) {
      statusPayload.loadingMessages = loadingMessages;
    } else if (this.recentActivities.length > 0) {
      statusPayload.loadingMessages = [...this.recentActivities];
    }

    await this.sendResponse({
      messageId: this.originalMessageTs,
      channelId: this.channelId,
      threadId: this.threadId,
      userId: this.userId,
      timestamp: Date.now(),
      originalMessageId: this.originalMessageTs,
      claudeSessionId: this.claudeSessionId,
      botResponseId: this.botResponseTs,
      statusUpdate: statusPayload,
    });
  }

  async signalDone(finalDelta?: string, fullContent?: string): Promise<void> {
    // Store full content for completion signal
    if (fullContent) {
      this.finalContent = fullContent;
    }

    // Send final delta if there is one
    if (finalDelta) {
      await this.sendStreamDelta(finalDelta);
    }
    await this.signalCompletion();
  }

  async sendContent(content: string): Promise<void> {
    await this.sendResponse({
      messageId: this.originalMessageTs,
      channelId: this.channelId,
      threadId: this.threadId,
      userId: this.userId,
      content,
      timestamp: Date.now(),
      originalMessageId: this.originalMessageTs,
      claudeSessionId: this.claudeSessionId,
      botResponseId: this.botResponseTs,
      moduleData: this.moduleData,
    });
  }

  async sendStreamDelta(
    delta: string,
    isFullReplacement: boolean = false,
    isFinal: boolean = false
  ): Promise<void> {
    // Mark that streaming was used
    this.usedStreaming = true;

    let actualDelta = delta;

    // Handle final result with deduplication
    if (isFinal) {
      logger.info(`🔍 Processing final result with deduplication`);
      logger.info(`Final text length: ${delta.length} chars`);
      logger.info(
        `Accumulated length: ${this.accumulatedStreamContent.length} chars`
      );

      // Check if final result is identical to what we've already sent
      if (delta === this.accumulatedStreamContent) {
        logger.info(
          `✅ Final result is identical to accumulated content - skipping duplicate`
        );
        return;
      }

      // Check if accumulated content is a prefix of final result
      if (delta.startsWith(this.accumulatedStreamContent)) {
        // Only send the missing part
        actualDelta = delta.slice(this.accumulatedStreamContent.length);
        if (actualDelta.length === 0) {
          logger.info(
            `✅ Final result fully contained in accumulated content - skipping`
          );
          return;
        }
        logger.info(
          `📝 Final result has ${actualDelta.length} new chars - sending delta only`
        );
      } else if (this.accumulatedStreamContent.length > 0) {
        // Content differs - log warning and send full final result
        logger.warn(`⚠️  Final result differs from accumulated content!`);
        logger.warn(
          `First 100 chars of accumulated: ${this.accumulatedStreamContent.substring(0, 100)}`
        );
        logger.warn(`First 100 chars of final: ${delta.substring(0, 100)}`);
        logger.info(`📤 Sending full final result (${delta.length} chars)`);
      }
    }

    // Track accumulated content for deduplication
    if (!isFullReplacement) {
      this.accumulatedStreamContent += actualDelta;
    } else {
      this.accumulatedStreamContent = actualDelta;
    }

    await this.sendResponse({
      messageId: this.originalMessageTs,
      channelId: this.channelId,
      threadId: this.threadId,
      userId: this.userId,
      teamId: this.teamId,
      delta: actualDelta,
      timestamp: Date.now(),
      originalMessageId: this.originalMessageTs,
      claudeSessionId: this.claudeSessionId,
      botResponseId: this.botResponseTs,
      moduleData: this.moduleData,
      isStreamDelta: true, // Mark as streaming delta
      isFullReplacement, // Indicate if stream should be restarted
    });
  }

  async signalCompletion(): Promise<void> {
    await this.sendResponse({
      messageId: this.originalMessageTs,
      channelId: this.channelId,
      threadId: this.threadId,
      userId: this.userId,
      teamId: this.teamId,
      timestamp: Date.now(),
      originalMessageId: this.originalMessageTs,
      processedMessageIds: this.processedMessageIds,
      claudeSessionId: this.claudeSessionId,
      botResponseId: this.botResponseTs,
      moduleData: this.moduleData,
      finalContent: this.finalContent, // Include final content
      usedStreaming: this.usedStreaming, // Include streaming flag
    });
  }

  async signalError(error: Error): Promise<void> {
    await this.sendResponse({
      messageId: this.originalMessageTs,
      channelId: this.channelId,
      threadId: this.threadId,
      userId: this.userId,
      error: error.message,
      timestamp: Date.now(),
      originalMessageId: this.originalMessageTs,
      claudeSessionId: this.claudeSessionId,
      botResponseId: this.botResponseTs,
    });
  }

  private async sendResponse(data: ResponseData): Promise<void> {
    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const responseUrl = `${this.dispatcherUrl}/worker/response`;
        const payload = this.jobId ? { jobId: this.jobId, ...data } : data;

        // Log the payload for debugging
        logger.info(
          `[WORKER-HTTP] Sending to ${responseUrl}: ${JSON.stringify(payload).substring(0, 500)}`
        );
        if (payload.isStreamDelta) {
          logger.info(
            `[WORKER-HTTP] Stream delta payload: isStreamDelta=${payload.isStreamDelta}, deltaLength=${payload.delta?.length}`
          );
        }

        const response = await fetch(responseUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.workerToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          throw new Error(
            `Failed to send response to dispatcher: ${response.status} ${response.statusText}`
          );
        }

        logger.debug("Response sent to dispatcher successfully");
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        logger.warn(
          `Failed to send response (attempt ${attempt + 1}/${maxRetries}):`,
          error
        );

        if (attempt < maxRetries - 1) {
          const delay = 1000 * 2 ** attempt;
          logger.debug(`Retrying in ${delay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    logger.error(
      "All retry attempts failed for sending response to dispatcher"
    );
    throw lastError;
  }
}

// ============================================================================
// GATEWAY CLIENT
// ============================================================================

/**
 * Gateway client for workers - connects to dispatcher via SSE
 * Receives jobs via SSE stream, sends responses via HTTP POST
 */
export class GatewayClient {
  private dispatcherUrl: string;
  private workerToken: string;
  private userId: string;
  private deploymentName: string;
  private isRunning = false;
  private currentWorker: WorkerExecutor | null = null;
  private hasStartedSession = false;
  private abortController?: AbortController;
  private currentJobId?: string;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private messageBatcher: MessageBatcher;

  constructor(
    dispatcherUrl: string,
    workerToken: string,
    userId: string,
    deploymentName: string
  ) {
    this.dispatcherUrl = dispatcherUrl;
    this.workerToken = workerToken;
    this.userId = userId;
    this.deploymentName = deploymentName;

    this.messageBatcher = new MessageBatcher({
      onBatchReady: async (messages) => {
        await this.processBatchedMessages(messages);
      },
    });
  }

  async start(): Promise<void> {
    this.isRunning = true;

    while (this.isRunning) {
      try {
        await this.connectAndListen();
        if (!this.isRunning) break;
        await this.handleReconnect();
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          logger.info("SSE connection aborted");
          break;
        }
        logger.error("SSE connection error:", error);
        if (!this.isRunning) break;
        await this.handleReconnect();
      }
    }
  }

  private async connectAndListen(): Promise<void> {
    this.abortController = new AbortController();
    const streamUrl = `${this.dispatcherUrl}/worker/stream`;

    logger.info(
      `Connecting to dispatcher at ${streamUrl} (attempt ${this.reconnectAttempts + 1})`
    );

    const response = await fetch(streamUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.workerToken}`,
        Accept: "text/event-stream",
      },
      signal: this.abortController.signal,
    });

    if (!response.ok) {
      throw new Error(
        `Failed to connect to dispatcher: ${response.status} ${response.statusText}`
      );
    }

    logger.info("✅ Connected to dispatcher via SSE");
    this.reconnectAttempts = 0;

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();

    if (!reader) {
      throw new Error("No response body");
    }

    let buffer = "";

    while (this.isRunning) {
      const { done, value } = await reader.read();

      if (done) {
        logger.info("SSE stream ended");
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      const events = buffer.split("\n\n");
      buffer = events.pop() || "";

      for (const event of events) {
        if (!event.trim()) continue;

        const lines = event.split("\n");
        let eventType = "message";
        let eventData = "";

        for (const line of lines) {
          if (line.startsWith("event:")) {
            eventType = line.substring(6).trim();
          } else if (line.startsWith("data:")) {
            eventData = line.substring(5).trim();
          }
        }

        if (eventData) {
          await this.handleEvent(eventType, eventData);
        }
      }
    }
  }

  private async handleReconnect(): Promise<void> {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error("Max reconnection attempts reached, giving up");
      this.isRunning = false;
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * 2 ** (this.reconnectAttempts - 1), 60000);

    logger.info(
      `Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`
    );

    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  async stop(): Promise<void> {
    try {
      this.isRunning = false;

      if (this.abortController) {
        this.abortController.abort();
      }

      this.messageBatcher.stop();

      if (this.currentWorker) {
        await this.currentWorker.cleanup();
        this.currentWorker = null;
      }

      logger.info("✅ Gateway client stopped");
    } catch (error) {
      logger.error("Error stopping gateway client:", error);
      throw error;
    }
  }

  private async handleEvent(eventType: string, data: string): Promise<void> {
    try {
      if (eventType === "connected") {
        const connData = JSON.parse(data);
        logger.info(
          `Connected to dispatcher for deployment ${connData.deploymentName}`
        );
        return;
      }

      if (eventType === "ping") {
        logger.debug("Received heartbeat ping from dispatcher");
        return;
      }

      if (eventType === "job") {
        const jobData = JSON.parse(data);
        await this.handleThreadMessage(jobData);
      }
    } catch (error) {
      logger.error(`Error handling event ${eventType}:`, error);
    }
  }

  private async handleThreadMessage(data: MessagePayload): Promise<void> {
    if (data.jobId) {
      this.currentJobId = data.jobId;
      logger.debug(`Received job ${data.jobId}`);
    }

    if (data.userId.toLowerCase() !== this.userId.toLowerCase()) {
      logger.warn(
        `Received message for user ${data.userId}, but this worker is for user ${this.userId}`
      );
      return;
    }

    const queuedMessage: QueuedMessage = {
      payload: data,
      timestamp: Date.now(),
    };

    await this.messageBatcher.addMessage(queuedMessage);
    logger.info("Message successfully handled");
  }

  private async processBatchedMessages(
    messages: QueuedMessage[]
  ): Promise<void> {
    if (messages.length === 0) return;

    if (messages.length === 1) {
      const singleMessage = messages[0];
      if (singleMessage) {
        await this.processSingleMessage(singleMessage, [
          singleMessage.payload.messageId,
        ]);
      }
      return;
    }

    logger.info(`Batching ${messages.length} messages for combined processing`);

    const firstMessage = messages[0];
    if (!firstMessage) return;

    const combinedPrompt = messages
      .map((msg, index) => `Message ${index + 1}: ${msg.payload.messageText}`)
      .join("\n\n");

    const batchedMessage: QueuedMessage = {
      timestamp: firstMessage.timestamp,
      payload: {
        ...firstMessage.payload,
        messageText: combinedPrompt,
        agentOptions: firstMessage.payload.agentOptions,
      },
    };

    const processedIds = messages
      .map((m) => m.payload.messageId)
      .filter(Boolean);
    await this.processSingleMessage(batchedMessage, processedIds);
  }

  private async processSingleMessage(
    message: QueuedMessage,
    processedIds?: string[]
  ): Promise<void> {
    // Dynamic import to avoid circular dependency
    const { ClaudeWorker } = await import("../claude/worker");

    try {
      if (!process.env.USER_ID) {
        logger.warn(
          `USER_ID not set in environment, using userId from payload: ${message.payload.userId}`
        );
        process.env.USER_ID = message.payload.userId;
      }

      const workerConfig = this.payloadToWorkerConfig(message.payload);

      if (!this.hasStartedSession) {
        const crypto = require("node:crypto");
        workerConfig.sessionId = crypto.randomUUID();
        logger.info(
          `Creating new Claude session ${workerConfig.sessionId} for first message in thread ${message.payload.threadId}`
        );
        this.hasStartedSession = true;
      } else {
        workerConfig.resumeSessionId = "continue";
        logger.info(
          `Continuing existing Claude session for message in thread ${message.payload.threadId}`
        );
      }

      this.currentWorker = new ClaudeWorker(workerConfig);

      const gatewayIntegration = this.currentWorker.getGatewayIntegration();

      if (gatewayIntegration) {
        if (this.currentJobId) {
          gatewayIntegration.setJobId(this.currentJobId);
        }

        // Set processedMessageIds directly on the integration instance
        const messageIds =
          processedIds && processedIds.length > 0
            ? processedIds
            : message?.payload?.messageId
              ? [message.payload.messageId]
              : [];

        (gatewayIntegration as any).processedMessageIds = messageIds;
      }

      await this.currentWorker.execute();

      this.currentJobId = undefined;

      logger.info(
        `✅ Successfully processed message ${message.payload.messageId} in thread ${message.payload.threadId}`
      );
    } catch (error) {
      logger.error(
        `❌ Failed to process message ${message.payload.messageId}:`,
        error
      );

      const gatewayIntegration = this.currentWorker?.getGatewayIntegration();
      if (gatewayIntegration) {
        try {
          const enhancedError =
            error instanceof Error ? error : new Error(String(error));
          await gatewayIntegration.signalError(enhancedError);
        } catch (errorSendError) {
          logger.error("Failed to send error to dispatcher:", errorSendError);
        }
      }

      throw error;
    } finally {
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

  private payloadToWorkerConfig(payload: MessagePayload): WorkerConfig {
    const platformMetadata = payload.platformMetadata;

    const agentOptions = {
      ...(payload.agentOptions || {}),
      ...(payload.agentOptions?.allowedTools
        ? { allowedTools: payload.agentOptions.allowedTools }
        : {}),
      ...(payload.agentOptions?.disallowedTools
        ? { disallowedTools: payload.agentOptions.disallowedTools }
        : {}),
      ...(payload.agentOptions?.timeoutMinutes
        ? { timeoutMinutes: payload.agentOptions.timeoutMinutes }
        : {}),
    };

    return {
      sessionKey: `session-${payload.threadId}`,
      userId: payload.userId,
      channelId: payload.channelId,
      threadId: payload.threadId,
      userPrompt: Buffer.from(payload.messageText).toString("base64"),
      responseChannel: String(
        platformMetadata.responseChannel || payload.channelId
      ),
      responseId: String(platformMetadata.responseId || payload.messageId),
      botResponseId: platformMetadata.botResponseId
        ? String(platformMetadata.botResponseId)
        : undefined,
      teamId: platformMetadata.teamId
        ? String(platformMetadata.teamId)
        : undefined,
      platform: payload.platform || "slack",
      agentOptions: JSON.stringify(agentOptions),
      workspace: {
        baseDirectory: "/workspace",
      },
    };
  }

  isHealthy(): boolean {
    return this.isRunning && !this.messageBatcher.isCurrentlyProcessing();
  }

  getStatus(): {
    isRunning: boolean;
    isProcessing: boolean;
    userId: string;
    deploymentName: string;
    pendingMessages: number;
  } {
    return {
      isRunning: this.isRunning,
      isProcessing: this.messageBatcher.isCurrentlyProcessing(),
      userId: this.userId,
      deploymentName: this.deploymentName,
      pendingMessages: this.messageBatcher.getPendingCount(),
    };
  }
}
