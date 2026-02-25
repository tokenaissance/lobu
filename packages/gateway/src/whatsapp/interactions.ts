/**
 * WhatsApp interaction renderer (fire-and-forget).
 * Posts questions as list messages. User responses flow through normal message handling.
 */

import { createLogger, type UserSuggestion } from "@lobu/core";
import type { AnyMessageContent } from "@whiskeysockets/baileys";
import type { InteractionService, PostedQuestion } from "../interactions";
import { formatNumberedOptions } from "../platform/interaction-utils";
import type { BaileysClient } from "./connection/baileys-client";

const logger = createLogger("whatsapp-interactions");

// Maximum options for list messages (WhatsApp limit is 10)
const MAX_LIST_OPTIONS = 10;

/**
 * WhatsApp interaction renderer.
 * Renders questions as list messages or numbered text.
 * WhatsApp list/button responses ARE already regular messages —
 * they flow through WhatsAppMessageHandler.processMessage() naturally.
 */
export class WhatsAppInteractionRenderer {
  constructor(
    private client: BaileysClient,
    private interactionService: InteractionService
  ) {
    // Subscribe to question:created events
    this.interactionService.on(
      "question:created",
      (question: PostedQuestion) => {
        if (question.teamId !== "whatsapp") return;

        this.renderQuestion(question).catch((error) => {
          logger.error("Failed to render question:", error);
        });
      }
    );
  }

  /**
   * Render a question with options.
   */
  async renderQuestion(question: PostedQuestion): Promise<void> {
    const chatJid = question.channelId;

    logger.info({ questionId: question.id, chatJid }, "Rendering question");

    // Try list message first, fall back to numbered text
    if (
      question.options.length > 0 &&
      question.options.length <= MAX_LIST_OPTIONS
    ) {
      const sent = await this.sendListMessage(
        chatJid,
        question.question,
        question.options
      );
      if (sent) {
        logger.info(
          { questionId: question.id, chatJid },
          "Question rendered (list)"
        );
        return;
      }
    }

    // Fallback to numbered text
    const message =
      question.options.length > 0
        ? formatNumberedOptions(question.question, question.options)
        : question.question;

    await this.client.sendMessage(chatJid, { text: message });
    logger.info(
      { questionId: question.id, chatJid, fallback: true },
      "Question rendered (text fallback)"
    );
  }

  /**
   * Send list message. Returns true on success.
   */
  private async sendListMessage(
    chatJid: string,
    question: string,
    options: string[]
  ): Promise<boolean> {
    try {
      const listContent: AnyMessageContent = {
        text: question,
        buttonText: "Choose Option",
        sections: [
          {
            title: "Options",
            rows: options.map((opt, i) => ({
              title: opt.length > 24 ? `${opt.substring(0, 21)}...` : opt,
              description: opt.length > 24 ? opt : undefined,
              rowId: String(i + 1),
            })),
          },
        ],
      } as any;

      await this.client.sendMessage(chatJid, listContent);
      return true;
    } catch (err) {
      logger.warn(
        { error: String(err), chatJid },
        "List message failed, falling back to numbered text"
      );
      return false;
    }
  }

  /**
   * Render suggestions.
   */
  async renderSuggestion(suggestion: UserSuggestion): Promise<void> {
    const { channelId, prompts } = suggestion;

    if (!prompts || prompts.length === 0) return;

    const chatJid = (suggestion as any).platformMetadata?.jid || channelId;

    const lines = ["Here are some suggestions:"];
    for (const s of prompts) {
      lines.push(`• ${s.title}`);
      if (s.message) {
        lines.push(`  ${s.message}`);
      }
    }

    const message = lines.join("\n");
    await this.client.sendMessage(chatJid, { text: message });

    logger.info(
      { chatJid, promptCount: prompts.length },
      "Suggestions rendered"
    );
  }
}
