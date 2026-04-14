/**
 * Message handler bridge — connects Chat SDK events to the message queue.
 * Bridges all 9 feature gaps: history, agent auto-creation, provider setup,
 * settings links, allowlist, audio transcription, etc.
 */

import {
  createLogger,
  createRootSpan,
  flushTracing,
  generateTraceId,
} from "@lobu/core";
import type Redis from "ioredis";
import type { CommandDispatcher } from "../commands/command-dispatcher";
import { createChatReply } from "../commands/command-reply-adapters";
import type { ArtifactStore } from "../files/artifact-store";
import type { CoreServices } from "../platform";
import {
  buildMessagePayload,
  hasConfiguredProvider,
  resolveAgentId,
  resolveAgentOptions,
} from "../services/platform-helpers";
import type { ChatInstanceManager } from "./chat-instance-manager";
import type { PlatformConnection } from "./types";

const logger = createLogger("chat-message-bridge");

const MAX_HISTORY_MESSAGES = 10;
const HISTORY_TTL_SECONDS = 86400; // 24 hours

interface HistoryEntry {
  role: "user" | "assistant";
  content: string;
  authorName?: string;
  timestamp: number;
}

/**
 * Inbound file shape passed to the worker on platformMetadata.files.
 * `downloadUrl` is a signed, time-limited public artifact URL the worker
 * can fetch over the proxy without any platform-specific auth.
 */
export interface IngestedFile {
  id: string;
  name: string;
  mimetype: string;
  size: number;
  downloadUrl: string;
}

const AUDIO_MIMES_PREFIX = ["audio/"] as const;
const AUDIO_MIMES_EXACT = new Set(["application/ogg"]);

function isAudioAttachment(mime: string | undefined): boolean {
  if (!mime) return false;
  if (AUDIO_MIMES_EXACT.has(mime)) return true;
  return AUDIO_MIMES_PREFIX.some((p) => mime.startsWith(p));
}

function deriveFilename(
  attachment: { name?: string; mimeType?: string; type?: string },
  index: number
): string {
  if (attachment.name?.trim()) return attachment.name.trim();
  const ext = attachment.mimeType?.split("/")[1]?.split(";")[0];
  const stem = attachment.type || "attachment";
  return ext ? `${stem}-${index + 1}.${ext}` : `${stem}-${index + 1}`;
}

export function isSenderAllowed(
  allowFrom: string[] | undefined,
  userId: string
): boolean {
  if (!Array.isArray(allowFrom)) {
    return true;
  }
  return allowFrom.includes(userId);
}

/**
 * Register Chat SDK event handlers for a connection.
 */
export function registerMessageHandlers(
  chat: any,
  connection: PlatformConnection,
  services: CoreServices,
  manager: ChatInstanceManager,
  commandDispatcher?: CommandDispatcher
): void {
  const handler = new MessageHandlerBridge(
    connection,
    services,
    manager,
    commandDispatcher
  );

  chat.onNewMention(async (thread: any, message: any) => {
    await handler.handleMessage(thread, message, "mention");
  });

  chat.onDirectMessage(async (thread: any, message: any) => {
    await handler.handleMessage(thread, message, "dm");
  });

  chat.onSubscribedMessage(async (thread: any, message: any) => {
    await handler.handleMessage(thread, message, "subscribed");
  });
}

class MessageHandlerBridge {
  private redis: Redis;
  private artifactStore: ArtifactStore;
  private publicGatewayUrl: string;

  constructor(
    private connection: PlatformConnection,
    private services: CoreServices,
    private manager: ChatInstanceManager,
    private commandDispatcher?: CommandDispatcher
  ) {
    this.redis = services.getQueue().getRedisClient();
    this.artifactStore = services.getArtifactStore();
    this.publicGatewayUrl = services.getPublicGatewayUrl();
  }

  /**
   * Fetch every inbound attachment via the chat SDK's auth-aware
   * `Attachment.fetchData()` and publish each as a gateway artifact.
   * The returned list is what the worker sees on `platformMetadata.files`,
   * with `downloadUrl` pointing at a signed public URL it can fetch over
   * its egress proxy — no platform-specific auth ever crosses the
   * gateway/worker boundary.
   *
   * Audio attachments still need their bytes for transcription, so we hand
   * the raw buffer back via the `audioBytes` slot rather than re-fetching.
   */
  private async ingestAttachments(message: {
    attachments?: Array<{
      data?: Buffer | Blob;
      fetchData?: () => Promise<Buffer>;
      mimeType?: string;
      name?: string;
      size?: number;
      type?: string;
    }>;
  }): Promise<{
    files: IngestedFile[];
    audioBytes: Array<{ buffer: Buffer; mimeType: string }>;
  }> {
    const attachments = message.attachments;
    if (!attachments?.length) return { files: [], audioBytes: [] };

    const files: IngestedFile[] = [];
    const audioBytes: Array<{ buffer: Buffer; mimeType: string }> = [];

    for (let i = 0; i < attachments.length; i++) {
      const att = attachments[i]!;
      try {
        let buffer: Buffer | undefined;
        if (att.data) {
          buffer = Buffer.isBuffer(att.data)
            ? att.data
            : Buffer.from(await (att.data as Blob).arrayBuffer());
        } else if (att.fetchData) {
          buffer = await att.fetchData();
        }
        if (!buffer || buffer.length === 0) {
          logger.warn(
            { mimeType: att.mimeType, type: att.type, name: att.name },
            "Skipping inbound attachment with no fetchable data"
          );
          continue;
        }
        const mimeType = att.mimeType || "application/octet-stream";
        if (isAudioAttachment(mimeType)) {
          audioBytes.push({ buffer, mimeType });
        }
        const filename = deriveFilename(att, i);
        const published = await this.artifactStore.publish({
          buffer,
          filename,
          contentType: mimeType,
          publicGatewayUrl: this.publicGatewayUrl,
        });
        files.push({
          id: published.artifactId,
          name: published.filename,
          mimetype: published.contentType,
          size: published.size,
          downloadUrl: published.downloadUrl,
        });
      } catch (error) {
        logger.error(
          {
            error: String(error),
            mimeType: att.mimeType,
            type: att.type,
            name: att.name,
          },
          "Failed to ingest inbound attachment"
        );
      }
    }

    return { files, audioBytes };
  }

  async handleMessage(
    thread: any,
    message: any,
    source: "mention" | "dm" | "subscribed"
  ): Promise<void> {
    const { connection } = this;

    // Guard: drop messages if the connection was stopped/removed
    if (!this.manager.has(connection.id)) {
      logger.info(
        { connectionId: connection.id },
        "Connection no longer active, dropping message"
      );
      return;
    }

    const platform = connection.platform;
    const userId = message.author?.userId ?? "unknown";
    const channelId = thread.channelId ?? thread.id ?? "unknown";
    const messageId = message.id ?? String(Date.now());
    const isGroup = source === "mention" || source === "subscribed";

    logger.info(
      {
        connectionId: connection.id,
        platform,
        userId,
        channelId,
        messageId,
        source,
      },
      "Processing inbound message"
    );

    // Gap 6: Allowlist check
    if (!isSenderAllowed(connection.settings?.allowFrom, userId)) {
      logger.info({ userId }, "Blocked by allowlist");
      return;
    }

    // Gap 6: Group check
    if (isGroup && connection.settings?.allowGroups === false) {
      logger.info({ channelId }, "Groups not allowed");
      return;
    }

    // Subscribe to thread for follow-up messages
    if (source === "mention" || source === "dm") {
      try {
        await thread.subscribe();
      } catch {
        // some platforms may not support subscribe
      }
    }

    // Gap 2: Resolve agent ID
    const { agentId } = await resolveAgentId({
      platform,
      userId,
      channelId,
      isGroup,
    });

    // Gap 2: Auto-create agent metadata
    const agentMetadataStore = this.services.getAgentMetadataStore();
    const userAgentsStore = this.services.getUserAgentsStore();
    if (agentMetadataStore) {
      const existing = await agentMetadataStore.getMetadata(agentId);
      if (!existing) {
        const agentName = isGroup
          ? `${platform} Group ${channelId}`
          : `${platform} ${message.author?.fullName || userId}`;
        await agentMetadataStore.createAgent(
          agentId,
          agentName,
          platform,
          userId,
          { parentConnectionId: this.connection.id }
        );
        await userAgentsStore?.addAgent(platform, userId, agentId);
        logger.info({ agentId, userId }, "Auto-created agent");

        // Clone settings from template agent if connection has one
        if (this.connection.templateAgentId) {
          try {
            const agentSettingsStore = this.services.getAgentSettingsStore();
            if (agentSettingsStore) {
              const templateSettings = await agentSettingsStore.getSettings(
                this.connection.templateAgentId
              );
              if (templateSettings) {
                const { buildDefaultSettingsFromSource } = await import(
                  "../auth/settings/template-utils"
                );
                const cloned = buildDefaultSettingsFromSource(templateSettings);
                cloned.templateAgentId = this.connection.templateAgentId;
                await agentSettingsStore.saveSettings(agentId, cloned);
                logger.info(
                  {
                    agentId,
                    templateAgentId: this.connection.templateAgentId,
                  },
                  "Cloned settings from template agent"
                );
              }
            }
          } catch (error) {
            logger.warn(
              {
                agentId,
                templateAgentId: this.connection.templateAgentId,
                error: String(error),
              },
              "Failed to clone template agent settings"
            );
          }
        }
      }
    }

    // Ingest every inbound attachment as an artifact, regardless of type.
    // Workers consume them via `platformMetadata.files`; we never hand the
    // worker platform-specific file IDs or bot tokens.
    const { files: ingestedFiles, audioBytes } =
      await this.ingestAttachments(message);

    // Gap 7: Audio transcription — runs over the bytes we already fetched.
    let messageText = message.text ?? "";
    const transcriptionService = this.services.getTranscriptionService();
    if (transcriptionService && audioBytes.length > 0) {
      for (const audio of audioBytes) {
        try {
          const result = await transcriptionService.transcribe(
            audio.buffer,
            agentId,
            audio.mimeType
          );
          if ("text" in result && result.text) {
            messageText = messageText
              ? `${messageText}\n\n[Voice message]: ${result.text}`
              : result.text;
          }
        } catch (error) {
          logger.warn(
            { error: String(error), messageId },
            "Audio transcription failed"
          );
        }
      }
    }

    // Remove bot mention from text
    const botUsername = this.manager.getInstance(this.connection.id)?.connection
      .metadata.botUsername;
    if (botUsername) {
      messageText = messageText.replace(`@${botUsername}`, "").trim();
    }

    // Intercept /new and /clear before slash dispatch
    let sessionReset = false;
    const trimmedLower = messageText.trim().toLowerCase();
    if (trimmedLower === "/new") {
      messageText = "Starting new session.";
      sessionReset = true;
    } else if (trimmedLower === "/clear") {
      const historyKey = `chat:history:${this.connection.id}:${channelId}`;
      await this.redis.del(historyKey);
      await thread.post({ text: "Chat history cleared." });
      return;
    }

    // Slash command dispatch — intercept before queueing to worker
    if (!sessionReset && this.commandDispatcher) {
      const handled = await this.commandDispatcher.tryHandleSlashText(
        messageText,
        {
          platform,
          userId,
          channelId,
          isGroup,
          conversationId: messageId,
          connectionId: this.connection.id,
          reply: createChatReply((content) => thread.post(content)),
        }
      );
      if (handled) return;
    }

    // Gap 1: Retrieve conversation history from Redis
    const historyKey = `chat:history:${this.connection.id}:${channelId}`;
    const conversationHistory = await this.getHistory(historyKey);

    // Gap 1: Store inbound message
    await this.appendHistory(historyKey, {
      role: "user",
      content: messageText,
      authorName: message.author?.fullName,
      timestamp: Date.now(),
    });

    // Build payload and enqueue
    const traceId = generateTraceId(messageId);
    const agentSettingsStore = this.services.getAgentSettingsStore();

    // Create root span for distributed tracing
    const { span: rootSpan, traceparent } = createRootSpan("message_received", {
      "lobu.agent_id": agentId,
      "lobu.message_id": messageId,
      "lobu.platform": platform,
      "lobu.connection_id": this.connection.id,
    });

    try {
      // Check if agent has any provider credentials before enqueuing
      if (!(await hasConfiguredProvider(agentId, agentSettingsStore))) {
        await thread.post(
          "No AI provider is configured yet. Provider setup is not available in the end-user chat flow yet. Ask an admin to connect a provider for the base agent."
        );
        return;
      }

      const agentOptions = await resolveAgentOptions(
        agentId,
        {},
        agentSettingsStore
      );

      const payload = buildMessagePayload({
        platform,
        userId,
        botId: platform,
        conversationId: isGroup ? messageId : channelId,
        teamId: isGroup ? channelId : platform,
        agentId,
        messageId,
        messageText,
        channelId,
        platformMetadata: {
          traceId,
          traceparent: traceparent || undefined,
          agentId,
          chatId: channelId,
          senderId: userId,
          senderUsername: message.author?.userName,
          senderDisplayName: message.author?.fullName,
          isGroup,
          connectionId: this.connection.id,
          responseChannel: channelId,
          responseId: messageId,
          responseThreadId: thread.id,
          conversationHistory:
            conversationHistory.length > 0 ? conversationHistory : undefined,
          ...(ingestedFiles.length > 0 && { files: ingestedFiles }),
          ...(sessionReset && { sessionReset: true }),
        },
        agentOptions,
      });

      const queueProducer = this.services.getQueueProducer();
      await queueProducer.enqueueMessage(payload);

      logger.info(
        {
          traceId,
          traceparent,
          messageId,
          agentId,
          connectionId: this.connection.id,
        },
        "Message enqueued via Chat SDK bridge"
      );

      // Show typing indicator
      try {
        await thread.startTyping?.("Processing...");
      } catch {
        // best effort
      }
    } finally {
      rootSpan?.end();
      void flushTracing();
    }
  }

  // Gap 1: Redis-backed conversation history

  private async getHistory(
    key: string
  ): Promise<
    Array<{ role: "user" | "assistant"; content: string; name?: string }>
  > {
    const raw = await this.redis.lrange(key, 0, MAX_HISTORY_MESSAGES - 1);
    const results: Array<{
      role: "user" | "assistant";
      content: string;
      name?: string;
    }> = [];
    for (const entry of raw) {
      try {
        const parsed = JSON.parse(entry) as HistoryEntry;
        results.push({
          role: parsed.role,
          content: parsed.content,
          name: parsed.authorName,
        });
      } catch (err) {
        logger.warn(
          { key, error: String(err) },
          "Skipping corrupt history entry"
        );
      }
    }
    return results;
  }

  private async appendHistory(key: string, entry: HistoryEntry): Promise<void> {
    await this.redis
      .pipeline()
      .rpush(key, JSON.stringify(entry))
      .ltrim(key, -MAX_HISTORY_MESSAGES, -1)
      .expire(key, HISTORY_TTL_SECONDS)
      .exec();
  }
}

/**
 * Store an outgoing bot response in conversation history.
 * Called from the response bridge.
 */
export async function storeOutgoingHistory(
  redis: Redis,
  connectionId: string,
  channelId: string,
  text: string
): Promise<void> {
  const key = `chat:history:${connectionId}:${channelId}`;
  const entry: HistoryEntry = {
    role: "assistant",
    content: text,
    timestamp: Date.now(),
  };
  await redis
    .pipeline()
    .rpush(key, JSON.stringify(entry))
    .ltrim(key, -MAX_HISTORY_MESSAGES, -1)
    .expire(key, HISTORY_TTL_SECONDS)
    .exec();
}
