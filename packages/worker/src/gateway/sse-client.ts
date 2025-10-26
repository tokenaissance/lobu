/**
 * SSE client for receiving jobs from dispatcher
 */

import { createLogger } from "@peerbot/core";
import type { WorkerExecutor, WorkerConfig } from "../core/types";
import { GatewayIntegration } from "./gateway-integration";
import { MessageBatcher } from "./message-batcher";
import type { MessagePayload, QueuedMessage } from "./types";

const logger = createLogger("sse-client");

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

      // Worker will decide whether to continue session based on workspace state
      this.currentWorker = new ClaudeWorker(workerConfig);

      const gatewayIntegration = this.currentWorker.getGatewayIntegration();

      if (
        gatewayIntegration &&
        gatewayIntegration instanceof GatewayIntegration
      ) {
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

        gatewayIntegration.processedMessageIds = messageIds;
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
