/**
 * Simplified tests for BaseWorker after streaming/status refactor.
 * Focuses on execution flow, error handling, and cleanup hooks.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { InstructionProvider } from "@termosdev/core";
import { BaseWorker } from "../core/base-worker";
import type { ProgressUpdate, SessionExecutionResult } from "../core/types";
import { mockWorkerConfig, TestHelpers } from "./setup";

class TestWorker extends BaseWorker {
  public calls = {
    getAgentName: 0,
    getCoreInstructionProvider: 0,
    runAISession: 0,
    processProgressUpdate: 0,
    cleanupSession: 0,
    resetProgressState: 0,
  };

  private result: SessionExecutionResult = {
    success: true,
    exitCode: 0,
    output: "Test output",
    sessionKey: mockWorkerConfig.sessionKey,
  };

  protected getAgentName(): string {
    this.calls.getAgentName++;
    return "Test Agent";
  }

  protected getCoreInstructionProvider(): InstructionProvider {
    this.calls.getCoreInstructionProvider++;
    return {
      name: "test",
      priority: 0,
      getInstructions: () => "Test instructions",
    };
  }

  protected async runAISession(
    _prompt: string,
    _customInstructions: string,
    onProgress: (update: ProgressUpdate) => Promise<void>
  ): Promise<SessionExecutionResult> {
    this.calls.runAISession++;
    await onProgress({
      type: "output",
      data: { message: "partial" },
      timestamp: Date.now(),
    });
    await onProgress({
      type: "completion",
      data: { success: true },
      timestamp: Date.now(),
    });
    return this.result;
  }

  protected async processProgressUpdate(
    _update: ProgressUpdate
  ): Promise<string | null> {
    this.calls.processProgressUpdate++;
    return "delta";
  }

  protected getFinalResult(): { text: string; isFinal: boolean } | null {
    return null;
  }

  protected resetProgressState(): void {
    this.calls.resetProgressState++;
  }

  protected async cleanupSession(_sessionKey: string): Promise<void> {
    this.calls.cleanupSession++;
  }

  public setSessionResult(result: SessionExecutionResult) {
    this.result = result;
  }
}

describe("BaseWorker", () => {
  let worker: TestWorker;
  let restoreFetch: () => void;

  beforeEach(() => {
    worker = new TestWorker(mockWorkerConfig);
    restoreFetch = TestHelpers.mockFetch();
  });

  afterEach(() => {
    restoreFetch();
  });

  test("execute runs AI session and processes progress", async () => {
    await worker.execute();

    expect(worker.calls.getAgentName).toBeGreaterThan(0);
    expect(worker.calls.getCoreInstructionProvider).toBeGreaterThan(0);
    expect(worker.calls.runAISession).toBe(1);
    expect(worker.calls.processProgressUpdate).toBeGreaterThan(0);
    expect(worker.calls.resetProgressState).toBe(1);
  });

  test("execute handles non-success results by signaling error", async () => {
    worker.setSessionResult({
      success: false,
      exitCode: 1,
      output: "",
      error: "boom",
      sessionKey: mockWorkerConfig.sessionKey,
    });

    await worker.execute();
    expect(worker.calls.runAISession).toBe(1);
  });

  test("constructor requires dispatcher configuration", () => {
    const original = process.env.DISPATCHER_URL;
    delete process.env.DISPATCHER_URL;

    expect(
      () => new TestWorker({ ...mockWorkerConfig, sessionKey: "missing" })
    ).toThrow(
      "DISPATCHER_URL and WORKER_TOKEN environment variables are required"
    );

    process.env.DISPATCHER_URL = original;
  });

  test("cleanup delegates to cleanupSession", async () => {
    await worker.cleanup();
    expect(worker.calls.cleanupSession).toBe(1);
  });
});
