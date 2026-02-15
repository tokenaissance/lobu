/**
 * Telegram platform adapter implementing PlatformAdapter interface.
 */

import {
  createLogger,
  type AgentOptions as CoreAgentOptions,
  type UserInteraction,
  type UserSuggestion,
} from "@lobu/core";
import { Bot } from "grammy";
import { platformAuthRegistry } from "../auth/platform-auth";
import type { CoreServices, PlatformAdapter } from "../platform";
import {
  type AgentOptions as FactoryAgentOptions,
  type PlatformConfigs,
  type PlatformFactory,
  platformFactoryRegistry,
} from "../platform/platform-factory";
import type { ResponseRenderer } from "../platform/response-renderer";
import { TelegramAuthAdapter } from "./auth-adapter";
import type { TelegramConfig } from "./config";
import { TelegramMessageHandler } from "./events/message-handler";
import { TelegramInteractionRenderer } from "./interactions";
import { TelegramResponseRenderer } from "./response-renderer";

const logger = createLogger("telegram-platform");

export interface TelegramPlatformConfig {
  telegram: TelegramConfig;
}

export type AgentOptions = CoreAgentOptions;

/**
 * Telegram platform adapter.
 * Uses Grammy for Telegram Bot API integration.
 */
export class TelegramPlatform implements PlatformAdapter {
  readonly name = "telegram";

  private bot!: Bot;
  private messageHandler?: TelegramMessageHandler;
  private responseRenderer?: TelegramResponseRenderer;
  private interactionRenderer?: TelegramInteractionRenderer;
  private authAdapter?: TelegramAuthAdapter;
  private running = false;

  constructor(
    private readonly config: TelegramPlatformConfig,
    private readonly agentOptions: AgentOptions,
    sessionTimeoutMinutes: number
  ) {
    // Reserved for future use (kept to match other platform constructors).
    void sessionTimeoutMinutes;
  }

  async initialize(services: CoreServices): Promise<void> {
    logger.info("Initializing Telegram platform...");

    // Create Grammy bot instance
    this.bot = new Bot(this.config.telegram.botToken);

    // Create message handler
    this.messageHandler = new TelegramMessageHandler(
      this.bot,
      this.config.telegram,
      services.getQueueProducer(),
      services.getSessionManager(),
      this.agentOptions
    );

    // Create response renderer
    this.responseRenderer = new TelegramResponseRenderer(
      this.bot,
      this.config.telegram
    );

    // Wire up conversation history tracking
    this.responseRenderer.setStoreOutgoingCallback((chatKey, text) => {
      this.messageHandler?.storeOutgoingMessage(chatKey, text);
    });

    // Create interaction renderer
    this.interactionRenderer = new TelegramInteractionRenderer(
      this.bot,
      services.getInteractionService(),
      this.config.telegram
    );

    // Register beforeCreate hook
    const interactionService = services.getInteractionService();
    interactionService.setBeforeCreateHook(
      async (userId: string, threadId: string) => {
        logger.info({ userId, threadId }, "Stopping stream before interaction");
        // Telegram edit-based streaming - no-op needed, the interaction will just appear
      }
    );

    // Register interaction callback handler
    this.interactionRenderer.registerCallbackHandler();

    // Wire interaction renderer to message handler for text-based responses
    if (this.messageHandler) {
      this.messageHandler.setInteractionRenderer(this.interactionRenderer);
    }

    // Create and register auth adapter
    const publicGatewayUrl = services.getPublicGatewayUrl();
    this.authAdapter = new TelegramAuthAdapter(this.bot, publicGatewayUrl);
    platformAuthRegistry.register("telegram", this.authAdapter);

    logger.info("Telegram auth adapter registered");

    // Wire up channel binding service
    const channelBindingService = services.getChannelBindingService();
    if (channelBindingService && this.messageHandler) {
      this.messageHandler.setChannelBindingService(channelBindingService);
      logger.info("Channel binding service wired to Telegram message handler");
    }

    // Wire up agent settings store
    const agentSettingsStore = services.getAgentSettingsStore();
    if (agentSettingsStore && this.messageHandler) {
      this.messageHandler.setAgentSettingsStore(agentSettingsStore);
      logger.info("Agent settings store wired to Telegram message handler");
    }

    // Wire up user agent configuration stores
    if (this.messageHandler) {
      const userAgentsStore = services.getUserAgentsStore();
      const agentMetadataStore = services.getAgentMetadataStore();
      const adminStatusCache = services.getAdminStatusCache();
      this.messageHandler.setUserAgentsStore(userAgentsStore);
      this.messageHandler.setAgentMetadataStore(agentMetadataStore);
      this.messageHandler.setAdminStatusCache(adminStatusCache);
      logger.info(
        "User agents and admin status stores wired to Telegram message handler"
      );
    }

    logger.info("Telegram platform initialized");
  }

  async start(): Promise<void> {
    logger.info("Starting Telegram platform...");

    // Setup message handler before starting bot
    if (this.messageHandler) {
      this.messageHandler.start();
    }

    // Register error handler
    this.bot.catch((err) => {
      logger.error({ error: String(err) }, "Grammy bot error");
    });

    // Start long polling (non-blocking)
    this.bot.start({
      onStart: () => {
        this.running = true;
        logger.info("Telegram bot started (long polling)");
      },
    });

    logger.info("Telegram platform started");
  }

  async stop(): Promise<void> {
    logger.info("Stopping Telegram platform...");

    if (this.messageHandler) {
      this.messageHandler.stop();
    }

    if (this.responseRenderer) {
      this.responseRenderer.cleanup();
    }

    this.bot.stop();
    this.running = false;

    logger.info("Telegram platform stopped");
  }

  isHealthy(): boolean {
    return this.running;
  }

  getResponseRenderer(): ResponseRenderer | undefined {
    return this.responseRenderer;
  }

  buildDeploymentMetadata(
    threadId: string,
    channelId: string,
    platformMetadata: Record<string, any>
  ): Record<string, string> {
    return {
      chat_id: String(platformMetadata?.chatId || channelId),
      thread_id: threadId,
      is_group: String(platformMetadata?.isGroup || false),
    };
  }

  async renderInteraction(interaction: UserInteraction): Promise<void> {
    if (this.interactionRenderer) {
      await this.interactionRenderer.renderInteraction(interaction);
    }
  }

  async renderSuggestion(suggestion: UserSuggestion): Promise<void> {
    if (this.interactionRenderer) {
      await this.interactionRenderer.renderSuggestion(suggestion);
    }
  }

  async setThreadStatus(
    channelId: string,
    _threadId: string,
    status: string | null
  ): Promise<void> {
    if (status && this.bot) {
      try {
        await this.bot.api.sendChatAction(Number(channelId), "typing");
      } catch {
        // Ignore typing indicator errors
      }
    }
  }

  isOwnBotToken(_token: string): boolean {
    return false;
  }

  async sendMessage(
    _token: string,
    message: string,
    options: {
      agentId: string;
      channelId: string;
      threadId: string;
      teamId: string;
      files?: Array<{ buffer: Buffer; filename: string }>;
    }
  ): Promise<{
    messageId: string;
    eventsUrl?: string;
    queued?: boolean;
  }> {
    const chatId = Number(options.channelId);

    // Clean @me mention
    const cleanMessage = message.replace(/@me\s*/g, "").trim();

    const sent = await this.bot.api.sendMessage(chatId, cleanMessage);

    return {
      messageId: String(sent.message_id),
    };
  }

  isGroupChannel(channelId: string): boolean {
    // Telegram group chat IDs are negative
    const chatId = Number(channelId);
    return chatId < 0;
  }

  getDisplayInfo(): { name: string; icon: string; logoUrl?: string } {
    return {
      name: "Telegram",
      icon: `<svg viewBox="0 0 24 24" fill="#26A5E4" xmlns="http://www.w3.org/2000/svg"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>`,
    };
  }

  extractRoutingInfo(body: Record<string, unknown>): {
    channelId: string;
    threadId: string;
    teamId?: string;
  } | null {
    const telegram = body.telegram as { chatId?: string | number } | undefined;
    if (!telegram?.chatId) return null;

    return {
      channelId: String(telegram.chatId),
      threadId: "",
    };
  }

  async getConversationHistory(
    channelId: string,
    _threadId: string | undefined,
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
    if (!this.messageHandler) {
      return { messages: [], nextCursor: null, hasMore: false };
    }

    return this.messageHandler.getHistory(channelId, limit, before);
  }
}

/**
 * Telegram platform factory for declarative registration.
 */
const telegramFactory: PlatformFactory = {
  name: "telegram",

  isEnabled(configs: PlatformConfigs): boolean {
    return configs.telegram?.enabled === true;
  },

  create(
    configs: PlatformConfigs,
    agentOptions: FactoryAgentOptions,
    sessionTimeoutMinutes: number
  ) {
    const platformConfig: TelegramPlatformConfig = {
      telegram: configs.telegram,
    };
    return new TelegramPlatform(
      platformConfig,
      agentOptions,
      sessionTimeoutMinutes
    );
  },
};

// Register factory on module load
platformFactoryRegistry.register(telegramFactory);
