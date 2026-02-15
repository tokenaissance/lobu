/**
 * Telegram interaction renderer.
 * Uses inline keyboards for user interactions.
 */

import {
  createLogger,
  type UserInteraction,
  type UserSuggestion,
} from "@lobu/core";
import { InlineKeyboard, type Bot } from "grammy";
import type { InteractionService } from "../interactions";
import {
  APPROVAL_OPTIONS,
  formatNumberedOptions,
  isApprovalInteraction,
  parseOptionResponse,
} from "../platform/interaction-utils";
import type { TelegramConfig } from "./config";

const logger = createLogger("telegram-interactions");

const INTERACTION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// Telegram inline keyboard button text limit
const MAX_BUTTON_TEXT = 64;

/**
 * Telegram interaction renderer.
 */
export class TelegramInteractionRenderer {
  private pendingInteractions = new Map<
    string,
    Array<{
      interactionId: string;
      question: string;
      options: string[];
      chatId: number;
    }>
  >();
  private interactionTimeouts = new Map<string, NodeJS.Timeout>();

  constructor(
    private bot: Bot,
    private interactionService: InteractionService,
    _config: TelegramConfig
  ) {}

  /**
   * Register handler for callback query responses.
   * Only registers callback_query handler on the bot.
   * Text-based interaction responses are handled via tryHandleTextResponse()
   * called from the message handler to avoid consuming message:text events.
   */
  registerCallbackHandler(): void {
    // Handle inline keyboard button clicks
    this.bot.on("callback_query:data", async (ctx) => {
      const data = ctx.callbackQuery.data;
      await this.handleCallbackQuery(ctx, data);
    });

    // Subscribe to interaction:created events
    this.interactionService.on("interaction:created", (interaction) => {
      if (interaction.teamId !== "telegram") return;

      this.renderInteraction(interaction).catch((error) => {
        logger.error("Failed to render interaction:", error);
      });
    });

    logger.info("Telegram interaction callback handler registered");
  }

  /**
   * Try to handle a text message as an interaction response.
   * Returns true if the message was consumed as an interaction response.
   * Called from the message handler before normal processing.
   */
  tryHandleTextResponse(chatId: number, text: string): boolean {
    const chatKey = String(chatId);
    const queue = this.pendingInteractions.get(chatKey);
    if (!queue || queue.length === 0) return false;

    const pending = queue[0];
    if (!pending) return false;

    const selectedIndex = this.parseResponse(text.trim(), pending.options);
    if (selectedIndex === null) return false;

    // Fire and forget the resolution
    this.resolveInteraction(chatKey, queue, selectedIndex).catch((err) => {
      logger.error({ error: String(err) }, "Failed to resolve interaction");
    });

    return true;
  }

  /**
   * Handle callback query from inline keyboard.
   */
  private async handleCallbackQuery(ctx: any, data: string): Promise<void> {
    // Parse callback data: "interact:{interactionId}:{optionIndex}"
    if (!data.startsWith("interact:")) {
      await ctx.answerCallbackQuery();
      return;
    }

    const parts = data.split(":");
    const interactionId = parts[1] || "";
    const optionIndex = parseInt(parts[2] || "0", 10);

    if (!interactionId) {
      await ctx.answerCallbackQuery();
      return;
    }

    // Find the interaction in any chat queue
    for (const [chatKey, queue] of this.pendingInteractions) {
      const pendingIndex = queue.findIndex(
        (p) => p.interactionId === interactionId
      );
      if (pendingIndex === -1) continue;

      const pending = queue[pendingIndex];
      if (!pending) continue;

      const selectedOption = pending.options[optionIndex];
      if (!selectedOption) {
        await ctx.answerCallbackQuery({ text: "Invalid option" });
        return;
      }

      try {
        await this.interactionService.respond(interactionId, {
          answer: selectedOption,
        });

        // Remove from queue
        queue.splice(pendingIndex, 1);

        // Answer callback and update message
        await ctx.answerCallbackQuery({ text: `Selected: ${selectedOption}` });
        try {
          await ctx.editMessageText(
            `${pending.question}\n\n<b>Selected: ${selectedOption}</b>`,
            { parse_mode: "HTML" }
          );
        } catch {
          // Ignore edit failures
        }

        // Show next in queue
        if (pendingIndex === 0 && queue.length > 0) {
          const next = queue[0];
          if (next) {
            await this.sendInteractionMessage(next.chatId, next);
          }
        }

        // Clean up if queue empty
        if (queue.length === 0) {
          this.pendingInteractions.delete(chatKey);
          const timeout = this.interactionTimeouts.get(chatKey);
          if (timeout) {
            clearTimeout(timeout);
            this.interactionTimeouts.delete(chatKey);
          }
        }

        logger.info(
          { interactionId, selectedOption, remainingInQueue: queue.length },
          "Interaction response recorded"
        );
      } catch (err) {
        logger.error(
          { error: String(err), interactionId },
          "Failed to record interaction response"
        );
        await ctx.answerCallbackQuery({ text: "Error processing response" });
      }
      return;
    }

    await ctx.answerCallbackQuery({ text: "Interaction expired" });
  }

  /**
   * Resolve an interaction from text response.
   */
  private async resolveInteraction(
    chatKey: string,
    queue: Array<{
      interactionId: string;
      question: string;
      options: string[];
      chatId: number;
    }>,
    selectedIndex: number
  ): Promise<void> {
    const pending = queue[0];
    if (!pending) return;

    const selectedOption = pending.options[selectedIndex];
    if (!selectedOption) return;

    try {
      await this.interactionService.respond(pending.interactionId, {
        answer: selectedOption,
      });

      queue.shift();

      if (queue.length === 0) {
        this.pendingInteractions.delete(chatKey);
        const timeout = this.interactionTimeouts.get(chatKey);
        if (timeout) {
          clearTimeout(timeout);
          this.interactionTimeouts.delete(chatKey);
        }
      } else {
        const next = queue[0];
        if (next) {
          await this.sendInteractionMessage(next.chatId, next);
        }
      }

      logger.info(
        {
          interactionId: pending.interactionId,
          selectedOption,
          remainingInQueue: queue.length,
        },
        "Interaction response recorded (text)"
      );
    } catch (err) {
      logger.error(
        { error: String(err), interactionId: pending.interactionId },
        "Failed to record interaction response"
      );
    }
  }

  /**
   * Parse user response to get selected option index.
   */
  private parseResponse(text: string, options: string[]): number | null {
    const selected = parseOptionResponse(text, options);
    if (selected === null) return null;
    return options.indexOf(selected);
  }

  /**
   * Render a user interaction.
   */
  async renderInteraction(interaction: UserInteraction): Promise<void> {
    const { id, channelId, interactionType, question, options } = interaction;

    const chatId = Number(
      (interaction as any).platformMetadata?.chatId || channelId
    );
    const chatKey = String(chatId);

    logger.info(
      { interactionId: id, chatId, interactionType },
      "Rendering interaction"
    );

    // Determine options
    let effectiveOptions: string[] = [];
    if (Array.isArray(options) && options.length > 0) {
      effectiveOptions = options;
    } else if (isApprovalInteraction(interactionType)) {
      effectiveOptions = [...APPROVAL_OPTIONS];
    }

    // Check if this is the first in queue
    const existingQueue = this.pendingInteractions.get(chatKey);
    const isFirstInQueue = !existingQueue || existingQueue.length === 0;

    // Store in queue
    if (effectiveOptions.length > 0) {
      this.storePendingInteraction(
        chatKey,
        id,
        question,
        effectiveOptions,
        chatId
      );
    }

    if (!isFirstInQueue) {
      logger.info(
        { interactionId: id, chatId, queuePosition: existingQueue!.length },
        "Interaction queued"
      );
      return;
    }

    // Send interaction message
    if (effectiveOptions.length > 0) {
      await this.sendInteractionMessage(chatId, {
        interactionId: id,
        question,
        options: effectiveOptions,
        chatId,
      });
    } else if (interactionType === "form") {
      await this.bot.api.sendMessage(
        chatId,
        `${question}\n\nPlease type your response:`
      );
    } else {
      await this.bot.api.sendMessage(chatId, question);
    }

    logger.info({ interactionId: id, chatId }, "Interaction rendered");
  }

  /**
   * Send interaction message with inline keyboard.
   */
  private async sendInteractionMessage(
    chatId: number,
    pending: {
      interactionId: string;
      question: string;
      options: string[];
      chatId: number;
    }
  ): Promise<void> {
    const keyboard = new InlineKeyboard();

    for (let i = 0; i < pending.options.length; i++) {
      const option = pending.options[i]!;
      const buttonText =
        option.length > MAX_BUTTON_TEXT
          ? `${option.substring(0, MAX_BUTTON_TEXT - 3)}...`
          : option;
      const callbackData = `interact:${pending.interactionId}:${i}`;

      keyboard.text(buttonText, callbackData);

      // Two buttons per row
      if (i % 2 === 1) {
        keyboard.row();
      }
    }

    try {
      await this.bot.api.sendMessage(chatId, pending.question, {
        reply_markup: keyboard,
      });
    } catch (err) {
      logger.warn(
        { error: String(err), chatId },
        "Inline keyboard failed, falling back to numbered text"
      );
      // Fallback to numbered text
      const message = formatNumberedOptions(pending.question, pending.options);
      await this.bot.api.sendMessage(chatId, message);
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
   * Store pending interaction in queue with timeout cleanup.
   */
  private storePendingInteraction(
    chatKey: string,
    interactionId: string,
    question: string,
    options: string[],
    chatId: number
  ): void {
    let queue = this.pendingInteractions.get(chatKey);
    if (!queue) {
      queue = [];
      this.pendingInteractions.set(chatKey, queue);
    }

    queue.push({ interactionId, question, options, chatId });

    logger.info(
      { interactionId, chatKey, queueLength: queue.length },
      "Added interaction to queue"
    );

    // Reset timeout
    const existingTimeout = this.interactionTimeouts.get(chatKey);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    const timeout = setTimeout(() => {
      const currentQueue = this.pendingInteractions.get(chatKey);
      if (currentQueue && currentQueue.length > 0) {
        logger.warn(
          { chatKey, pendingCount: currentQueue.length },
          "Interaction queue timed out"
        );
      }
      this.pendingInteractions.delete(chatKey);
      this.interactionTimeouts.delete(chatKey);
    }, INTERACTION_TIMEOUT_MS);

    this.interactionTimeouts.set(chatKey, timeout);
  }
}
