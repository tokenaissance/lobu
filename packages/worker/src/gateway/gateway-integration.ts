/**
 * Gateway integration for sending worker responses to dispatcher via HTTP
 */

import { createLogger } from "@peerbot/core";
import type { GatewayIntegrationInterface } from "../core/types";
import type { ResponseData } from "./types";

const logger = createLogger("gateway-integration");

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
  public processedMessageIds: string[] = [];
  private jobId?: string;
  private moduleData?: Record<string, unknown>;
  private teamId?: string;
  private usedStreaming: boolean = false;
  private finalContent?: string;
  private lastStatus?: string;
  private accumulatedStreamContent: string = "";
  private lastStreamDelta: string = "";
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
      this.recentActivities.push(status);

      // Keep only last N activities
      if (this.recentActivities.length > this.maxActivities) {
        this.recentActivities.shift();
      }
    }

    const statusPayload: NonNullable<
      import("@peerbot/core").ThreadResponsePayload["statusUpdate"]
    > = { status };
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
        const normalizedFinal = this.normalizeForComparison(delta);
        const normalizedLastDelta = this.normalizeForComparison(
          this.lastStreamDelta
        );

        if (
          normalizedFinal.length > 0 &&
          normalizedFinal === normalizedLastDelta
        ) {
          logger.info(
            `✅ Final result matches last streamed delta (normalized) - skipping duplicate`
          );
          return;
        }

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
    this.lastStreamDelta = actualDelta;

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

  private normalizeForComparison(text: string): string {
    return text.replace(/\r\n/g, "\n").trim();
  }
}
