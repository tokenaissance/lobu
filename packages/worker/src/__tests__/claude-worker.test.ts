/**
 * Tests for ClaudeWorker concrete implementation
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { ClaudeWorker } from "../claude/worker";
import { TestHelpers, mockWorkerConfig } from "./setup";
import type { WorkerConfig } from "../types";

// Mock the Claude Agent SDK
const mockClaudeAgent = {
  runAgent: mock(async () => ({
    success: true,
    exitCode: 0,
    output: "Claude execution completed",
    sessionKey: "test-session-key",
  })),
  createSession: mock(() => "new-session-id"),
  continueSession: mock(() => "continued-session-id"),
};

// Mock the module to avoid actual Claude SDK dependency
mock.module("@anthropic-ai/claude-agent-sdk", () => ({
  Agent: mockClaudeAgent,
}));

describe("ClaudeWorker", () => {
  let claudeWorker: ClaudeWorker;
  let restoreFetch: () => void;

  beforeEach(() => {
    claudeWorker = new ClaudeWorker(mockWorkerConfig);
    restoreFetch = TestHelpers.mockFetch({
      [`${process.env.DISPATCHER_URL}/worker/session/test-session-key/status`]:
        { success: true },
      [`${process.env.DISPATCHER_URL}/worker/session/test-session-key/content`]:
        { success: true },
      [`${process.env.DISPATCHER_URL}/worker/session/test-session-key/done`]: {
        success: true,
      },
    });

    // Reset mocks
    mockClaudeAgent.runAgent.mockClear();
    mockClaudeAgent.createSession.mockClear();
    mockClaudeAgent.continueSession.mockClear();
  });

  afterEach(() => {
    restoreFetch();
  });

  describe("Initialization", () => {
    test("creates ClaudeWorker instance", () => {
      expect(claudeWorker).toBeDefined();
      expect(claudeWorker).toBeInstanceOf(ClaudeWorker);
    });

    test("parses Claude options from config", () => {
      const configWithOptions: WorkerConfig = {
        ...mockWorkerConfig,
        agentOptions: JSON.stringify({
          model: "claude-3-5-sonnet-20241022",
          max_tokens: 4096,
          temperature: 0.7,
        }),
      };

      const worker = new ClaudeWorker(configWithOptions);
      expect(worker).toBeDefined();
    });

    test("handles invalid Claude options gracefully", () => {
      const configWithInvalidOptions: WorkerConfig = {
        ...mockWorkerConfig,
        agentOptions: "invalid-json",
      };

      // Should still create worker, using defaults
      expect(() => new ClaudeWorker(configWithInvalidOptions)).not.toThrow();
    });
  });

  describe("Agent Name", () => {
    test("returns correct agent name", () => {
      // Access protected method for testing
      const agentName = (claudeWorker as any).getAgentName();
      expect(agentName).toBe("claude");
    });
  });

  describe("Loading Messages", () => {
    test("returns loading messages for new session", () => {
      const messages = (claudeWorker as any).getLoadingMessages(false);
      expect(messages).toBeArray();
      expect(messages.length).toBeGreaterThan(0);
      expect(messages.every((msg: string) => typeof msg === "string")).toBe(
        true
      );
    });

    test("returns different messages for resumed session", () => {
      const newMessages = (claudeWorker as any).getLoadingMessages(false);
      const resumeMessages = (claudeWorker as any).getLoadingMessages(true);

      expect(newMessages).not.toEqual(resumeMessages);
      expect(resumeMessages).toBeArray();
      expect(resumeMessages.length).toBeGreaterThan(0);
    });
  });

  describe("Core Instruction Provider", () => {
    test("returns instruction provider", () => {
      const provider = (claudeWorker as any).getCoreInstructionProvider();
      expect(provider).toBeDefined();
      expect(provider.name).toBe("claude");
      expect(typeof provider.priority).toBe("number");
      expect(typeof provider.getInstructions).toBe("function");
    });

    test("instruction provider generates instructions", async () => {
      const provider = (claudeWorker as any).getCoreInstructionProvider();
      const instructions = await provider.getInstructions(
        TestHelpers.createMockInstructionContext()
      );

      expect(instructions).toBeString();
      expect(instructions.length).toBeGreaterThan(0);
    });
  });

  describe("Session Management", () => {
    test("handles new session", async () => {
      const config = { ...mockWorkerConfig };
      delete config.sessionId;
      delete config.resumeSessionId;

      const worker = new ClaudeWorker(config);

      // Mock the AI session run
      mockClaudeAgent.runAgent.mockResolvedValueOnce({
        success: true,
        exitCode: 0,
        output: "New session completed",
        sessionKey: "test-session-key",
      });

      await worker.execute();

      expect(mockClaudeAgent.runAgent).toHaveBeenCalled();
    });

    test("handles session resume", async () => {
      const configWithResume: WorkerConfig = {
        ...mockWorkerConfig,
        resumeSessionId: "existing-session-id",
      };

      const worker = new ClaudeWorker(configWithResume);

      mockClaudeAgent.runAgent.mockResolvedValueOnce({
        success: true,
        exitCode: 0,
        output: "Resumed session completed",
        sessionKey: "test-session-key",
      });

      await worker.execute();

      expect(mockClaudeAgent.runAgent).toHaveBeenCalled();
    });

    test("handles session continuation", async () => {
      const configWithContinue: WorkerConfig = {
        ...mockWorkerConfig,
        sessionId: "session-to-continue",
      };

      const worker = new ClaudeWorker(configWithContinue);

      mockClaudeAgent.runAgent.mockResolvedValueOnce({
        success: true,
        exitCode: 0,
        output: "Continued session completed",
        sessionKey: "test-session-key",
      });

      await worker.execute();

      expect(mockClaudeAgent.runAgent).toHaveBeenCalled();
    });
  });

  describe("Progress Processing", () => {
    test("processes assistant messages", async () => {
      const progressUpdate = TestHelpers.createMockProgressUpdate("output", {
        type: "assistant",
        content: [{ type: "text", text: "Hello from Claude!" }],
      });

      const result = await (claudeWorker as any).processProgressUpdate(
        progressUpdate
      );
      expect(result).toBeString();
      expect(result).toContain("Hello from Claude!");
    });

    test("processes tool use messages", async () => {
      const progressUpdate = TestHelpers.createMockProgressUpdate("output", {
        type: "tool_call",
        tool: "Bash",
        input: { command: "ls -la" },
      });

      const result = await (claudeWorker as any).processProgressUpdate(
        progressUpdate
      );
      expect(result).toBeString();
      expect(result).toContain("running:");
    });

    test("processes tool result messages", async () => {
      const progressUpdate = TestHelpers.createMockProgressUpdate("output", {
        type: "tool_result",
        tool: "Read",
        result: "File contents here",
      });

      const result = await (claudeWorker as any).processProgressUpdate(
        progressUpdate
      );
      expect(result).toBeString();
    });

    test("handles error messages", async () => {
      const progressUpdate = TestHelpers.createMockProgressUpdate("error", {
        message: "Something went wrong",
      });

      const result = await (claudeWorker as any).processProgressUpdate(
        progressUpdate
      );
      expect(result).toBeString();
      expect(result).toContain("Something went wrong");
    });

    test("returns null for unhandled message types", async () => {
      const progressUpdate = TestHelpers.createMockProgressUpdate("output", {
        type: "unknown_type",
        data: "some data",
      });

      const result = await (claudeWorker as any).processProgressUpdate(
        progressUpdate
      );
      expect(result).toBeNull();
    });
  });

  describe("Tool Status Mapping", () => {
    test("maps Bash tool correctly", async () => {
      const progressUpdate = TestHelpers.createMockProgressUpdate("output", {
        type: "tool_call",
        tool: "Bash",
        input: { command: "git status", description: "Check git status" },
      });

      const result = await (claudeWorker as any).processProgressUpdate(
        progressUpdate
      );
      expect(result).toContain("running: git status");
    });

    test("maps Read tool correctly", async () => {
      const progressUpdate = TestHelpers.createMockProgressUpdate("output", {
        type: "tool_call",
        tool: "Read",
        input: { file_path: "/path/to/file.ts" },
      });

      const result = await (claudeWorker as any).processProgressUpdate(
        progressUpdate
      );
      expect(result).toContain("reading: file.ts");
    });

    test("maps Write tool correctly", async () => {
      const progressUpdate = TestHelpers.createMockProgressUpdate("output", {
        type: "tool_call",
        tool: "Write",
        input: { file_path: "/path/to/new-file.ts" },
      });

      const result = await (claudeWorker as any).processProgressUpdate(
        progressUpdate
      );
      expect(result).toContain("writing: new-file.ts");
    });

    test("maps Edit tool correctly", async () => {
      const progressUpdate = TestHelpers.createMockProgressUpdate("output", {
        type: "tool_call",
        tool: "Edit",
        input: { file_path: "/path/to/edit-file.ts" },
      });

      const result = await (claudeWorker as any).processProgressUpdate(
        progressUpdate
      );
      expect(result).toContain("editing: edit-file.ts");
    });

    test("maps Grep tool correctly", async () => {
      const progressUpdate = TestHelpers.createMockProgressUpdate("output", {
        type: "tool_call",
        tool: "Grep",
        input: { pattern: "searchTerm" },
      });

      const result = await (claudeWorker as any).processProgressUpdate(
        progressUpdate
      );
      expect(result).toContain("searching: searchTerm");
    });

    test("handles tools with missing input gracefully", async () => {
      const progressUpdate = TestHelpers.createMockProgressUpdate("output", {
        type: "tool_call",
        tool: "Read",
        // missing input
      });

      const result = await (claudeWorker as any).processProgressUpdate(
        progressUpdate
      );
      expect(result).toBeString(); // Should not throw
    });
  });

  describe("Final Result Handling", () => {
    test("returns final result when available", () => {
      // Simulate having a final result
      (claudeWorker as any).finalOutput = "Final Claude output";

      const result = (claudeWorker as any).getFinalResult();
      expect(result).toEqual({
        text: "Final Claude output",
        isFinal: true,
      });
    });

    test("returns null when no final result", () => {
      // Ensure no final result is set
      (claudeWorker as any).finalOutput = null;

      const result = (claudeWorker as any).getFinalResult();
      expect(result).toBeNull();
    });
  });

  describe("Progress State Management", () => {
    test("resets progress state", () => {
      // Set some state
      (claudeWorker as any).finalOutput = "Some output";
      (claudeWorker as any).progressBuffer = ["Some progress"];

      // Reset
      (claudeWorker as any).resetProgressState();

      // Verify reset
      expect((claudeWorker as any).finalOutput).toBeNull();
      expect((claudeWorker as any).progressBuffer).toEqual([]);
    });
  });

  describe("Session Cleanup", () => {
    test("cleans up session resources", async () => {
      await (claudeWorker as any).cleanupSession("test-session-key");

      // Should complete without errors
      // Actual cleanup logic depends on implementation
    });
  });

  describe("Error Handling", () => {
    test("handles Claude SDK errors gracefully", async () => {
      mockClaudeAgent.runAgent.mockRejectedValueOnce(
        new Error("Claude SDK error")
      );

      await expect(claudeWorker.execute()).rejects.toThrow("Claude SDK error");
    });

    test("handles malformed progress updates", async () => {
      const malformedUpdate = TestHelpers.createMockProgressUpdate(
        "output",
        null
      );

      const result = await (claudeWorker as any).processProgressUpdate(
        malformedUpdate
      );
      expect(result).toBeNull(); // Should handle gracefully
    });

    test("handles invalid tool names", async () => {
      const progressUpdate = TestHelpers.createMockProgressUpdate("output", {
        type: "tool_call",
        tool: "NonExistentTool",
        input: { someParam: "value" },
      });

      const result = await (claudeWorker as any).processProgressUpdate(
        progressUpdate
      );
      expect(result).toBeString(); // Should handle gracefully
    });
  });

  describe("Configuration Edge Cases", () => {
    test("handles empty Claude options", () => {
      const configWithEmptyOptions: WorkerConfig = {
        ...mockWorkerConfig,
        agentOptions: "{}",
      };

      expect(() => new ClaudeWorker(configWithEmptyOptions)).not.toThrow();
    });

    test("handles missing optional fields in config", () => {
      const minimalConfig: WorkerConfig = {
        sessionKey: "test",
        userId: "U123",
        channelId: "C123",
        userPrompt: Buffer.from("test").toString("base64"),
        responseChannel: "C123",
        responseId: "123",
        platform: "slack",
        agentOptions: "{}",
        workspace: { baseDirectory: "/tmp" },
      };

      expect(() => new ClaudeWorker(minimalConfig)).not.toThrow();
    });
  });

  describe("Integration with Base Class", () => {
    test("properly extends BaseWorker", () => {
      expect(claudeWorker.getGatewayIntegration).toBeDefined();
      expect(claudeWorker.execute).toBeDefined();
      expect(claudeWorker.cleanup).toBeDefined();
    });

    test("implements all required abstract methods", () => {
      // These should not throw when called
      expect(() => (claudeWorker as any).getAgentName()).not.toThrow();
      expect(() =>
        (claudeWorker as any).getCoreInstructionProvider()
      ).not.toThrow();
      expect(() =>
        (claudeWorker as any).getLoadingMessages(false)
      ).not.toThrow();
      expect(() => (claudeWorker as any).getFinalResult()).not.toThrow();
      expect(() => (claudeWorker as any).resetProgressState()).not.toThrow();
    });
  });
});
