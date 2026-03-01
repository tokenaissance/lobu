/**
 * Telegram block builder.
 * Extracts settings link buttons from markdown and converts content
 * to Telegram HTML with an optional inline keyboard for native buttons.
 */

import {
  extractSettingsLinkButtons,
  type LinkButton,
} from "../../platform/link-buttons";
import { convertMarkdownToTelegramHtml } from "./markdown";

export type InlineKeyboardButton = { text: string; url: string };
export type InlineKeyboard = { inline_keyboard: InlineKeyboardButton[][] };

export interface TelegramBlockResult {
  html: string;
  replyMarkup?: InlineKeyboard;
}

export class TelegramBlockBuilder {
  /**
   * Build Telegram HTML content with optional inline keyboard buttons
   * extracted from settings links in the markdown.
   */
  build(markdown: string): TelegramBlockResult {
    const { processedContent, linkButtons } =
      extractSettingsLinkButtons(markdown);

    const html = convertMarkdownToTelegramHtml(processedContent);
    const replyMarkup = this.buildReplyMarkup(linkButtons);

    return { html, replyMarkup };
  }

  private buildReplyMarkup(buttons: LinkButton[]): InlineKeyboard | undefined {
    if (buttons.length === 0) return undefined;

    return {
      inline_keyboard: buttons.map((btn) => [{ text: btn.text, url: btn.url }]),
    };
  }
}
