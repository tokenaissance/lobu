/**
 * Telegram interaction renderer (fire-and-forget).
 * Uses inline keyboards for questions. Button clicks become regular messages.
 */

import { createLogger, type UserSuggestion } from "@lobu/core";
import { type Bot, InlineKeyboard } from "grammy";
import type { InteractionService, PostedQuestion } from "../interactions";
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

/**
 * Telegram interaction renderer.
 */
export class TelegramInteractionRenderer {
  private storedQuestions = new Map<string, StoredQuestion>();
  private cleanupTimer?: NodeJS.Timeout;

  constructor(
    private bot: Bot,
    private interactionService: InteractionService
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

    // Periodic cleanup of expired stored questions
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
