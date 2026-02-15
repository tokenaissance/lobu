import { createLogger } from "@lobu/core";
import { marked } from "marked";

const logger = createLogger("whatsapp-markdown");

/**
 * Custom renderer for converting markdown to WhatsApp's formatting syntax.
 *
 * WhatsApp supports:
 * - Bold: *text*
 * - Italic: _text_
 * - Strikethrough: ~text~
 * - Monospace: `text` (inline) or ```text``` (block)
 * - Block quotes: > text
 * - Lists: - item or 1. item
 */
class WhatsAppRenderer extends marked.Renderer {
  heading(text: string, _level: number): string {
    // WhatsApp doesn't have native headings - make them bold
    let processedText = text;

    // Convert markdown bold (**text**) to WhatsApp bold (*text*)
    processedText = processedText.replace(/\*\*(.+?)\*\*/g, "*$1*");

    // Convert markdown bold (__text__) to WhatsApp bold (*text*)
    processedText = processedText.replace(/__(.+?)__/g, "*$1*");

    // Make heading text bold if not already
    if (!processedText.startsWith("*") || !processedText.endsWith("*")) {
      processedText = `*${processedText}*`;
    }

    return `${processedText}\n\n`;
  }

  paragraph(text: string): string {
    return `${text}\n\n`;
  }

  strong(text: string): string {
    return `*${text}*`;
  }

  em(text: string): string {
    return `_${text}_`;
  }

  del(text: string): string {
    // Strikethrough in WhatsApp is ~text~
    return `~${text}~`;
  }

  code(text: string): string {
    // Code block - use triple backticks
    return `\`\`\`\n${text}\n\`\`\``;
  }

  codespan(text: string): string {
    // Inline code
    return `\`${text}\``;
  }

  blockquote(quote: string): string {
    const trimmed = quote.trim();
    const lines = trimmed.split("\n");
    return `${lines.map((line) => `> ${line.trim()}`).join("\n")}\n\n`;
  }

  list(body: string, ordered: boolean, start: number | ""): string {
    if (ordered) {
      // Renumber the list items
      let counter = typeof start === "number" ? start : 1;
      const lines = body.trim().split("\n");
      const renumbered = lines.map((line) => {
        if (line.startsWith("• ")) {
          return `${counter++}. ${line.substring(2)}`;
        }
        return line;
      });
      return `${renumbered.join("\n")}\n\n`;
    }
    return `${body}\n`;
  }

  listitem(text: string): string {
    return `• ${text.trim()}\n`;
  }

  link(href: string, _title: string | null | undefined, text: string): string {
    // WhatsApp doesn't support rich links - show text and URL
    if (text === href || !text) {
      return href;
    }
    return `${text}: ${href}`;
  }

  image(href: string, _title: string | null, text: string): string {
    // Images can't be rendered inline - show as link
    if (text) {
      return `[Image: ${text}] ${href}`;
    }
    return `[Image] ${href}`;
  }

  br(): string {
    return "\n";
  }

  hr(): string {
    return "\n---\n\n";
  }
}

/**
 * Convert markdown to WhatsApp's formatting syntax.
 */
export function convertMarkdownToWhatsApp(content: string): string {
  if (typeof content !== "string") {
    logger.warn(
      `convertMarkdownToWhatsApp received non-string content (type: ${typeof content}), converting to string`
    );
    content =
      typeof content === "object" ? JSON.stringify(content) : String(content);
  }

  // Handle empty content
  if (!content.trim()) {
    return content;
  }

  const renderer = new WhatsAppRenderer();

  // Pre-process triple backtick code blocks
  const preprocessed = content.replace(
    /```(\w*)\n?([\s\S]*?)```/g,
    (match, lang, code) => {
      if (code?.trim()) {
        const langAttr = lang ? ` class="language-${lang}"` : "";
        return `<pre><code${langAttr}>${code.trim()}</code></pre>`;
      }
      return match;
    }
  );

  marked.setOptions({
    renderer: renderer,
    breaks: true,
    gfm: true,
  });

  try {
    let processed = marked.parse(preprocessed) as string;

    // Clean up extra whitespace
    processed = processed.replace(/\n{3,}/g, "\n\n").trim();

    // Convert code blocks back to WhatsApp format (triple backticks)
    processed = processed.replace(
      /<pre><code(?:\s+class="language-(\w+)")?>([\s\S]*?)<\/code><\/pre>/g,
      (_match, _language, code) => {
        const decodedCode = code
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&amp;/g, "&")
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'");

        return `\`\`\`\n${decodedCode.trim()}\n\`\`\``;
      }
    );

    // Clean up remaining HTML entities
    processed = processed
      .replace(/&gt;/g, ">")
      .replace(/&lt;/g, "<")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");

    return processed;
  } catch (error) {
    logger.error("Failed to parse markdown:", error);
    return content;
  }
}
