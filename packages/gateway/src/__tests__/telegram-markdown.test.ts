import { describe, expect, test } from "bun:test";
import { convertMarkdownToTelegramHtml } from "../telegram/converters/markdown";

describe("convertMarkdownToTelegramHtml", () => {
  test("converts bold **text** to <b>", () => {
    const result = convertMarkdownToTelegramHtml("**bold**");
    expect(result).toContain("<b>bold</b>");
  });

  test("converts bold __text__ to <b>", () => {
    const result = convertMarkdownToTelegramHtml("__bold__");
    expect(result).toContain("<b>bold</b>");
  });

  test("converts italic *text* to <i>", () => {
    const result = convertMarkdownToTelegramHtml("*italic*");
    expect(result).toContain("<i>italic</i>");
  });

  test("converts strikethrough ~~text~~ to <s>", () => {
    const result = convertMarkdownToTelegramHtml("~~strike~~");
    expect(result).toContain("<s>strike</s>");
  });

  test("converts inline code to <code>", () => {
    const result = convertMarkdownToTelegramHtml("use `console.log`");
    expect(result).toContain("<code>console.log</code>");
  });

  test("converts code block to <pre><code>", () => {
    const result = convertMarkdownToTelegramHtml("```js\nconst x = 1;\n```");
    expect(result).toContain("<pre><code");
    expect(result).toContain("const x = 1;");
    expect(result).toContain("</code></pre>");
  });

  test("converts links to <a href>", () => {
    const result = convertMarkdownToTelegramHtml(
      "[Click](https://example.com)"
    );
    expect(result).toContain('<a href="https://example.com">Click</a>');
  });

  test("converts headings to bold", () => {
    const result = convertMarkdownToTelegramHtml("# Title");
    expect(result).toContain("<b>Title</b>");
  });

  test("converts h2-h6 to bold", () => {
    expect(convertMarkdownToTelegramHtml("## Subtitle")).toContain(
      "<b>Subtitle</b>"
    );
    expect(convertMarkdownToTelegramHtml("###### Small")).toContain(
      "<b>Small</b>"
    );
  });

  test("converts blockquotes and merges consecutive", () => {
    const result = convertMarkdownToTelegramHtml("> line one\n> line two");
    expect(result).toContain("<blockquote>");
    expect(result).toContain("line one");
    expect(result).toContain("line two");
    // Should merge consecutive blockquotes (no </blockquote>\n<blockquote>)
    expect(result).not.toContain("</blockquote>\n<blockquote>");
  });

  test("converts horizontal rule", () => {
    const result = convertMarkdownToTelegramHtml("---");
    expect(result).toContain("---");
  });

  test("escapes HTML in non-code content", () => {
    const result = convertMarkdownToTelegramHtml("a < b & c > d");
    expect(result).toContain("&lt;");
    expect(result).toContain("&amp;");
    expect(result).toContain("&gt;");
  });

  test("escapes HTML inside code blocks", () => {
    const result = convertMarkdownToTelegramHtml("```\n<div>&test</div>\n```");
    expect(result).toContain("&lt;div&gt;");
    expect(result).toContain("&amp;test");
  });

  test("handles empty content", () => {
    expect(convertMarkdownToTelegramHtml("")).toBe("");
  });

  test("handles whitespace-only content", () => {
    expect(convertMarkdownToTelegramHtml("   ")).toBe("   ");
  });

  test("handles non-string input via ensureString", () => {
    // @ts-expect-error testing non-string input
    const result = convertMarkdownToTelegramHtml(null);
    expect(typeof result).toBe("string");
  });

  test("protects inline code from HTML escaping", () => {
    const result = convertMarkdownToTelegramHtml("use `a < b` here");
    expect(result).toContain("<code>a &lt; b</code>");
  });

  test("handles multiple code blocks", () => {
    const result = convertMarkdownToTelegramHtml(
      "```\nfirst\n```\ntext\n```\nsecond\n```"
    );
    expect(result).toContain("first");
    expect(result).toContain("second");
  });

  test("collapses excessive newlines", () => {
    const result = convertMarkdownToTelegramHtml("a\n\n\n\n\nb");
    expect(result).not.toContain("\n\n\n");
  });
});
