/**
 * Chat response bridge — handles outbound responses from workers back through Chat SDK.
 * Covers platform-specific markdown handling and message chunking.
 */

import { unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { createLogger } from "@lobu/core";
import type { ThreadResponsePayload } from "../infrastructure/queue";
import { extractSettingsLinkButtons } from "../platform/link-buttons";
import { chunkMessage, delay } from "../platform/renderer-utils";
import type { ResponseRenderer } from "../platform/response-renderer";
import type { ChatInstanceManager } from "./chat-instance-manager";
import { storeOutgoingHistory } from "./message-handler-bridge";

const logger = createLogger("chat-response-bridge");

function buildOutboundPayload(text: string): { markdown: string } {
  return { markdown: text };
}

function shouldBufferUntilCompletion(platform: string): boolean {
  return platform === "telegram";
}

const MESSAGE_CHUNK_SIZE = 4096;
const CHUNK_DELAY_MS = 500;

/**
 * Streaming state for progressive message editing.
 */
interface StreamState {
  buffer: string;
  sentMessage: any | null; // SentMessage from Chat SDK
  lastEditTime: number;
  editTimer?: NodeJS.Timeout;
}

const EDIT_INTERVAL_MS = 2000;

/**
 * ChatResponseBridge implements ResponseRenderer so it can be plugged into
 * the unified thread consumer alongside legacy platform renderers.
 */
export class ChatResponseBridge implements ResponseRenderer {
  private streams = new Map<string, StreamState>();

  constructor(private manager: ChatInstanceManager) {}

  /**
   * Check if this payload belongs to a Chat SDK connection.
   * Returns false if the connection is not managed — the caller should fall through to legacy.
   */
  canHandle(data: ThreadResponsePayload): boolean {
    const connectionId = (data.platformMetadata as any)?.connectionId;
    return !!connectionId && this.manager.has(connectionId);
  }

  async handleDelta(
    payload: ThreadResponsePayload,
    sessionKey: string
  ): Promise<string | null> {
    void sessionKey;
    if (payload.delta === undefined) return null;

    const connectionId = (payload.platformMetadata as any)?.connectionId;
    if (!connectionId) return null;

    const instance = this.manager.getInstance(connectionId);
    if (!instance) return null;

    const channelId =
      (payload.platformMetadata as any)?.chatId ??
      (payload.platformMetadata as any)?.responseChannel ??
      payload.channelId;
    const key = `${channelId}:${payload.conversationId}`;
    const shouldBuffer = shouldBufferUntilCompletion(
      instance.connection.platform
    );

    let stream = this.streams.get(key);

    if (!stream) {
      if (shouldBuffer) {
        this.streams.set(key, {
          buffer: payload.delta,
          sentMessage: null,
          lastEditTime: Date.now(),
        });
        return null;
      }

      // First delta — send initial message
      try {
        const target = await this.resolveTarget(
          instance,
          channelId,
          payload.conversationId
        );

        if (target) {
          const sentMessage = await target.post(
            buildOutboundPayload(payload.delta) as any
          );
          stream = {
            buffer: payload.delta,
            sentMessage,
            lastEditTime: Date.now(),
          };
          this.streams.set(key, stream);
        }
      } catch (error) {
        logger.warn(
          { connectionId, error: String(error) },
          "Failed to send initial delta"
        );
      }
      return null;
    }

    // Append delta
    if (payload.isFullReplacement) {
      stream.buffer = payload.delta;
    } else {
      stream.buffer += payload.delta;
    }

    if (shouldBuffer) {
      return null;
    }

    // Throttle edits
    const now = Date.now();
    if (now - stream.lastEditTime >= EDIT_INTERVAL_MS) {
      await this.editStreamMessage(stream, connectionId);
    } else if (!stream.editTimer) {
      stream.editTimer = setTimeout(
        async () => {
          stream!.editTimer = undefined;
          await this.editStreamMessage(stream!, connectionId);
        },
        EDIT_INTERVAL_MS - (now - stream.lastEditTime)
      );
    }

    return null;
  }

  async handleCompletion(
    payload: ThreadResponsePayload,
    _sessionKey: string
  ): Promise<void> {
    const connectionId = (payload.platformMetadata as any)?.connectionId;
    if (!connectionId) return;

    const instance = this.manager.getInstance(connectionId);
    if (!instance) return;

    const channelId =
      (payload.platformMetadata as any)?.chatId ??
      (payload.platformMetadata as any)?.responseChannel ??
      payload.channelId;
    const key = `${channelId}:${payload.conversationId}`;

    const stream = this.streams.get(key);
    if (stream) {
      if (stream.editTimer) {
        clearTimeout(stream.editTimer);
      }

      if (stream.buffer.trim()) {
        await this.sendFinalMessage(
          stream,
          instance,
          channelId,
          payload.conversationId,
          connectionId
        );
      }

      this.streams.delete(key);
    }

    // Gap 1: Store outgoing response in history
    if (stream?.buffer.trim()) {
      const redis = this.manager.getServices().getQueue().getRedisClient();
      await storeOutgoingHistory(redis, connectionId, channelId, stream.buffer);
    }

    // Session reset: clear Redis history and delete session file
    if ((payload.platformMetadata as any)?.sessionReset) {
      const agentId = (payload.platformMetadata as any)?.agentId;
      try {
        const redis = this.manager.getServices().getQueue().getRedisClient();
        await redis.del(`chat:history:${connectionId}:${channelId}`);
        logger.info(
          { connectionId, channelId },
          "Cleared chat history for session reset"
        );
      } catch (error) {
        logger.warn(
          { error: String(error) },
          "Failed to clear chat history on session reset"
        );
      }
      if (agentId) {
        try {
          const sessionPath = resolve(
            "workspaces",
            agentId,
            ".openclaw",
            "session.jsonl"
          );
          await unlink(sessionPath);
          logger.info(
            { agentId, sessionPath },
            "Deleted session file for session reset"
          );
        } catch (error) {
          // File may not exist — that's fine
          logger.debug(
            { agentId, error: String(error) },
            "No session file to delete on reset"
          );
        }
      }
    }

    logger.info(
      {
        connectionId,
        channelId,
        conversationId: payload.conversationId,
      },
      "Response completed via Chat SDK bridge"
    );
  }

  async handleError(
    payload: ThreadResponsePayload,
    _sessionKey: string
  ): Promise<void> {
    if (!payload.error) return;

    const connectionId = (payload.platformMetadata as any)?.connectionId;
    if (!connectionId) return;

    const instance = this.manager.getInstance(connectionId);
    if (!instance) return;

    const channelId =
      (payload.platformMetadata as any)?.chatId ??
      (payload.platformMetadata as any)?.responseChannel ??
      payload.channelId;
    const key = `${channelId}:${payload.conversationId}`;

    // Clean up stream
    const stream = this.streams.get(key);
    if (stream?.editTimer) clearTimeout(stream.editTimer);
    this.streams.delete(key);

    // Send error via Chat SDK
    try {
      const target = await this.resolveTarget(
        instance,
        channelId,
        payload.conversationId
      );
      if (target) {
        await target.post(`Error: ${payload.error}`);
      }
    } catch (error) {
      logger.error(
        { connectionId, error: String(error) },
        "Failed to send error message"
      );
    }
  }

  async handleStatusUpdate(payload: ThreadResponsePayload): Promise<void> {
    const connectionId = (payload.platformMetadata as any)?.connectionId;
    if (!connectionId) return;

    const instance = this.manager.getInstance(connectionId);
    if (!instance) return;

    // Show typing indicator
    try {
      const channelId =
        (payload.platformMetadata as any)?.chatId ?? payload.channelId;
      const target = await this.resolveTarget(
        instance,
        channelId,
        payload.conversationId
      );
      if (target) {
        await target.startTyping?.("Processing...");
      }
    } catch {
      // best effort
    }
  }

  async handleEphemeral(payload: ThreadResponsePayload): Promise<void> {
    if (!payload.content) return;

    const connectionId = (payload.platformMetadata as any)?.connectionId;
    if (!connectionId) return;

    const instance = this.manager.getInstance(connectionId);
    if (!instance) return;

    try {
      const channelId =
        (payload.platformMetadata as any)?.chatId ?? payload.channelId;
      const target = await this.resolveTarget(
        instance,
        channelId,
        payload.conversationId
      );
      if (target) {
        const { processedContent, linkButtons } = extractSettingsLinkButtons(
          payload.content
        );

        if (linkButtons.length > 0) {
          try {
            const { Actions, Card, CardText, LinkButton } = await import(
              "chat"
            );
            const card = Card({
              children: [
                CardText(processedContent),
                Actions(
                  linkButtons.map((button) =>
                    LinkButton({ url: button.url, label: button.text })
                  )
                ),
              ],
            });
            await target.post({
              card,
              fallbackText: `${processedContent}\n\n${linkButtons.map((button) => `${button.text}: ${button.url}`).join("\n")}`,
            });
            return;
          } catch (error) {
            logger.warn(
              { connectionId, error: String(error) },
              "Failed to render ephemeral settings button"
            );
            const fallbackText = `${processedContent}\n\n${linkButtons.map((button) => `${button.text}: ${button.url}`).join("\n")}`;
            await target.post(fallbackText.trim());
            return;
          }
        }

        await target.post(processedContent);
      }
    } catch (error) {
      logger.error(
        { connectionId, error: String(error) },
        "Failed to send ephemeral message"
      );
    }
  }

  // --- Private ---

  private async editStreamMessage(
    stream: StreamState,
    connectionId: string
  ): Promise<void> {
    if (!stream.sentMessage?.edit) return;
    try {
      await stream.sentMessage.edit(buildOutboundPayload(stream.buffer) as any);
      stream.lastEditTime = Date.now();
    } catch (error) {
      logger.debug(
        { connectionId, error: String(error) },
        "Failed to edit stream message"
      );
    }
  }

  private async sendFinalMessage(
    stream: StreamState,
    instance: any,
    channelId: string,
    conversationId: string,
    connectionId: string
  ): Promise<void> {
    const shouldBuffer = shouldBufferUntilCompletion(
      instance.connection.platform
    );
    const target = await this.resolveTarget(
      instance,
      channelId,
      conversationId
    );
    if (!target) return;

    if (stream.buffer.length <= MESSAGE_CHUNK_SIZE) {
      try {
        if (!shouldBuffer && stream.sentMessage?.edit) {
          await stream.sentMessage.edit(
            buildOutboundPayload(stream.buffer) as any
          );
        } else {
          await target.post(buildOutboundPayload(stream.buffer) as any);
        }
      } catch (error) {
        logger.debug(
          { connectionId, error: String(error) },
          "Failed final message edit"
        );
        if (!shouldBuffer) {
          try {
            await stream.sentMessage?.edit?.(stream.buffer);
          } catch {
            // give up
          }
        }
      }
      return;
    }

    const chunks = chunkMessage(stream.buffer, MESSAGE_CHUNK_SIZE);
    if (chunks.length === 0) return;
    const [firstChunk, ...remainingChunks] = chunks;
    if (!firstChunk) return;

    try {
      if (!shouldBuffer && stream.sentMessage?.edit) {
        await stream.sentMessage.edit(buildOutboundPayload(firstChunk) as any);
      } else {
        await target.post(buildOutboundPayload(firstChunk) as any);
      }
    } catch (error) {
      logger.debug(
        { connectionId, error: String(error) },
        "Failed to send first final chunk"
      );
      if (!shouldBuffer) {
        try {
          await stream.sentMessage?.edit?.(firstChunk);
        } catch {
          // give up on first chunk
        }
      }
    }

    for (let i = 0; i < remainingChunks.length; i++) {
      const chunk = remainingChunks[i]!;
      try {
        await target.post(buildOutboundPayload(chunk) as any);
      } catch (error) {
        logger.debug(
          { connectionId, error: String(error) },
          "Failed to send chunk"
        );
      }
      if (i < remainingChunks.length - 1) {
        await delay(CHUNK_DELAY_MS);
      }
    }
  }

  private async resolveTarget(
    instance: any,
    channelId: string,
    conversationId?: string
  ): Promise<any | null> {
    const platform = instance.connection.platform;
    const chat = instance.chat;

    if (!conversationId || conversationId === channelId) {
      const channel = chat.channel?.(`${platform}:${channelId}`);
      if (channel) {
        return channel;
      }
    }

    return (
      (await chat.getThread?.(platform, channelId, conversationId)) ?? null
    );
  }
}
