/**
 * Tests for ProgressProcessor message handling aligned with SDK message format
 */

import { beforeEach, describe, expect, test } from "bun:test";
import type {
  SDKAssistantMessage,
  SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { ProgressProcessor } from "../claude/processor";

describe("ProgressProcessor", () => {
  let processor: ProgressProcessor;

  beforeEach(() => {
    processor = new ProgressProcessor();
    processor.reset();
  });

  test("ignores invalid messages", () => {
    expect(
      processor.processUpdate(undefined as unknown as SDKMessage)
    ).toBeNull();
    expect(
      processor.processUpdate({ type: "system" } as SDKMessage)
    ).toBeNull();
  });

  test("processes assistant text content and returns delta", () => {
    const message: SDKAssistantMessage = {
      type: "assistant",
      message: {
        id: "msg_1",
        role: "assistant",
        content: [
          {
            type: "text",
            text: "Hello from Claude",
          },
        ],
      },
    } as SDKAssistantMessage;

    const result = processor.processUpdate(message);
    expect(result).not.toBeNull();
    expect(result?.isFinal).toBeFalse();
    expect(result?.text).toContain("Hello from Claude");

    const delta = processor.getDelta();
    expect(delta).toContain("Hello from Claude");
    expect(processor.getDelta()).toBeNull();
  });

  test("tracks thinking blocks without emitting them in delta", () => {
    const message: SDKAssistantMessage = {
      type: "assistant",
      message: {
        id: "msg_2",
        role: "assistant",
        content: [
          {
            type: "thinking",
            thinking: "Working on it...",
          },
          {
            type: "text",
            text: "All done!",
          },
        ],
      },
    } as SDKAssistantMessage;

    processor.processUpdate(message);
    expect(processor.getCurrentThinking()).toBe("Working on it...");

    const delta = processor.getDelta();
    expect(delta).toContain("All done!");
    expect(delta).not.toContain("Working on it");
  });

  test("formats tool use blocks in chronological output", () => {
    const message: SDKAssistantMessage = {
      type: "assistant",
      message: {
        id: "msg_3",
        role: "assistant",
        content: [
          {
            type: "tool_use",
            name: "Read",
            input: {
              file_path: "/src/index.ts",
            },
          },
        ],
      },
    } as SDKAssistantMessage;

    processor.processUpdate(message);
    const delta = processor.getDelta();
    expect(delta).toContain("📖");
    expect(delta).toContain("index.ts");
  });

  test("captures final result messages separately", () => {
    const resultMessage: SDKMessage = {
      type: "result",
      subtype: "success",
      result: "Final answer",
    } as SDKMessage;

    const result = processor.processUpdate(resultMessage);
    expect(result).not.toBeNull();
    expect(result?.isFinal).toBeTrue();
    expect(result?.text).toBe("Final answer");

    processor.setFinalResult(result!);
    expect(processor.getFinalResult()).toEqual({
      text: "Final answer",
      isFinal: true,
    });
    expect(processor.getFinalResult()).toBeNull();
  });

  test("reset clears accumulated state", () => {
    const message: SDKAssistantMessage = {
      type: "assistant",
      message: {
        id: "msg_reset",
        role: "assistant",
        content: [{ type: "text", text: "Sample" }],
      },
    } as SDKAssistantMessage;

    processor.processUpdate(message);
    expect(processor.getDelta()).toContain("Sample");

    processor.reset();
    expect(processor.getDelta()).toBeNull();
    expect(processor.getCurrentThinking()).toBeNull();
  });
});
