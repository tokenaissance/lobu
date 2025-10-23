/**
 * Tests for ProgressProcessor message handling
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { ProgressProcessor } from "../claude/processor";

describe("ProgressProcessor", () => {
  let processor: ProgressProcessor;

  beforeEach(() => {
    processor = new ProgressProcessor();
  });

  describe("Initialization", () => {
    test("creates ProgressProcessor instance", () => {
      expect(processor).toBeDefined();
      expect(processor).toBeInstanceOf(ProgressProcessor);
    });

    test("initializes with empty state", () => {
      expect(processor.getOutput()).toEqual([]);
      expect(processor.getFinalResult()).toBeNull();
    });
  });

  describe("Assistant Message Processing", () => {
    test("processes text assistant messages", () => {
      const message = {
        type: "assistant" as const,
        content: [
          { type: "text" as const, text: "Hello, I can help you with that." },
        ],
      };

      const result = processor.processMessage(message);
      expect(result).toContain("Hello, I can help you with that.");
    });

    test("processes assistant messages with thinking blocks", () => {
      const message = {
        type: "assistant" as const,
        content: [
          { type: "thinking" as const, content: "Let me think about this..." },
          { type: "text" as const, text: "Here's my response." },
        ],
      };

      const result = processor.processMessage(message);
      expect(result).toContain("Here's my response.");
      // Thinking content should not be included in output
      expect(result).not.toContain("Let me think about this...");
    });

    test("processes assistant messages with tool use blocks", () => {
      const message = {
        type: "assistant" as const,
        content: [
          { type: "text" as const, text: "I'll read the file for you." },
          {
            type: "tool_use" as const,
            id: "tool_1",
            name: "Read",
            input: { file_path: "/path/to/file.txt" },
          },
        ],
      };

      const result = processor.processMessage(message);
      expect(result).toContain("I'll read the file for you.");
      expect(result).toContain("reading: file.txt");
    });

    test("handles empty assistant messages", () => {
      const message = {
        type: "assistant" as const,
        content: [],
      };

      const result = processor.processMessage(message);
      expect(result).toBe("");
    });

    test("handles assistant messages with mixed content types", () => {
      const message = {
        type: "assistant" as const,
        content: [
          { type: "text" as const, text: "First, " },
          { type: "thinking" as const, content: "Should I do this?" },
          { type: "text" as const, text: "let me check the code." },
          {
            type: "tool_use" as const,
            id: "tool_1",
            name: "Grep",
            input: { pattern: "function.*test" },
          },
        ],
      };

      const result = processor.processMessage(message);
      expect(result).toContain("First, let me check the code.");
      expect(result).toContain("searching: function.*test");
      expect(result).not.toContain("Should I do this?");
    });
  });

  describe("Tool Call Processing", () => {
    test("processes Bash tool calls", () => {
      const message = {
        type: "tool_call" as const,
        tool: "Bash",
        input: {
          command: "npm install",
          description: "Install dependencies",
        },
      };

      const result = processor.processMessage(message);
      expect(result).toContain("running: npm install");
    });

    test("processes Read tool calls", () => {
      const message = {
        type: "tool_call" as const,
        tool: "Read",
        input: {
          file_path: "/src/components/Button.tsx",
        },
      };

      const result = processor.processMessage(message);
      expect(result).toContain("reading: Button.tsx");
    });

    test("processes Write tool calls", () => {
      const message = {
        type: "tool_call" as const,
        tool: "Write",
        input: {
          file_path: "/src/utils/helper.ts",
          content: "export const helper = () => {}",
        },
      };

      const result = processor.processMessage(message);
      expect(result).toContain("writing: helper.ts");
    });

    test("processes Edit tool calls", () => {
      const message = {
        type: "tool_call" as const,
        tool: "Edit",
        input: {
          file_path: "/src/config.ts",
          old_string: "const API_URL = 'old'",
          new_string: "const API_URL = 'new'",
        },
      };

      const result = processor.processMessage(message);
      expect(result).toContain("editing: config.ts");
    });

    test("processes Grep tool calls", () => {
      const message = {
        type: "tool_call" as const,
        tool: "Grep",
        input: {
          pattern: "TODO.*urgent",
          glob: "**/*.ts",
        },
      };

      const result = processor.processMessage(message);
      expect(result).toContain("searching: TODO.*urgent");
    });

    test("processes Glob tool calls", () => {
      const message = {
        type: "tool_call" as const,
        tool: "Glob",
        input: {
          pattern: "**/*.test.ts",
        },
      };

      const result = processor.processMessage(message);
      expect(result).toContain("finding: **/*.test.ts");
    });

    test("processes TodoWrite tool calls", () => {
      const message = {
        type: "tool_call" as const,
        tool: "TodoWrite",
        input: {
          todos: [
            {
              content: "Fix the bug",
              status: "pending",
              activeForm: "Fixing the bug",
            },
            {
              content: "Write tests",
              status: "completed",
              activeForm: "Writing tests",
            },
          ],
        },
      };

      const result = processor.processMessage(message);
      expect(result).toContain("updating tasks");
    });

    test("handles tool calls with missing input", () => {
      const message = {
        type: "tool_call" as const,
        tool: "Read",
        // missing input
      };

      const result = processor.processMessage(message);
      expect(result).toContain("reading:");
      expect(result).not.toThrow;
    });

    test("handles unknown tool calls", () => {
      const message = {
        type: "tool_call" as const,
        tool: "UnknownTool",
        input: { someParam: "value" },
      };

      const result = processor.processMessage(message);
      expect(result).toContain("executing: UnknownTool");
    });
  });

  describe("Tool Result Processing", () => {
    test("processes successful tool results", () => {
      const message = {
        type: "tool_result" as const,
        tool: "Read",
        result: "File contents:\nexport const config = {};",
      };

      const result = processor.processMessage(message);
      expect(result).toContain("File contents:");
      expect(result).toContain("export const config = {};");
    });

    test("processes tool result errors", () => {
      const message = {
        type: "tool_result" as const,
        tool: "Bash",
        error: "Command 'npm test' failed with exit code 1",
      };

      const result = processor.processMessage(message);
      expect(result).toContain("Error:");
      expect(result).toContain("Command 'npm test' failed with exit code 1");
    });

    test("handles tool results with both result and error", () => {
      const message = {
        type: "tool_result" as const,
        tool: "Bash",
        result: "Partial output before error",
        error: "Command failed",
      };

      const result = processor.processMessage(message);
      expect(result).toContain("Partial output before error");
      expect(result).toContain("Error: Command failed");
    });

    test("handles empty tool results", () => {
      const message = {
        type: "tool_result" as const,
        tool: "Grep",
        // no result or error
      };

      const result = processor.processMessage(message);
      expect(result).toBe(""); // Should handle gracefully
    });
  });

  describe("Result Message Processing", () => {
    test("processes final result messages", () => {
      const message = {
        type: "result" as const,
        content:
          "Task completed successfully! The application is now ready for deployment.",
      };

      const result = processor.processMessage(message);
      expect(result).toContain("Task completed successfully!");

      // Should also set as final result
      const finalResult = processor.getFinalResult();
      expect(finalResult).toEqual({
        text: "Task completed successfully! The application is now ready for deployment.",
        isFinal: true,
      });
    });

    test("handles empty result messages", () => {
      const message = {
        type: "result" as const,
        content: "",
      };

      const result = processor.processMessage(message);
      expect(result).toBe("");

      const finalResult = processor.getFinalResult();
      expect(finalResult).toEqual({
        text: "",
        isFinal: true,
      });
    });
  });

  describe("Error Message Processing", () => {
    test("processes error messages", () => {
      const message = {
        type: "error" as const,
        error: "Authentication failed: Invalid API key",
      };

      const result = processor.processMessage(message);
      expect(result).toContain("Error:");
      expect(result).toContain("Authentication failed: Invalid API key");
    });

    test("handles error messages with additional context", () => {
      const message = {
        type: "error" as const,
        error: "File not found",
        context: {
          file_path: "/missing/file.txt",
          operation: "read",
        },
      };

      const result = processor.processMessage(message);
      expect(result).toContain("Error: File not found");
    });
  });

  describe("System Message Processing", () => {
    test("skips system messages", () => {
      const message = {
        type: "system" as const,
        content: "Session initialized",
      };

      const result = processor.processMessage(message);
      expect(result).toBeNull();
    });
  });

  describe("Unknown Message Processing", () => {
    test("handles unknown message types", () => {
      const message = {
        type: "unknown_type" as any,
        data: "some data",
      };

      const result = processor.processMessage(message);
      expect(result).toBeNull();
    });
  });

  describe("Output Collection", () => {
    test("collects output chronologically", () => {
      const messages = [
        {
          type: "assistant" as const,
          content: [{ type: "text" as const, text: "Starting task..." }],
        },
        {
          type: "tool_call" as const,
          tool: "Read",
          input: { file_path: "/file.txt" },
        },
        {
          type: "assistant" as const,
          content: [{ type: "text" as const, text: "Task completed." }],
        },
      ];

      for (const msg of messages) {
        processor.processMessage(msg);
      }

      const output = processor.getOutput();
      expect(output).toHaveLength(3);
      expect(output[0]).toContain("Starting task...");
      expect(output[1]).toContain("reading: file.txt");
      expect(output[2]).toContain("Task completed.");
    });

    test("filters out null results", () => {
      const messages = [
        {
          type: "assistant" as const,
          content: [{ type: "text" as const, text: "Valid message" }],
        },
        {
          type: "system" as const,
          content: "System message (should be filtered)",
        },
        {
          type: "assistant" as const,
          content: [{ type: "text" as const, text: "Another valid message" }],
        },
      ];

      for (const msg of messages) {
        processor.processMessage(msg);
      }

      const output = processor.getOutput();
      expect(output).toHaveLength(2);
      expect(output[0]).toContain("Valid message");
      expect(output[1]).toContain("Another valid message");
    });
  });

  describe("Final Result Tracking", () => {
    test("tracks only the latest final result", () => {
      const result1 = {
        type: "result" as const,
        content: "First result",
      };

      const result2 = {
        type: "result" as const,
        content: "Second result",
      };

      processor.processMessage(result1);
      processor.processMessage(result2);

      const finalResult = processor.getFinalResult();
      expect(finalResult).toEqual({
        text: "Second result",
        isFinal: true,
      });
    });

    test("preserves final result after other messages", () => {
      const resultMessage = {
        type: "result" as const,
        content: "Final result",
      };

      const assistantMessage = {
        type: "assistant" as const,
        content: [{ type: "text" as const, text: "Additional message" }],
      };

      processor.processMessage(resultMessage);
      processor.processMessage(assistantMessage);

      const finalResult = processor.getFinalResult();
      expect(finalResult).toEqual({
        text: "Final result",
        isFinal: true,
      });
    });
  });

  describe("State Management", () => {
    test("resets state correctly", () => {
      // Add some content
      processor.processMessage({
        type: "assistant" as const,
        content: [{ type: "text" as const, text: "Some content" }],
      });

      processor.processMessage({
        type: "result" as const,
        content: "Final result",
      });

      // Verify state has content
      expect(processor.getOutput()).toHaveLength(2);
      expect(processor.getFinalResult()).not.toBeNull();

      // Reset
      processor.reset();

      // Verify state is cleared
      expect(processor.getOutput()).toEqual([]);
      expect(processor.getFinalResult()).toBeNull();
    });
  });

  describe("Edge Cases", () => {
    test("handles null/undefined messages", () => {
      expect(() => processor.processMessage(null as any)).not.toThrow();
      expect(() => processor.processMessage(undefined as any)).not.toThrow();
    });

    test("handles messages without required fields", () => {
      const malformedMessage = {
        type: "assistant" as const,
        // missing content
      };

      expect(() =>
        processor.processMessage(malformedMessage as any)
      ).not.toThrow();
    });

    test("handles large messages efficiently", () => {
      const largeMessage = {
        type: "assistant" as const,
        content: [
          {
            type: "text" as const,
            text: "x".repeat(10000), // 10KB of text
          },
        ],
      };

      const start = Date.now();
      const result = processor.processMessage(largeMessage);
      const duration = Date.now() - start;

      expect(result).toContain("x".repeat(10000));
      expect(duration).toBeLessThan(100); // Should process quickly
    });

    test("handles Unicode and special characters", () => {
      const message = {
        type: "assistant" as const,
        content: [
          {
            type: "text" as const,
            text: "Unicode test: 🚀 émojis and spéciál çharacters",
          },
        ],
      };

      const result = processor.processMessage(message);
      expect(result).toContain("🚀 émojis and spéciál çharacters");
    });
  });

  describe("Tool Status Formatting", () => {
    test("extracts filename from file paths correctly", () => {
      const tests = [
        { path: "/absolute/path/to/file.txt", expected: "file.txt" },
        { path: "relative/path/file.js", expected: "file.js" },
        { path: "file.py", expected: "file.py" },
        { path: "/path/with spaces/file name.txt", expected: "file name.txt" },
      ];

      tests.forEach(({ path, expected }) => {
        const message = {
          type: "tool_call" as const,
          tool: "Read",
          input: { file_path: path },
        };

        const result = processor.processMessage(message);
        expect(result).toContain(`reading: ${expected}`);
      });
    });

    test("handles commands with descriptions", () => {
      const message = {
        type: "tool_call" as const,
        tool: "Bash",
        input: {
          command: "git commit -m 'feat: add new feature'",
          description: "Commit the changes",
        },
      };

      const result = processor.processMessage(message);
      expect(result).toContain(
        "running: git commit -m 'feat: add new feature'"
      );
    });

    test("truncates very long commands appropriately", () => {
      const longCommand = `echo ${"x".repeat(200)}`;
      const message = {
        type: "tool_call" as const,
        tool: "Bash",
        input: { command: longCommand },
      };

      const result = processor.processMessage(message);
      expect(result).toContain("running:");
      expect(result.length).toBeLessThan(300); // Should be truncated
    });
  });
});
