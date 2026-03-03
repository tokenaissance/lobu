import { describe, expect, test } from "bun:test";
import { SlackBlockBuilder } from "../slack/converters/block-builder";

describe("SlackBlockBuilder", () => {
  const builder = new SlackBlockBuilder();

  describe("buildBlocks", () => {
    test("returns text and blocks for simple content", () => {
      const result = builder.buildBlocks("Hello world");
      expect(result.text).toContain("Hello world");
      expect(result.blocks).toHaveLength(1);
      expect(result.blocks[0]).toMatchObject({
        type: "section",
        text: { type: "mrkdwn" },
      });
    });

    test("returns empty blocks for empty content", () => {
      const result = builder.buildBlocks("");
      expect(result.text).toBe("");
      expect(result.blocks).toHaveLength(0);
    });

    test("splits long text into multiple section blocks", () => {
      const longText = "a".repeat(4000);
      const result = builder.buildBlocks(longText, { maxTextLength: 2000 });
      expect(result.blocks.length).toBeGreaterThan(1);
      for (const block of result.blocks) {
        expect(block.type).toBe("section");
      }
    });

    test("adds action buttons with divider", () => {
      const result = builder.buildBlocks("content", {
        actionButtons: [{ text: "Click me", action_id: "btn-1" }],
      });
      // Should have: section + divider + actions = 3 blocks
      expect(result.blocks).toHaveLength(3);
      expect(result.blocks[0]!.type).toBe("section");
      expect(result.blocks[1]!.type).toBe("divider");
      expect(result.blocks[2]!.type).toBe("actions");
    });

    test("filters invalid buttons", () => {
      const result = builder.buildBlocks("content", {
        actionButtons: [
          { text: "", action_id: "btn-1" }, // empty text = invalid
          { text: "Valid", action_id: "btn-2" },
        ],
      });
      const actionsBlock = result.blocks.find(
        (b: any) => b.type === "actions"
      ) as any;
      expect(actionsBlock.elements).toHaveLength(1);
      expect(actionsBlock.elements[0].text.text).toBe("Valid");
    });

    test("creates URL buttons when url provided", () => {
      const result = builder.buildBlocks("content", {
        actionButtons: [
          { text: "Open", url: "https://example.com", action_id: "link" },
        ],
      });
      const actionsBlock = result.blocks.find(
        (b: any) => b.type === "actions"
      ) as any;
      expect(actionsBlock.elements[0].url).toBe("https://example.com");
    });

    test("truncates blocks exceeding maxBlocks limit", () => {
      // Create content that would produce many blocks
      const longText = Array.from({ length: 60 }, (_, i) => `Line ${i}`).join(
        "\n".repeat(10)
      );
      const result = builder.buildBlocks(longText, {
        maxBlocks: 5,
        maxTextLength: 50,
      });
      expect(result.blocks.length).toBeLessThanOrEqual(5);
      // Last block should be truncation notice
      const lastBlock = result.blocks[result.blocks.length - 1] as any;
      expect(lastBlock.text.text).toContain("truncated");
    });

    test("skips action buttons with no valid entries", () => {
      const result = builder.buildBlocks("content", {
        actionButtons: [
          { text: "", action_id: "" }, // invalid
        ],
      });
      // Should only have the section block (no divider or actions)
      expect(result.blocks).toHaveLength(1);
      expect(result.blocks[0]!.type).toBe("section");
    });
  });

  describe("buildErrorBlocks", () => {
    test("returns error section block", () => {
      const result = builder.buildErrorBlocks("Something went wrong");
      expect(result.text).toContain("Error");
      expect(result.blocks).toHaveLength(1);
      expect(result.blocks[0]!.type).toBe("section");
    });

    test("includes action buttons in error blocks", () => {
      const result = builder.buildErrorBlocks("Error message", [
        { text: "Retry", action_id: "retry" },
      ]);
      expect(result.blocks.length).toBeGreaterThan(1);
      const actionsBlock = result.blocks.find((b: any) => b.type === "actions");
      expect(actionsBlock).toBeDefined();
    });
  });
});
