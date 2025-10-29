/**
 * Focused tests for ClaudeWorker after removing status updates.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { ClaudeWorker } from "../claude/worker";
import type { WorkerConfig } from "../core/types";
import { TestHelpers, mockWorkerConfig } from "./setup";

// Mock SDK adapter so we can control streaming behaviour
mock.module("../claude/sdk-adapter", () => ({
  runClaudeWithSDK: mock(async () => ({
    success: true,
    exitCode: 0,
    output: "mock output",
    sessionKey: mockWorkerConfig.sessionKey,
  })),
}));

let claudeWorker: ClaudeWorker;
let restoreFetch: () => void = () => {
  /* noop */
};

const originalEnv = {
  dispatcher: process.env.DISPATCHER_URL,
  token: process.env.WORKER_TOKEN,
};

beforeEach(() => {
  process.env.DISPATCHER_URL =
    originalEnv.dispatcher || "https://test-dispatcher.example.com";
  process.env.WORKER_TOKEN = originalEnv.token || "test-worker-token-123";
  claudeWorker = new ClaudeWorker(mockWorkerConfig);
  restoreFetch = TestHelpers.mockFetch();
});

afterEach(() => {
  restoreFetch();
  process.env.DISPATCHER_URL = originalEnv.dispatcher;
  process.env.WORKER_TOKEN = originalEnv.token;
});

describe("ClaudeWorker", () => {
  test("creates worker instance", () => {
    expect(claudeWorker).toBeInstanceOf(ClaudeWorker);
  });

  test("returns agent name", () => {
    expect((claudeWorker as any).getAgentName()).toBe("Claude Code");
  });

  test("exposes core instruction provider", () => {
    const provider = (claudeWorker as any).getCoreInstructionProvider();
    expect(provider).toBeDefined();
    expect(provider.name).toBe("core");
  });

  test("processProgressUpdate returns delta from processor", async () => {
    const processor = (claudeWorker as any).progressProcessor;
    processor.reset();

    const update = {
      type: "assistant",
      message: {
        content: [{ type: "text", text: "hello" }],
      },
    };

    const delta = await (claudeWorker as any).processProgressUpdate({
      type: "output",
      data: update,
      timestamp: Date.now(),
    });

    expect(delta).toBeString();
  });

  test("execute runs without throwing", async () => {
    await expect(claudeWorker.execute()).resolves.toBeUndefined();
  });

  test("cleanup is a no-op", async () => {
    await expect(claudeWorker.cleanup()).resolves.toBeUndefined();
  });

  test("handles malformed progress update gracefully", async () => {
    const delta = await (claudeWorker as any).processProgressUpdate({
      type: "output",
      data: { type: "system" },
      timestamp: Date.now(),
    });

    expect(delta).toBeNull();
  });

  test("config with empty agent options does not throw", () => {
    const config: WorkerConfig = {
      ...mockWorkerConfig,
      agentOptions: "{}",
    };

    expect(() => new ClaudeWorker(config)).not.toThrow();
  });
});
