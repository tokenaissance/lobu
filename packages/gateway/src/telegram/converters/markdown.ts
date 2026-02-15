/**
 * Convert markdown to Telegram HTML format.
 *
 * Telegram's HTML parse mode supports:
 * - <b>bold</b>
 * - <i>italic</i>
 * - <s>strikethrough</s>
 * - <code>inline code</code>
 * - <pre>code block</pre>
 * - <a href="url">link</a>
 * - <blockquote>quote</blockquote>
 */

import { createLogger } from "@lobu/core";

const logger = createLogger("telegram-markdown");

/**
 * Escape HTML special characters for Telegram.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Convert markdown to Telegram HTML format.
 */
export function convertMarkdownToTelegramHtml(content: string): string {
  if (typeof content !== "string") {
    logger.warn(
      `convertMarkdownToTelegramHtml received non-string content (type: ${typeof content}), converting to string`
    );
    content =
      typeof content === "object" ? JSON.stringify(content) : String(content);
  }

  if (!content.trim()) {
    return content;
  }

  try {
    let result = content;

    // Extract and protect code blocks first
    const codeBlocks: string[] = [];
    result = result.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
      const idx = codeBlocks.length;
      const langAttr = lang ? ` class="language-${escapeHtml(lang)}"` : "";
      codeBlocks.push(
        `<pre><code${langAttr}>${escapeHtml(code.trim())}</code></pre>`
      );
      return `\x00CODE_BLOCK_${idx}\x00`;
    });

    // Extract and protect inline code
    const inlineCodes: string[] = [];
    result = result.replace(/`([^`]+)`/g, (_, code) => {
      const idx = inlineCodes.length;
      inlineCodes.push(`<code>${escapeHtml(code)}</code>`);
      return `\x00INLINE_CODE_${idx}\x00`;
    });

    // Escape remaining HTML
    result = escapeHtml(result);

    // Headings (# text) -> bold
    result = result.replace(/^(#{1,6})\s+(.+)$/gm, (_, _hashes, text) => {
      return `<b>${text.trim()}</b>`;
    });

    // Bold: **text** or __text__
    result = result.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
    result = result.replace(/__(.+?)__/g, "<b>$1</b>");

    // Italic: *text* or _text_ (but not inside words with underscores)
    result = result.replace(/(?<!\w)\*([^*]+?)\*(?!\w)/g, "<i>$1</i>");
    result = result.replace(/(?<!\w)_([^_]+?)_(?!\w)/g, "<i>$1</i>");

    // Strikethrough: ~~text~~
    result = result.replace(/~~(.+?)~~/g, "<s>$1</s>");

    // Links: [text](url)
    result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

    // Block quotes: > text
    result = result.replace(/^&gt;\s?(.+)$/gm, "<blockquote>$1</blockquote>");
    // Merge consecutive blockquotes
    result = result.replace(/<\/blockquote>\n<blockquote>/g, "\n");

    // Horizontal rule
    result = result.replace(/^---+$/gm, "\n---\n");

    // Restore code blocks
    for (let i = 0; i < codeBlocks.length; i++) {
      result = result.replace(`\x00CODE_BLOCK_${i}\x00`, codeBlocks[i]!);
    }

    // Restore inline code
    for (let i = 0; i < inlineCodes.length; i++) {
      result = result.replace(`\x00INLINE_CODE_${i}\x00`, inlineCodes[i]!);
    }

    // Clean up excess newlines
    result = result.replace(/\n{3,}/g, "\n\n").trim();

    return result;
  } catch (error) {
    logger.error("Failed to convert markdown:", error);
    return escapeHtml(content);
  }
}
