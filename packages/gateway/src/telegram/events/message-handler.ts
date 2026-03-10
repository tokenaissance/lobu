/**
 * Telegram message handler.
 * Processes inbound messages and enqueues them for worker processing.
 */

import {
  type AgentOptions as CoreAgentOptions,
  createLogger,
  generateTraceId,
} from "@lobu/core";
import type { Bot } from "grammy";
import type { AgentMetadataStore } from "../../auth/agent-metadata-store";
import type { AgentSettingsStore } from "../../auth/settings";
import type { UserAgentsStore } from "../../auth/user-agents-store";
import type { CommandDispatcher } from "../../commands/command-dispatcher";
import { createTelegramReply } from "../../commands/command-reply-adapters";
import type { QueueProducer } from "../../infrastructure/queue/queue-producer";
import type { SystemMessageLimiter } from "../../infrastructure/redis/system-message-limiter";
import type { IFileHandler } from "../../platform/file-handler";
import {
  buildMessagePayload,
  resolveAgentId,
  resolveAgentOptions,
} from "../../services/platform-helpers";
import type { TranscriptionService } from "../../services/transcription-service";
import type { ISessionManager } from "../../session";
import type { TelegramConfig } from "../config";
import { isGroupChat, type TelegramContext } from "../types";

const logger = createLogger("telegram-message-handler");

type AgentOptions = CoreAgentOptions;

interface StoredMessage {
  id: string;
  text: string;
  fromMe: boolean;
  senderName?: string;
  timestamp: number;
}

interface ConversationHistory {
  messages: StoredMessage[];
  lastUpdated: number;
}

interface TelegramInboundAudioFile {
  id: string;
  name: string;
  mimetype: string;
  size: number;
}

class MessageDeduplicator<T extends string | number = string> {
  private seen = new Set<T>();
  private readonly maxSize: number;

  constructor(maxSize = 10_000) {
    this.maxSize = maxSize;
  }

  isDuplicate(id: T): boolean {
    if (this.seen.has(id)) {
      return true;
    }
    this.seen.add(id);
    this.trim();
    return false;
  }

  markSeen(id: T): void {
    this.seen.add(id);
    this.trim();
  }

  private trim(): void {
    if (this.seen.size > this.maxSize) {
      const iterator = this.seen.values();
      const toDelete = Math.floor(this.maxSize / 2);
      for (let i = 0; i < toDelete; i++) {
        const val = iterator.next().value;
        if (val !== undefined) this.seen.delete(val);
      }
    }
  }
}

/**
 * Telegram message handler.
 */
export class TelegramMessageHandler {
  private dedup = new MessageDeduplicator<number>();
  private conversationHistory = new Map<string, ConversationHistory>();
  private isRunning = false;
  private historyCleanupTimer?: NodeJS.Timeout;
  private agentSettingsStore?: AgentSettingsStore;
  private transcriptionService?: TranscriptionService;
  private fileHandler?: IFileHandler;
  private userAgentsStore?: UserAgentsStore;
  private agentMetadataStore?: AgentMetadataStore;
  private commandDispatcher?: CommandDispatcher;
  private systemMessageLimiter?: SystemMessageLimiter;
  private botUsername?: string;
  private botUserId?: number;
  private statusCallback?: (
    channelId: string,
    conversationId: string,
    status: string | null
  ) => Promise<void>;

  constructor(
    private bot: Bot,
    private config: TelegramConfig,
    private queueProducer: QueueProducer,
    _sessionManager: ISessionManager,
    private agentOptions: AgentOptions
  ) {}

  setAgentSettingsStore(store: AgentSettingsStore): void {
    this.agentSettingsStore = store;
  }

  setTranscriptionService(service: TranscriptionService): void {
    this.transcriptionService = service;
  }

  setFileHandler(handler: IFileHandler): void {
    this.fileHandler = handler;
  }

  setUserAgentsStore(store: UserAgentsStore): void {
    this.userAgentsStore = store;
  }

  setAgentMetadataStore(store: AgentMetadataStore): void {
    this.agentMetadataStore = store;
  }

  setCommandDispatcher(dispatcher: CommandDispatcher): void {
    this.commandDispatcher = dispatcher;
  }

  setSystemMessageLimiter(limiter: SystemMessageLimiter): void {
    this.systemMessageLimiter = limiter;
  }

  setStatusCallback(
    callback: (
      channelId: string,
      conversationId: string,
      status: string | null
    ) => Promise<void>
  ): void {
    this.statusCallback = callback;
  }

  /**
   * Get agent options with settings applied.
   */
  private getAgentOptionsWithSettings(
    agentId: string
  ): Promise<Record<string, any>> {
    return resolveAgentOptions(
      agentId,
      { ...this.agentOptions },
      this.agentSettingsStore
    );
  }

  /**
   * Start listening for messages.
   */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    // Fetch bot info for mention detection
    this.bot.api.getMe().then((me) => {
      this.botUsername = me.username;
      this.botUserId = me.id;
      logger.info(
        { botUsername: this.botUsername, botUserId: this.botUserId },
        "Bot identity resolved"
      );
    });

    this.registerMessageListener("message:text", "text");
    this.registerMessageListener("message:voice", "voice");
    this.registerMessageListener("message:audio", "audio");

    // Periodically cleanup expired histories
    if (this.historyCleanupTimer) {
      clearInterval(this.historyCleanupTimer);
    }
    this.historyCleanupTimer = setInterval(
      () => this.cleanupExpiredHistories(),
      60 * 60 * 1000
    );

    logger.info("Telegram message handler started");
  }

  /**
   * Stop listening for messages.
   */
  stop(): void {
    this.isRunning = false;
    if (this.historyCleanupTimer) {
      clearInterval(this.historyCleanupTimer);
      this.historyCleanupTimer = undefined;
    }
    logger.info("Telegram message handler stopped");
  }

  private registerMessageListener(event: string, label: string): void {
    this.bot.on(event as any, async (ctx) => {
      try {
        await this.processMessage(ctx);
      } catch (err) {
        logger.error(
          { error: String(err), event: label },
          "Error handling Telegram message"
        );
      }
    });
  }

  /**
   * Process a single message.
   */
  private async processMessage(ctx: any): Promise<void> {
    const msg = ctx.message;
    if (!msg) return;

    const messageId = msg.message_id;

    // Dedupe
    if (this.dedup.isDuplicate(messageId)) {
      logger.debug({ messageId }, "Skipping duplicate message");
      return;
    }

    const chatId = msg.chat.id;
    const chatType = msg.chat.type;
    const isGroup = isGroupChat(chatType);
    const senderId = msg.from?.id ?? 0;
    const senderUsername = msg.from?.username;
    const senderDisplayName =
      [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" ") ||
      undefined;

    const audioFiles = this.extractInboundAudioFiles(msg);
    const hasAudio = audioFiles.length > 0;
    const body = this.extractMessageBody(msg, hasAudio);

    logger.info(
      {
        messageId,
        chatId,
        chatType,
        senderId,
        isGroup,
        hasAudio,
        body: body.substring(0, 100),
      },
      "Processing message"
    );

    // Authorization check
    if (!this.isAllowedSender(senderId)) {
      logger.info(
        { senderId, allowFrom: this.config.allowFrom },
        "Blocked unauthorized sender"
      );
      return;
    }

    // Group safety gates:
    // - voice/audio messages only when replying to bot
    // - text messages require @mention
    if (isGroup) {
      if (hasAudio) {
        const repliedToBot = this.isReplyToBot(msg);
        if (!repliedToBot) {
          logger.debug(
            { messageId },
            "Skipping group audio not replying to bot"
          );
          return;
        }
      } else if (!this.isBotMentioned(msg)) {
        return;
      }
    }

    // Check if groups are allowed
    if (isGroup && !this.config.allowGroups) {
      return;
    }

    // Build context
    const context: TelegramContext = {
      senderId,
      senderUsername,
      senderDisplayName,
      chatId,
      chatType,
      isGroup,
      messageId,
      messageThreadId: msg.message_thread_id,
      repliedMessage: msg.reply_to_message
        ? {
            id: msg.reply_to_message.message_id,
            body: this.extractMessageBody(msg.reply_to_message, false),
            sender:
              msg.reply_to_message.from?.username ||
              String(msg.reply_to_message.from?.id || "unknown"),
          }
        : undefined,
    };

    // Store in conversation history
    const chatKey = String(chatId);
    this.storeMessageInHistory(chatKey, {
      id: String(messageId),
      text: body,
      fromMe: false,
      senderName: senderDisplayName,
      timestamp: (msg.date || 0) * 1000,
    });

    // Get conversation history
    const conversationHistory = this.getConversationHistory(chatKey);

    // Enqueue for processing
    await this.enqueueMessage(
      String(messageId),
      body,
      context,
      audioFiles,
      conversationHistory
    );
  }

  /**
   * Check if sender is allowed.
   */
  private isAllowedSender(senderId: number): boolean {
    const { allowFrom } = this.config;

    // Empty allowFrom means allow all
    if (!allowFrom || allowFrom.length === 0) {
      return true;
    }

    // Check wildcard
    if (allowFrom.includes("*")) {
      return true;
    }

    return allowFrom.includes(String(senderId));
  }

  /**
   * Check if the bot was mentioned in the message.
   */
  private isBotMentioned(msg: any): boolean {
    if (!this.botUsername) return false;

    // Check text for @username
    const text = msg.text || "";
    if (text.includes(`@${this.botUsername}`)) {
      return true;
    }

    // Check entities for bot_command or mention
    const entities = msg.entities || [];
    for (const entity of entities) {
      if (entity.type === "mention") {
        const mentionText = text.substring(
          entity.offset,
          entity.offset + entity.length
        );
        if (mentionText === `@${this.botUsername}`) {
          return true;
        }
      }
      if (entity.type === "bot_command") {
        return true;
      }
    }

    return false;
  }

  private isReplyToBot(msg: any): boolean {
    const replyFrom = msg.reply_to_message?.from;
    if (!replyFrom) return false;

    if (this.botUserId && replyFrom.id === this.botUserId) {
      return true;
    }

    return (
      !!this.botUsername &&
      typeof replyFrom.username === "string" &&
      replyFrom.username === this.botUsername
    );
  }

  private extractMessageBody(
    msg: any,
    includeAudioPlaceholder: boolean
  ): string {
    const text = typeof msg.text === "string" ? msg.text.trim() : "";
    if (text.length > 0) {
      return text;
    }

    const caption = typeof msg.caption === "string" ? msg.caption.trim() : "";
    if (caption.length > 0) {
      return caption;
    }

    return includeAudioPlaceholder ? "<media:audio>" : "";
  }

  private extractInboundAudioFiles(msg: any): TelegramInboundAudioFile[] {
    const extracted: TelegramInboundAudioFile[] = [];
    const voice = msg.voice;
    if (voice?.file_id) {
      extracted.push({
        id: String(voice.file_id),
        name: `voice_${msg.message_id}.ogg`,
        mimetype: voice.mime_type || "audio/ogg",
        size: typeof voice.file_size === "number" ? voice.file_size : 0,
      });
    }

    const audio = msg.audio;
    if (audio?.file_id) {
      extracted.push({
        id: String(audio.file_id),
        name:
          typeof audio.file_name === "string" && audio.file_name.length > 0
            ? audio.file_name
            : `audio_${msg.message_id}.mp3`,
        mimetype: audio.mime_type || "audio/mpeg",
        size: typeof audio.file_size === "number" ? audio.file_size : 0,
      });
    }

    return extracted;
  }

  private async transcribeTelegramAudio(
    userRequest: string,
    audioFiles: TelegramInboundAudioFile[],
    agentId: string,
    messageId: string,
    context: TelegramContext
  ): Promise<string> {
    if (audioFiles.length === 0) {
      return userRequest;
    }

    if (!this.fileHandler) {
      logger.warn({ messageId }, "Telegram file handler not configured");
      return this.buildAudioDownloadFailedMessage(
        "Telegram file handler is not configured"
      );
    }

    if (!this.transcriptionService) {
      logger.info({ messageId }, "Transcription service not configured");
      return this.buildTranscriptionUnavailableMessage([
        "openai",
        "gemini",
        "elevenlabs",
      ]);
    }

    const transcriptions: string[] = [];

    for (const audioFile of audioFiles) {
      let buffer: Buffer;
      try {
        const { stream, metadata } = await this.fileHandler.downloadFile(
          audioFile.id
        );
        buffer = await this.readStreamToBuffer(stream);
        if (audioFile.mimetype === "audio/ogg" && metadata.mimetype) {
          audioFile.mimetype = metadata.mimetype;
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        logger.warn(
          { messageId, fileId: audioFile.id, error: errorMessage },
          "Failed to download Telegram audio file"
        );
        return this.buildAudioDownloadFailedMessage(errorMessage);
      }

      const result = await this.transcriptionService.transcribe(
        buffer,
        agentId,
        audioFile.mimetype
      );

      if ("text" in result) {
        transcriptions.push(`[Voice message]: ${result.text}`);
        logger.info(
          {
            messageId,
            fileId: audioFile.id,
            provider: result.provider,
            textLength: result.text.length,
          },
          "Telegram audio transcription successful"
        );
        continue;
      }

      if (result.error.includes("No transcription provider configured")) {
        await this.sendProviderSetupPrompt(context, agentId);
        logger.info(
          { messageId, fileId: audioFile.id },
          "No transcription provider configured"
        );
        return this.buildTranscriptionUnavailableMessage(
          result.availableProviders
        );
      }

      logger.warn(
        { messageId, fileId: audioFile.id, error: result.error },
        "Telegram audio transcription failed"
      );
      return this.buildTranscriptionFailedMessage(result.error);
    }

    if (transcriptions.length === 0) {
      return userRequest;
    }

    const transcribedText = transcriptions.join("\n\n");
    if (!userRequest.trim() || userRequest === "<media:audio>") {
      return transcribedText;
    }

    return `${transcribedText}\n\n${userRequest}`;
  }

  private async readStreamToBuffer(
    stream: AsyncIterable<unknown>
  ): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as any));
    }
    return Buffer.concat(chunks);
  }

  private buildAudioDownloadFailedMessage(errorDetail: string): string {
    return `[Voice message received - audio download failed]

The user sent a voice message but the audio file could not be downloaded from Telegram's servers.

Error: ${errorDetail}

Please let the user know:
1. You received their voice message but couldn't process it due to a technical issue
2. Ask them to either send the voice message again or type their message instead`;
  }

  private buildTranscriptionUnavailableMessage(
    availableProviders: string[]
  ): string {
    const providers =
      availableProviders.length > 0
        ? availableProviders.join(", ")
        : "openai, gemini, elevenlabs";
    return `[Voice message received - transcription unavailable]

The user sent a voice message but no transcription provider is configured.
Available providers that can be configured: ${providers}

To enable voice transcription:
1. Use the Sudo tool to generate a settings link for the user
2. Ask them to connect OpenAI, Gemini, or ElevenLabs credentials

For now, let the user know you received the voice message but couldn't transcribe it, and ask them to type their message.`;
  }

  private buildTranscriptionFailedMessage(errorDetail: string): string {
    return `[Voice message received - transcription failed]

Error: ${errorDetail}

The user sent a voice message but transcription failed. Let them know and suggest they try again or type their message.`;
  }

  /**
   * Enqueue message for worker processing.
   */
  private async enqueueMessage(
    messageId: string,
    body: string,
    context: TelegramContext,
    audioFiles: TelegramInboundAudioFile[],
    conversationHistory: Array<{
      role: "user" | "assistant";
      content: string;
      name?: string;
    }>
  ): Promise<void> {
    const conversationId = context.isGroup
      ? context.repliedMessage
        ? String(context.repliedMessage.id)
        : messageId
      : String(context.chatId);

    const traceId = generateTraceId(messageId);
    const userId = String(context.senderId);
    const chatId = String(context.chatId);

    // Handle slash commands via shared dispatcher before normal message routing
    if (this.commandDispatcher) {
      const handled = await this.commandDispatcher.tryHandleSlashText(body, {
        platform: "telegram",
        userId,
        channelId: chatId,
        isGroup: context.isGroup,
        conversationId,
        reply: createTelegramReply(this.bot, context.chatId),
      });
      if (handled) return;
    }

    logger.info(
      { traceId, messageId, conversationId, userId },
      "Message received"
    );

    // Resolve agent ID (deterministic for Telegram)
    const { agentId } = await resolveAgentId({
      platform: "telegram",
      userId,
      channelId: chatId,
      isGroup: context.isGroup,
    });

    // Auto-create agent metadata on first message
    if (this.agentMetadataStore) {
      const existing = await this.agentMetadataStore.getMetadata(agentId);
      if (!existing) {
        const agentName = context.isGroup
          ? `Telegram Group ${chatId}`
          : `Telegram ${context.senderDisplayName || userId}`;
        await this.agentMetadataStore.createAgent(
          agentId,
          agentName,
          "telegram",
          userId
        );
        await this.userAgentsStore?.addAgent("telegram", userId, agentId);
        logger.info(
          { agentId, userId },
          "Auto-created agent for Telegram user"
        );
      }
    }

    // Check if agent has providers configured — send setup prompt if not
    if (this.agentSettingsStore) {
      const settings = await this.agentSettingsStore.getSettings(agentId);
      if (!settings?.installedProviders?.length) {
        await this.sendProviderSetupPrompt(context, agentId);
        return;
      }
    }

    // Clean up body - remove bot mention
    let cleanBody = body;
    if (this.botUsername) {
      cleanBody = cleanBody.replace(`@${this.botUsername}`, "").trim();
    }

    const processedBody = await this.transcribeTelegramAudio(
      cleanBody,
      audioFiles,
      agentId,
      messageId,
      context
    );

    const fileMetadata = audioFiles.map((file) => ({
      id: file.id,
      name: file.name,
      mimetype: file.mimetype,
      size: file.size,
    }));

    // Fetch agent settings and merge
    const agentOptions = await this.getAgentOptionsWithSettings(agentId);

    const payload = buildMessagePayload({
      platform: "telegram",
      userId,
      botId: "telegram",
      conversationId,
      teamId: context.isGroup ? chatId : "telegram",
      agentId,
      messageId,
      messageText: processedBody,
      channelId: chatId,
      platformMetadata: {
        traceId,
        agentId,
        chatId: context.chatId,
        senderId: context.senderId,
        senderUsername: context.senderUsername,
        senderDisplayName: context.senderDisplayName,
        isGroup: context.isGroup,
        chatType: context.chatType,
        messageThreadId: context.messageThreadId,
        repliedMessageId: context.repliedMessage?.id,
        responseChannel: chatId,
        responseId: messageId,
        files: fileMetadata.length > 0 ? fileMetadata : undefined,
        conversationHistory:
          conversationHistory.length > 0 ? conversationHistory : undefined,
      },
      agentOptions,
    });

    await this.queueProducer.enqueueMessage(payload);
    logger.info(
      {
        traceId,
        messageId,
        conversationId,
        chatId,
        fileCount: fileMetadata.length,
        historyCount: conversationHistory.length,
      },
      "Message enqueued"
    );

    // Send persistent status indicator
    if (this.statusCallback) {
      await this.statusCallback(chatId, conversationId, "Waking up agent...");
    }
  }

  /**
   * Send a setup prompt when the agent has no provider configured.
   * Uses Telegram web_app button — auth handled via initData, no claim needed.
   * Throttled to avoid spamming the user on repeated messages.
   */
  private async sendProviderSetupPrompt(
    context: TelegramContext,
    agentId: string
  ): Promise<void> {
    const sendPrompt = async () => {
      const baseUrl = process.env.PUBLIC_GATEWAY_URL || "http://localhost:8080";
      const settingsUrl = new URL("/settings", baseUrl);
      settingsUrl.searchParams.set("platform", "telegram");
      settingsUrl.searchParams.set("chat", String(context.chatId));
      const configUrl = settingsUrl.toString();

      const message =
        "Welcome! To get started, set up an AI provider (like Claude or OpenAI) so I can respond to your messages.";

      // Telegram rejects web_app buttons with localhost URLs
      let isLocalhost = false;
      try {
        const u = new URL(configUrl);
        isLocalhost =
          u.hostname === "localhost" ||
          u.hostname === "127.0.0.1" ||
          u.hostname === "::1";
      } catch {
        isLocalhost = true;
      }

      if (isLocalhost) {
        await this.bot.api.sendMessage(
          context.chatId,
          `${message}\n\nSet up: ${configUrl}`
        );
      } else {
        await this.bot.api.sendMessage(context.chatId, message, {
          reply_markup: {
            inline_keyboard: [
              [{ text: "Set Up Provider", web_app: { url: configUrl } }],
            ],
          },
        });
      }

      logger.info(
        { agentId, chatId: context.chatId },
        "Sent provider setup prompt"
      );
    };

    await this.sendThrottled(
      `provider_setup:telegram:${context.chatId}:${agentId}`,
      sendPrompt,
      { chatId: context.chatId, agentId }
    );
  }

  /**
   * Run a send function with optional throttling via systemMessageLimiter.
   */
  private async sendThrottled(
    dedupeKey: string,
    sendFn: () => Promise<void>,
    logContext: Record<string, unknown>
  ): Promise<void> {
    if (!this.systemMessageLimiter) {
      try {
        await sendFn();
      } catch (error) {
        logger.warn(
          { error: String(error), ...logContext },
          "Failed to send throttled message"
        );
      }
      return;
    }

    try {
      await this.systemMessageLimiter.sendOnce(dedupeKey, sendFn, {
        sentTtlSeconds: 3600,
        lockTtlSeconds: 30,
        failOpen: false,
      });
    } catch (error) {
      logger.warn(
        { error: String(error), ...logContext },
        "Failed to send throttled message"
      );
    }
  }

  /**
   * Store a message in conversation history.
   */
  private storeMessageInHistory(chatKey: string, message: StoredMessage): void {
    const history = this.conversationHistory.get(chatKey) || {
      messages: [],
      lastUpdated: Date.now(),
    };

    history.messages.push(message);
    history.lastUpdated = Date.now();

    while (history.messages.length > this.config.maxHistoryMessages) {
      history.messages.shift();
    }

    this.conversationHistory.set(chatKey, history);
  }

  /**
   * Get conversation history for a chat.
   */
  private getConversationHistory(chatKey: string): Array<{
    role: "user" | "assistant";
    content: string;
    name?: string;
  }> {
    const history = this.conversationHistory.get(chatKey);
    if (!history) return [];

    const ttlMs = this.config.historyTtlSeconds * 1000;
    if (Date.now() - history.lastUpdated > ttlMs) {
      this.conversationHistory.delete(chatKey);
      return [];
    }

    return history.messages.map((msg) => ({
      role: msg.fromMe ? ("assistant" as const) : ("user" as const),
      content: msg.text,
      name: msg.senderName,
    }));
  }

  /**
   * Store an outgoing (bot) message in history.
   */
  storeOutgoingMessage(chatKey: string, text: string): void {
    this.storeMessageInHistory(chatKey, {
      id: `outgoing_${Date.now()}`,
      text,
      fromMe: true,
      timestamp: Date.now(),
    });
  }

  /**
   * Get conversation history for API endpoint.
   */
  getHistory(
    chatKey: string,
    limit: number,
    before?: string
  ): {
    messages: Array<{
      timestamp: string;
      user: string;
      text: string;
      isBot?: boolean;
    }>;
    nextCursor: string | null;
    hasMore: boolean;
  } {
    const history = this.conversationHistory.get(chatKey);
    if (!history) {
      return { messages: [], nextCursor: null, hasMore: false };
    }

    const ttlMs = this.config.historyTtlSeconds * 1000;
    if (Date.now() - history.lastUpdated > ttlMs) {
      this.conversationHistory.delete(chatKey);
      return { messages: [], nextCursor: null, hasMore: false };
    }

    let messages = history.messages;
    if (before) {
      const beforeTs = new Date(before).getTime();
      messages = messages.filter((m) => m.timestamp < beforeTs);
    }

    const sorted = [...messages]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);

    const formatted = sorted.map((msg) => ({
      timestamp: new Date(msg.timestamp).toISOString(),
      user: msg.senderName || (msg.fromMe ? "Assistant" : "User"),
      text: msg.text,
      isBot: msg.fromMe,
    }));

    const hasMore = messages.length > limit;
    const lastMessage = sorted[sorted.length - 1];
    const nextCursor =
      hasMore && lastMessage
        ? new Date(lastMessage.timestamp).toISOString()
        : null;

    return { messages: formatted, nextCursor, hasMore };
  }

  /**
   * Cleanup expired conversation histories.
   */
  private cleanupExpiredHistories(): void {
    const now = Date.now();
    const ttlMs = this.config.historyTtlSeconds * 1000;

    for (const [chatKey, history] of this.conversationHistory) {
      if (now - history.lastUpdated > ttlMs) {
        this.conversationHistory.delete(chatKey);
      }
    }
  }
}
