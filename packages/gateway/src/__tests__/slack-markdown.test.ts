import { describe, expect, test } from "bun:test";
import { convertMarkdownToSlack } from "../slack/converters/markdown";

describe("convertMarkdownToSlack", () => {
  test("converts bold to Slack format", () => {
    const result = convertMarkdownToSlack("**bold text**");
    expect(result).toContain("*bold text*");
  });

  test("converts italic to Slack format", () => {
    const result = convertMarkdownToSlack("*italic text*");
    expect(result).toContain("_italic text_");
  });

  test("converts inline code", () => {
    const result = convertMarkdownToSlack("use `console.log`");
    expect(result).toContain("`console.log`");
  });

  test("converts links to Slack format", () => {
    const result = convertMarkdownToSlack("[Click here](https://example.com)");
    expect(result).toContain("<https://example.com|Click here>");
  });

  test("converts unordered lists to bullet points", () => {
    const result = convertMarkdownToSlack("- item one\n- item two");
    expect(result).toContain("• item one");
    expect(result).toContain("• item two");
  });

  test("converts horizontal rule", () => {
    const result = convertMarkdownToSlack("above\n\n---\n\nbelow");
    expect(result).toContain("---");
  });

  test("handles empty content", () => {
    expect(convertMarkdownToSlack("")).toBe("");
  });

  test("handles non-string content (ensureString fallback)", () => {
    // @ts-expect-error testing non-string input
    const result = convertMarkdownToSlack(null);
    expect(typeof result).toBe("string");
  });

  test("collapses triple+ newlines to double", () => {
    const result = convertMarkdownToSlack("a\n\n\n\n\nb");
    expect(result).not.toContain("\n\n\n");
  });

  test("converts single-line code block to backticks", () => {
    const result = convertMarkdownToSlack("```\nconst x = 1;\n```");
    expect(result).toContain("`const x = 1;`");
  });

  test("converts multi-line code block to indented format", () => {
    const result = convertMarkdownToSlack(
      "```js\nconst a = 1;\nconst b = 2;\n```"
    );
    expect(result).toContain("    const a = 1;");
    expect(result).toContain("    const b = 2;");
  });

  test("adds spacing for tool lines (└ prefix)", () => {
    const result = convertMarkdownToSlack("└ Running task A");
    expect(result).toContain("└ Running task A");
  });

  test("handles blockquotes", () => {
    const result = convertMarkdownToSlack("> a quote");
    expect(result).toContain("> a quote");
  });

  test("decodes HTML entities in output", () => {
    const result = convertMarkdownToSlack("A &amp; B");
    expect(result).toContain("A & B");
  });
});
