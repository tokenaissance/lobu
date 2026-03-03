import { describe, expect, test } from "bun:test";
import { TelegramBlockBuilder } from "../telegram/converters/block-builder";

describe("TelegramBlockBuilder", () => {
  const builder = new TelegramBlockBuilder();

  test("converts markdown to HTML", () => {
    const result = builder.build("**bold** text");
    expect(result.html).toContain("<b>bold</b>");
    expect(result.html).toContain("text");
  });

  test("returns no replyMarkup when no settings links", () => {
    const result = builder.build("No links here");
    expect(result.replyMarkup).toBeUndefined();
  });

  test("extracts settings link into inline keyboard", () => {
    const result = builder.build(
      "Click [Settings](https://app.example.com/settings#st=abc123) to configure"
    );
    expect(result.replyMarkup).toBeDefined();
    expect(result.replyMarkup!.inline_keyboard).toHaveLength(1);
    const button = result.replyMarkup!.inline_keyboard[0]![0]!;
    expect(button.text).toBe("Settings");
    expect("web_app" in button).toBe(true);
    if ("web_app" in button) {
      expect(button.web_app.url).toContain("settings");
    }
  });

  test("strips settings link from HTML content", () => {
    const result = builder.build(
      "Click [Settings](https://app.example.com/settings#st=abc123) to continue"
    );
    // The markdown link should be replaced with just the label
    expect(result.html).toContain("Settings");
    expect(result.html).not.toContain("https://app.example.com");
  });

  test("handles multiple settings links", () => {
    const result = builder.build(
      "[A](https://a.com/settings#st=1) and [B](https://b.com/settings#st=2)"
    );
    expect(result.replyMarkup!.inline_keyboard).toHaveLength(2);
  });

  test("handles empty markdown", () => {
    const result = builder.build("");
    expect(result.html).toBe("");
    expect(result.replyMarkup).toBeUndefined();
  });

  test("handles code blocks", () => {
    const result = builder.build("```js\nconst x = 1;\n```");
    expect(result.html).toContain("<pre>");
    expect(result.html).toContain("const x = 1;");
  });
});
