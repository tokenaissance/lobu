import { createLogger, ErrorCode, OrchestratorError } from "@peerbot/core";
import {
  type BaseDeploymentManager,
  generateDeploymentName,
  type OrchestratorConfig,
  type QueueJobData,
} from "./base-deployment-manager";
import { RedisQueue, type RedisQueueConfig } from "../infrastructure/queue";
import type {
  IMessageQueue,
  QueueJob as SharedQueueJob,
} from "../infrastructure/queue";
import type { ClaudeCredentialStore } from "../auth/claude/credential-store";
import * as Sentry from "@sentry/node";

const logger = createLogger("orchestrator");

export class MessageConsumer {
  private queue: IMessageQueue;
  private deploymentManager: BaseDeploymentManager;
  private config: OrchestratorConfig;
  private isRunning = false;
  private credentialStore?: ClaudeCredentialStore;
  private systemApiKey?: string;

  constructor(
    config: OrchestratorConfig,
    deploymentManager: BaseDeploymentManager,
    credentialStore?: ClaudeCredentialStore,
    systemApiKey?: string
  ) {
    this.config = config;
    this.deploymentManager = deploymentManager;
    this.credentialStore = credentialStore;
    this.systemApiKey = systemApiKey;

    // Parse Redis connection string
    const url = new URL(config.queues.connectionString);
    if (url.protocol !== "redis:") {
      throw new Error(
        `Unsupported queue protocol: ${url.protocol}. Only redis:// is supported.`
      );
    }

    const queueConfig: RedisQueueConfig = {
      host: url.hostname,
      port: Number.parseInt(url.port, 10) || 6379,
      password: url.password || undefined,
      db: url.pathname ? Number.parseInt(url.pathname.slice(1), 10) : 0,
      maxRetriesPerRequest: 3,
    };

    this.queue = new RedisQueue(queueConfig);
  }

  async start(): Promise<void> {
    try {
      await this.queue.start();
      this.isRunning = true;

      // Create the messages queue if it doesn't exist
      await this.queue.createQueue("messages");
      logger.info("✅ Created/verified messages queue");

      // Subscribe to the single messages queue for all messages
      await this.queue.work(
        "messages",
        async (job: SharedQueueJob<QueueJobData>) => {
          return await Sentry.startSpan(
            {
              name: "orchestrator.process_queue_job",
              op: "orchestrator.queue_processing",
              attributes: {
                "job.id": job?.id || "unknown",
              },
            },
            async () => {
              return this.handleMessage(job);
            }
          );
        }
      );

      logger.info("✅ Queue consumer started - listening for messages");
    } catch (error) {
      throw new OrchestratorError(
        ErrorCode.QUEUE_JOB_PROCESSING_FAILED,
        `Failed to start queue consumer: ${error instanceof Error ? error.message : String(error)}`,
        { error },
        true
      );
    }
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    await this.queue.stop();
  }

  /**
   * Handle all messages - creates deployment for new threads or routes to existing thread queues
   */
  private async handleMessage(
    job: SharedQueueJob<QueueJobData>
  ): Promise<void> {
    const data = job?.data;
    const jobId = job?.id || "unknown";

    logger.info("Processing job:", jobId);

    logger.info(
      `Processing message job ${jobId} for user ${data?.userId}, thread ${data?.threadId}`
    );

    try {
      // Check if user has credentials or if system API key is available
      if (this.credentialStore && !this.systemApiKey) {
        const hasCredentials = await this.credentialStore.hasCredentials(
          data.userId
        );

        if (!hasCredentials) {
          logger.info(
            `User ${data.userId} has no credentials - sending authentication prompt`
          );

          // Send ephemeral authentication prompt via thread_response queue
          await this.queue.createQueue("thread_response");
          await this.queue.send("thread_response", {
            messageId: data.messageId,
            userId: data.userId,
            channelId: data.channelId,
            threadId: data.threadId,
            ephemeral: true,
            content: JSON.stringify({
              blocks: [
                {
                  type: "section",
                  text: {
                    type: "mrkdwn",
                    text: "🔐 *Authentication Required*\n\nYou need to login with your Claude account to use this bot. Please visit the app home tab to authenticate.",
                  },
                },
                {
                  type: "actions",
                  elements: [
                    {
                      type: "button",
                      text: {
                        type: "plain_text",
                        text: "Login with Claude",
                      },
                      style: "primary",
                      action_id: "claude_auth_start",
                      value: "start_auth",
                    },
                  ],
                },
              ],
            }),
            processedMessageIds: [data.messageId],
          });

          logger.info(`✅ Sent authentication prompt to user ${data.userId}`);
          return; // Don't create worker
        }
      }

      // CRITICAL: For consistent worker naming, always use the targetThreadId if available
      // This ensures ALL messages in a Slack thread use the SAME worker
      // Thread ID must be the thread_ts (root message timestamp), NOT individual message timestamps!
      const effectiveThreadId =
        data.routingMetadata?.targetThreadId || data.threadId;

      const deploymentName = generateDeploymentName(
        data.userId,
        effectiveThreadId
      );

      logger.info(
        `Thread routing - effectiveThreadId: ${effectiveThreadId}, deploymentName: ${deploymentName}`
      );

      // 1) Send to thread queue immediately (Redis persists; worker will drain on attach)
      await Sentry.startSpan(
        {
          name: "orchestrator.send_to_worker_queue",
          op: "orchestrator.message_routing",
          attributes: {
            "user.id": data.userId,
            "thread.id": data.threadId,
            "deployment.name": deploymentName,
          },
        },
        async () => {
          await this.sendToWorkerQueue(data, deploymentName);
        }
      );

      logger.info(`✅ Enqueued message to thread queue for ${deploymentName}`);

      // 2) Ensure worker exists in the background (don't block queue send)
      (async () => {
        try {
          // Check if this is truly a new thread by looking for existing deployment
          const existingDeployments =
            await this.deploymentManager.listDeployments();
          const isNewThread = !existingDeployments.some(
            (d) => d.deploymentName === deploymentName
          );

          if (isNewThread) {
            logger.info(
              `New thread ${data.threadId} - creating deployment ${deploymentName}`
            );
            await this.deploymentManager.createWorkerDeployment(
              data.userId,
              data.threadId,
              data
            );
            logger.info(`✅ Created deployment: ${deploymentName}`);
          } else {
            logger.info(
              `Existing thread ${data.threadId} - ensuring worker ${deploymentName} exists`
            );
            try {
              await this.deploymentManager.scaleDeployment(deploymentName, 1);
              logger.info(`✅ Scaled existing worker ${deploymentName} to 1`);
            } catch (_error) {
              logger.info(
                `Worker ${deploymentName} doesn't exist, creating it for thread ${data.threadId}`
              );
              await this.deploymentManager.createWorkerDeployment(
                data.userId,
                data.threadId,
                data
              );
              logger.info(`✅ Created worker: ${deploymentName}`);
            }
          }

          // Update deployment activity annotation for simplified tracking
          await this.deploymentManager.updateDeploymentActivity(deploymentName);
        } catch (bgError) {
          logger.warn(
            `⚠️  Background ensure worker failed for ${deploymentName}:`,
            bgError instanceof Error ? bgError.message : String(bgError)
          );
        }
      })();

      logger.info(`✅ Message job ${jobId} queued successfully`);
    } catch (error) {
      Sentry.captureException(error);
      logger.error(`❌ Message job ${jobId} failed:`, error);

      // Re-throw for Redis retry handling
      throw new OrchestratorError(
        ErrorCode.QUEUE_JOB_PROCESSING_FAILED,
        `Failed to process message job: ${error instanceof Error ? error.message : String(error)}`,
        { jobId, data, error },
        true
      );
    }
  }

  /**
   * Send message to worker queue for the worker to consume
   */
  private async sendToWorkerQueue(
    data: QueueJobData,
    deploymentName: string
  ): Promise<void> {
    try {
      // Create thread-specific queue name: thread_message_[deploymentid]
      const threadQueueName = `thread_message_${deploymentName}`;

      // Create the thread-specific queue if it doesn't exist
      await this.queue.createQueue(threadQueueName);

      // Send message to thread-specific queue
      const jobId = await this.queue.send(
        threadQueueName,
        {
          ...data,
          // Add routing metadata
          routingMetadata: {
            deploymentName,
            threadId: data.threadId,
            userId: data.userId,
            timestamp: new Date().toISOString(),
          },
        },
        {
          expireInSeconds: this.config.queues.expireInSeconds,
          retryLimit: this.config.queues.retryLimit,
          retryDelay: this.config.queues.retryDelay,
          priority: 10, // Thread messages have high priority
        }
      );

      if (!jobId) {
        throw new OrchestratorError(
          ErrorCode.QUEUE_JOB_PROCESSING_FAILED,
          `queue.send() returned null/undefined for queue: ${threadQueueName}`,
          { threadQueueName, deploymentName },
          true
        );
      }

      logger.info(
        `✅ Sent message to thread queue ${threadQueueName} for thread ${data.threadId}, jobId: ${jobId}`
      );
    } catch (error) {
      logger.error(`❌ [ERROR] sendToWorkerQueue failed:`, error);
      throw new OrchestratorError(
        ErrorCode.QUEUE_JOB_PROCESSING_FAILED,
        `Failed to send message to thread queue: ${error instanceof Error ? error.message : String(error)}`,
        { deploymentName, data, error },
        true
      );
    }
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(): Promise<{
    messages?: {
      waiting: number;
      active: number;
      completed: number;
      failed: number;
    };
    isRunning: boolean;
    error?: string;
  }> {
    try {
      const stats = await this.queue.getQueueStats("messages");
      return {
        messages: stats,
        isRunning: this.isRunning,
      };
    } catch (error) {
      logger.error("Failed to get queue stats:", error);
      return {
        isRunning: this.isRunning,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
