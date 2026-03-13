import type { CoreServices, PlatformAdapter } from "../platform";
import type { ChatInstanceManager } from "./chat-instance-manager";
import type { PlatformConnection } from "./types";

type HistoryRecord = {
  role: "user" | "assistant";
  content: string;
  authorName?: string;
  timestamp: number;
};

export class ChatPlatformAdapter implements PlatformAdapter {
  constructor(
    public readonly name: "slack" | "telegram" | "whatsapp",
    private manager: ChatInstanceManager | null
  ) {}

  setManager(manager: ChatInstanceManager): void {
    this.manager = manager;
  }

  async initialize(_services: CoreServices): Promise<void> {
    // no-op: lifecycle managed by ChatInstanceManager
  }

  async start(): Promise<void> {
    // no-op: lifecycle managed by ChatInstanceManager
  }

  async stop(): Promise<void> {
    // no-op: lifecycle managed by ChatInstanceManager
  }

  isHealthy(): boolean {
    return true;
  }

  buildDeploymentMetadata(
    conversationId: string,
    channelId: string,
    platformMetadata: Record<string, any>
  ): Record<string, string> {
    return {
      platform: this.name,
      channelId,
      conversationId,
      ...(typeof platformMetadata.connectionId === "string"
        ? { connectionId: platformMetadata.connectionId }
        : {}),
    };
  }

  extractRoutingInfo(body: Record<string, unknown>): {
    channelId: string;
    conversationId?: string;
    teamId?: string;
  } | null {
    if (this.name === "slack") {
      const slack = body.slack as
        | { channel?: string; thread?: string; team?: string }
        | undefined;
      if (!slack?.channel) return null;
      return {
        channelId: slack.channel,
        conversationId: slack.thread,
        teamId: slack.team,
      };
    }

    if (this.name === "telegram") {
      const telegram = body.telegram as
        | { chatId?: string | number }
        | undefined;
      if (!telegram?.chatId) return null;
      return {
        channelId: String(telegram.chatId),
        conversationId: String(telegram.chatId),
      };
    }

    const whatsapp = body.whatsapp as { chat?: string } | undefined;
    if (!whatsapp?.chat) return null;
    return {
      channelId: whatsapp.chat,
      conversationId: whatsapp.chat,
    };
  }

  async sendMessage(
    _token: string,
    message: string,
    options: {
      agentId: string;
      channelId: string;
      conversationId?: string;
      teamId: string;
      files?: Array<{ buffer: Buffer; filename: string }>;
    }
  ): Promise<{
    messageId: string;
    eventsUrl?: string;
    queued?: boolean;
  }> {
    if (!this.manager) {
      throw new Error(`Platform "${this.name}" is not initialized`);
    }
    if (options.files?.length) {
      throw new Error(
        `Platform "${this.name}" does not support file uploads via Chat SDK routing yet`
      );
    }

    const connection = await this.selectConnection(
      options.channelId,
      options.teamId
    );
    if (!connection) {
      throw new Error(`No active ${this.name} connection is available`);
    }

    const instance = this.manager.getInstance(connection.id);
    if (!instance) {
      throw new Error(`Connection ${connection.id} is not running`);
    }

    const content =
      this.name === "slack" ? message : message.replace(/@me\s*/g, "").trim();
    if (!content) {
      throw new Error("Cannot send an empty message");
    }

    const useThread = this.name === "slack" && !!options.conversationId;

    let sent;
    if (useThread) {
      const adapter = instance.chat.getAdapter?.(connection.platform);
      const createThread = (instance.chat as any).createThread;
      const threadId = `${connection.platform}:${options.channelId}:${options.conversationId}`;
      const thread =
        adapter && typeof createThread === "function"
          ? await createThread.call(instance.chat, adapter, threadId, {}, false)
          : null;
      if (!thread) {
        throw new Error(`Unable to resolve ${this.name} thread`);
      }
      sent = await thread.post(content);
    } else {
      const channel = instance.chat.channel?.(
        `${connection.platform}:${options.channelId}`
      );
      if (!channel) {
        throw new Error(`Unable to resolve ${this.name} channel`);
      }
      sent = await channel.post(content);
    }

    return {
      messageId: String(sent?.id || sent?.messageId || sent?.ts || Date.now()),
    };
  }

  async getConversationHistory(
    channelId: string,
    _conversationId: string | undefined,
    limit: number,
    before: string | undefined
  ): Promise<{
    messages: Array<{
      timestamp: string;
      user: string;
      text: string;
      isBot?: boolean;
    }>;
    nextCursor: string | null;
    hasMore: boolean;
  }> {
    if (!this.manager) {
      return { messages: [], nextCursor: null, hasMore: false };
    }

    const connection = await this.selectConnection(channelId);
    if (!connection) {
      return { messages: [], nextCursor: null, hasMore: false };
    }

    const redis = this.manager.getServices().getQueue().getRedisClient();
    const key = `chat:history:${connection.id}:${channelId}`;
    const raw = await redis.lrange(key, 0, -1);
    let entries = raw.map(
      (entry: string) => JSON.parse(entry) as HistoryRecord
    );

    if (before) {
      const cutoff = Date.parse(before);
      if (!Number.isNaN(cutoff)) {
        entries = entries.filter(
          (entry: HistoryRecord) => entry.timestamp < cutoff
        );
      }
    }

    const hasMore = entries.length > limit;
    const selected = entries.slice(-limit);
    const nextCursor =
      hasMore && selected[0]
        ? new Date(selected[0].timestamp).toISOString()
        : null;

    return {
      messages: selected.map((entry: HistoryRecord) => ({
        timestamp: new Date(entry.timestamp).toISOString(),
        user:
          entry.authorName ||
          (entry.role === "assistant" ? "assistant" : "user"),
        text: entry.content,
        isBot: entry.role === "assistant",
      })),
      nextCursor,
      hasMore,
    };
  }

  private async selectConnection(
    channelId: string,
    teamId?: string
  ): Promise<PlatformConnection | null> {
    if (!this.manager) return null;

    const connections = await this.manager.listConnections({
      platform: this.name,
    });
    const activeConnections = connections.filter((connection) =>
      this.manager?.has(connection.id)
    );
    if (activeConnections.length === 0) return null;
    if (activeConnections.length === 1) return activeConnections[0] || null;

    const teamMatch = activeConnections.find(
      (connection) => connection.metadata?.teamId === teamId
    );
    if (teamMatch) return teamMatch;

    const redis = this.manager.getServices().getQueue().getRedisClient();
    for (const connection of activeConnections) {
      const exists = await redis.exists(
        `chat:history:${connection.id}:${channelId}`
      );
      if (exists === 1) {
        return connection;
      }
    }

    return activeConnections[0] || null;
  }
}
