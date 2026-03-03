/**
 * Telegram interaction renderer (fire-and-forget).
 * Uses inline keyboards for questions. Button clicks become regular messages.
 */

import { createLogger, type UserSuggestion } from "@lobu/core";
import { type Bot, InlineKeyboard } from "grammy";
import type { QueueProducer } from "../infrastructure/queue/queue-producer";
import type {
  InteractionService,
  PostedGrantRequest,
  PostedLinkButton,
  PostedQuestion,
} from "../interactions";
import type { GrantStore } from "../permissions/grant-store";
import { formatNumberedOptions } from "../platform/interaction-utils";

const logger = createLogger("telegram-interactions");

// Telegram inline keyboard button text limit
const MAX_BUTTON_TEXT = 64;

// Auto-cleanup after 1 hour
const OPTIONS_TTL_MS = 60 * 60 * 1000;

/**
 * In-memory options map for resolving callback_data → selected option text.
 * Keyed by short question ID, auto-cleanup after 1h.
 */
interface StoredQuestion {
  options: string[];
  chatId: number;
  question: string;
  createdAt: number;
}

interface StoredGrant {
  userId: string;
  agentId: string;
  chatId: number;
  conversationId: string;
  domains: string[];
  reason: string;
  createdAt: number;
}

/**
 * Telegram interaction renderer.
 */
export class TelegramInteractionRenderer {
  private storedQuestions = new Map<string, StoredQuestion>();
  private storedGrants = new Map<string, StoredGrant>();
  private cleanupTimer?: NodeJS.Timeout;

  constructor(
    private bot: Bot,
    private interactionService: InteractionService,
    private grantStore?: GrantStore,
    private queueProducer?: QueueProducer
  ) {
    // Subscribe to question:created events
    this.interactionService.on(
      "question:created",
      (question: PostedQuestion) => {
        if (question.teamId !== "telegram") return;

        this.renderQuestion(question).catch((error) => {
          logger.error("Failed to render question:", error);
        });
      }
    );

    // Subscribe to grant:requested events
    this.interactionService.on("grant:requested", (req: PostedGrantRequest) => {
      if (req.teamId !== "telegram") return;

      this.renderGrantRequest(req).catch((error) => {
        logger.error("Failed to render grant request:", error);
      });
    });

    // Subscribe to link-button:created events
    this.interactionService.on(
      "link-button:created",
      (btn: PostedLinkButton) => {
        if (btn.platform !== "telegram") return;

        this.renderLinkButton(btn).catch((error) => {
          logger.error("Failed to render link button:", error);
        });
      }
    );

    // Periodic cleanup of expired stored questions and grants
    this.cleanupTimer = setInterval(
      () => this.cleanupExpired(),
      OPTIONS_TTL_MS
    );
  }

  /**
   * Register handler for callback query responses.
   */
  registerCallbackHandler(): void {
    this.bot.on("callback_query:data", async (ctx) => {
      const data = ctx.callbackQuery.data;
      await this.handleCallbackQuery(ctx, data);
    });

    logger.info("Telegram interaction callback handler registered");
  }

  /**
   * Handle callback query from inline keyboard.
   * Looks up stored options, sends selected text as a regular message.
   */
  private async handleCallbackQuery(ctx: any, data: string): Promise<void> {
    // Handle grant callbacks: "g:{shortId}:{action}"
    if (data.startsWith("g:")) {
      await this.handleGrantCallback(ctx, data);
      return;
    }

    // Parse callback data: "q:{shortId}:{optionIdx}"
    if (!data.startsWith("q:")) {
      await ctx.answerCallbackQuery();
      return;
    }

    const parts = data.split(":");
    const shortId = parts[1] || "";
    const optionIndex = parseInt(parts[2] || "0", 10);

    const stored = this.storedQuestions.get(shortId);
    if (!stored) {
      await ctx.answerCallbackQuery({ text: "Question expired" });
      return;
    }

    const selectedOption = stored.options[optionIndex];
    if (!selectedOption) {
      await ctx.answerCallbackQuery({ text: "Invalid option" });
      return;
    }

    try {
      // Answer callback
      await ctx.answerCallbackQuery({ text: `Selected: ${selectedOption}` });

      // Update original message to show selection
      try {
        await ctx.editMessageText(
          `${stored.question}\n\n<b>Selected: ${selectedOption}</b>`,
          { parse_mode: "HTML" }
        );
      } catch {
        // Ignore edit failures
      }

      // Send selected option as a regular message — Telegram message handler picks it up
      await this.bot.api.sendMessage(stored.chatId, selectedOption);

      // Clean up stored question
      this.storedQuestions.delete(shortId);

      logger.info(
        { shortId, selectedOption, chatId: stored.chatId },
        "Question answered, sent as regular message"
      );
    } catch (err) {
      logger.error(
        { error: String(err), shortId },
        "Failed to handle question callback"
      );
      await ctx.answerCallbackQuery({ text: "Error processing response" });
    }
  }

  /**
   * Render a question with inline keyboard buttons.
   */
  async renderQuestion(question: PostedQuestion): Promise<void> {
    const chatId = Number(question.channelId);
    const shortId = question.id.replace("q_", "").substring(0, 8);

    logger.info(
      { questionId: question.id, shortId, chatId },
      "Rendering question"
    );

    // Store options for callback resolution
    this.storedQuestions.set(shortId, {
      options: question.options,
      chatId,
      question: question.question,
      createdAt: Date.now(),
    });

    // Build inline keyboard
    const keyboard = new InlineKeyboard();

    for (let i = 0; i < question.options.length; i++) {
      const option = question.options[i]!;
      const buttonText =
        option.length > MAX_BUTTON_TEXT
          ? `${option.substring(0, MAX_BUTTON_TEXT - 3)}...`
          : option;
      // Fits in 64 bytes: "q:" + 8 char shortId + ":" + index
      const callbackData = `q:${shortId}:${i}`;

      keyboard.text(buttonText, callbackData);

      // Two buttons per row
      if (i % 2 === 1) {
        keyboard.row();
      }
    }

    try {
      await this.bot.api.sendMessage(chatId, question.question, {
        reply_markup: keyboard,
      });
    } catch (err) {
      logger.warn(
        { error: String(err), chatId },
        "Inline keyboard failed, falling back to numbered text"
      );
      const message = formatNumberedOptions(
        question.question,
        question.options
      );
      await this.bot.api.sendMessage(chatId, message);
    }

    logger.info({ questionId: question.id, chatId }, "Question rendered");
  }

  /**
   * Render a grant request with inline keyboard buttons.
   */
  async renderGrantRequest(req: PostedGrantRequest): Promise<void> {
    const chatId = Number(req.channelId);
    const shortId = req.id.replace("gr_", "").substring(0, 8);
    const domainList = req.domains.join(", ");

    logger.info(
      { grantId: req.id, shortId, chatId, domains: req.domains },
      "Rendering grant request"
    );

    // Store for callback resolution
    this.storedGrants.set(shortId, {
      userId: req.userId,
      agentId: req.agentId,
      chatId,
      conversationId: req.conversationId,
      domains: req.domains,
      reason: req.reason,
      createdAt: Date.now(),
    });

    const text = `🔒 Domain access requested\n\nDomains: ${domainList}\nReason: ${req.reason}\n\nApprove to grant network access.`;

    // Callback data fits in 64 bytes: "g:" + 8 char shortId + ":" + action
    const keyboard = new InlineKeyboard()
      .text("✅ Approve (1h)", `g:${shortId}:1h`)
      .text("✅ Approve", `g:${shortId}:perm`)
      .row()
      .text("❌ Deny", `g:${shortId}:deny`);

    try {
      await this.bot.api.sendMessage(chatId, text, {
        reply_markup: keyboard,
      });
    } catch (err) {
      logger.error(
        { error: String(err), chatId },
        "Failed to render grant request"
      );
    }
  }

  /**
   * Render a link button with inline keyboard (web_app).
   */
  async renderLinkButton(btn: PostedLinkButton): Promise<void> {
    const chatId = Number(btn.channelId);

    logger.info(
      { buttonId: btn.id, chatId, linkType: btn.linkType },
      "Rendering link button"
    );

    // OAuth links should open in browser; settings/install use Telegram WebApp.
    const keyboard =
      btn.linkType === "oauth"
        ? new InlineKeyboard().url(btn.label, btn.url)
        : new InlineKeyboard().webApp(btn.label, btn.url);

    try {
      await this.bot.api.sendMessage(
        chatId,
        btn.linkType === "install"
          ? `Tap the button below to install:`
          : btn.linkType === "oauth"
            ? `Tap the button below to connect:`
            : `Tap the button below to open settings:`,
        { reply_markup: keyboard }
      );
    } catch (err) {
      logger.warn(
        { error: String(err), chatId },
        "Primary link button failed, falling back to URL button"
      );
      // Fall back to regular URL button (works for non-HTTPS URLs too)
      const fallbackKeyboard = new InlineKeyboard().url(btn.label, btn.url);
      try {
        await this.bot.api.sendMessage(
          chatId,
          btn.linkType === "install"
            ? `Tap the button below to install:`
            : `Tap the button below to open settings:`,
          { reply_markup: fallbackKeyboard }
        );
      } catch (err2) {
        logger.error(
          { error: String(err2), chatId },
          "Failed to render link button"
        );
      }
    }
  }

  /**
   * Handle grant callback from inline keyboard.
   */
  private async handleGrantCallback(ctx: any, data: string): Promise<void> {
    const parts = data.split(":");
    const shortId = parts[1] || "";
    const action = parts[2] || "";

    const stored = this.storedGrants.get(shortId);
    if (!stored) {
      await ctx.answerCallbackQuery({ text: "Request expired" });
      return;
    }

    // Verify the clicking user matches the request's userId (Telegram numeric ID)
    const clickerId = String(ctx.from?.id);
    if (clickerId !== stored.userId) {
      await ctx.answerCallbackQuery({
        text: "Only the original user can respond",
      });
      return;
    }

    if (!this.grantStore) {
      await ctx.answerCallbackQuery({ text: "Grant store unavailable" });
      return;
    }

    const domainList = stored.domains.join(", ");

    try {
      let resultText: string;

      if (action === "deny") {
        for (const domain of stored.domains) {
          await this.grantStore.grant(stored.agentId, domain, null, true);
        }
        resultText = `❌ Denied access to ${domainList}`;
        await ctx.answerCallbackQuery({ text: "Denied" });
      } else {
        const expiresAt = action === "1h" ? Date.now() + 60 * 60 * 1000 : null;
        const durationLabel = action === "1h" ? " for 1 hour" : "";
        for (const domain of stored.domains) {
          await this.grantStore.grant(stored.agentId, domain, expiresAt);
        }
        resultText = `✅ Approved access to ${domainList}${durationLabel}`;
        await ctx.answerCallbackQuery({ text: "Approved" });
      }

      // Edit original message: keep context, show result as label, remove buttons
      try {
        await ctx.editMessageText(
          `🔒 Domain access requested\n\nDomains: ${domainList}\nReason: ${stored.reason}\n\n${resultText}`,
          { reply_markup: undefined }
        );
      } catch {
        // Ignore edit failures
      }

      // Enqueue message to worker queue (invisible to user)
      if (this.queueProducer) {
        const messageId = `grant_${shortId}_${Date.now()}`;
        await this.queueProducer.enqueueMessage({
          userId: stored.userId,
          conversationId: stored.conversationId,
          messageId,
          channelId: String(stored.chatId),
          teamId: "telegram",
          agentId: stored.agentId,
          botId: "telegram-bot",
          platform: "telegram",
          messageText: resultText.replace(/[✅❌] /, ""),
          platformMetadata: {},
          agentOptions: {},
        });
      }

      // Clean up
      this.storedGrants.delete(shortId);

      logger.info(
        { shortId, action, domains: stored.domains, agentId: stored.agentId },
        "Grant request handled"
      );
    } catch (err) {
      logger.error(
        { error: String(err), shortId },
        "Failed to handle grant callback"
      );
      await ctx.answerCallbackQuery({ text: "Error processing request" });
    }
  }

  /**
   * Render suggestions.
   */
  async renderSuggestion(suggestion: UserSuggestion): Promise<void> {
    const { channelId, prompts } = suggestion;

    if (!prompts || prompts.length === 0) return;

    const chatId = Number(
      (suggestion as any).platformMetadata?.chatId || channelId
    );

    const lines = ["Here are some suggestions:"];
    for (const s of prompts) {
      lines.push(`- ${s.title}`);
      if (s.message) {
        lines.push(`  ${s.message}`);
      }
    }

    const message = lines.join("\n");
    await this.bot.api.sendMessage(chatId, message);

    logger.info(
      { chatId, promptCount: prompts.length },
      "Suggestions rendered"
    );
  }

  /**
   * Cleanup expired stored questions.
   */
  private cleanupExpired(): void {
    const now = Date.now();
    for (const [id, stored] of this.storedQuestions) {
      if (now - stored.createdAt > OPTIONS_TTL_MS) {
        this.storedQuestions.delete(id);
      }
    }
    for (const [id, stored] of this.storedGrants) {
      if (now - stored.createdAt > OPTIONS_TTL_MS) {
        this.storedGrants.delete(id);
      }
    }
  }

  /**
   * Shutdown cleanup.
   */
  shutdown(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
  }
}
