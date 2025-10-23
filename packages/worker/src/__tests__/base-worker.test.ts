/**
 * Tests for BaseWorker abstract class and template method pattern
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { BaseWorker } from "../base/base-worker";
import { TestHelpers, mockWorkerConfig } from "./setup";
import type {
  WorkerConfig,
  ProgressUpdate,
  SessionExecutionResult,
} from "../types";
import type { InstructionProvider } from "../instructions/types";

// Mock concrete implementation for testing
class TestWorker extends BaseWorker {
  private mockAgentName = "test-agent";
  private mockLoadingMessages = ["Testing in progress...", "Please wait..."];
  private mockFinalResult = {
    text: "Test completed successfully",
    isFinal: true,
  };
  private mockSessionResult: SessionExecutionResult = {
    success: true,
    exitCode: 0,
    output: "Test output",
    sessionKey: "test-session-key",
  };

  // Spy objects to track method calls
  public mockCalls = {
    getAgentName: 0,
    getCoreInstructionProvider: 0,
    getLoadingMessages: 0,
    runAISession: 0,
    processProgressUpdate: 0,
    getFinalResult: 0,
    resetProgressState: 0,
    cleanupSession: 0,
  };

  protected getAgentName(): string {
    this.mockCalls.getAgentName++;
    return this.mockAgentName;
  }

  protected getCoreInstructionProvider(): InstructionProvider {
    this.mockCalls.getCoreInstructionProvider++;
    return {
      name: "test-core",
      priority: 0,
      getInstructions: () => "Test core instructions",
    };
  }

  protected getLoadingMessages(isResumedSession: boolean): string[] {
    this.mockCalls.getLoadingMessages++;
    return isResumedSession ? ["Resuming test..."] : this.mockLoadingMessages;
  }

  protected async runAISession(
    _userPrompt: string,
    _customInstructions: string,
    progressCallback: (update: ProgressUpdate) => Promise<void>
  ): Promise<SessionExecutionResult> {
    this.mockCalls.runAISession++;

    // Simulate progress updates
    await progressCallback(
      TestHelpers.createMockProgressUpdate("status", "Starting test session")
    );
    await progressCallback(
      TestHelpers.createMockProgressUpdate("output", "Test output line 1")
    );
    await progressCallback(
      TestHelpers.createMockProgressUpdate("output", "Test output line 2")
    );
    await progressCallback(
      TestHelpers.createMockProgressUpdate("completion", "Test completed")
    );

    return this.mockSessionResult;
  }

  protected async processProgressUpdate(
    update: ProgressUpdate
  ): Promise<string | null> {
    this.mockCalls.processProgressUpdate++;

    switch (update.type) {
      case "status":
        return `Status: ${update.data}`;
      case "output":
        return `Output: ${update.data}`;
      case "completion":
        return `Completed: ${update.data}`;
      case "error":
        return `Error: ${update.data}`;
      default:
        return null;
    }
  }

  protected getFinalResult(): { text: string; isFinal: boolean } | null {
    this.mockCalls.getFinalResult++;
    return this.mockFinalResult;
  }

  protected resetProgressState(): void {
    this.mockCalls.resetProgressState++;
  }

  protected async cleanupSession(_sessionKey: string): Promise<void> {
    this.mockCalls.cleanupSession++;
  }

  // Test helpers
  public setMockSessionResult(result: SessionExecutionResult) {
    this.mockSessionResult = result;
  }

  public setMockFinalResult(result: { text: string; isFinal: boolean } | null) {
    this.mockFinalResult = result;
  }
}

describe("BaseWorker", () => {
  let testWorker: TestWorker;
  let restoreFetch: () => void;

  beforeEach(() => {
    testWorker = new TestWorker(mockWorkerConfig);
    restoreFetch = TestHelpers.mockFetch({
      [`${process.env.DISPATCHER_URL}/worker/session/test-session-key/status`]:
        { success: true },
      [`${process.env.DISPATCHER_URL}/worker/session/test-session-key/content`]:
        { success: true },
      [`${process.env.DISPATCHER_URL}/worker/session/test-session-key/done`]: {
        success: true,
      },
    });
  });

  afterEach(() => {
    restoreFetch();
  });

  describe("Template Method Pattern", () => {
    test("execute() follows proper workflow sequence", async () => {
      await testWorker.execute();

      // Verify all abstract methods were called
      expect(testWorker.mockCalls.getAgentName).toBeGreaterThan(0);
      expect(testWorker.mockCalls.getCoreInstructionProvider).toBeGreaterThan(
        0
      );
      expect(testWorker.mockCalls.getLoadingMessages).toBe(1);
      expect(testWorker.mockCalls.runAISession).toBe(1);
      expect(testWorker.mockCalls.processProgressUpdate).toBeGreaterThan(0);
      expect(testWorker.mockCalls.getFinalResult).toBeGreaterThan(0);
      expect(testWorker.mockCalls.resetProgressState).toBe(1);
    });

    test("workflow handles successful session execution", async () => {
      testWorker.setMockSessionResult({
        success: true,
        exitCode: 0,
        output: "Success output",
        sessionKey: "test-session-key",
      });

      await testWorker.execute();

      expect(testWorker.mockCalls.runAISession).toBe(1);
      expect(testWorker.mockCalls.cleanupSession).toBe(1);
    });

    test("workflow handles failed session execution", async () => {
      testWorker.setMockSessionResult({
        success: false,
        exitCode: 1,
        output: "Error output",
        error: "Test error occurred",
        sessionKey: "test-session-key",
      });

      await testWorker.execute();

      expect(testWorker.mockCalls.runAISession).toBe(1);
      expect(testWorker.mockCalls.cleanupSession).toBe(1);
    });
  });

  describe("Environment Validation", () => {
    test("validates required environment variables", async () => {
      const originalDispatcherUrl = process.env.DISPATCHER_URL;
      delete process.env.DISPATCHER_URL;

      await expect(testWorker.execute()).rejects.toThrow();

      process.env.DISPATCHER_URL = originalDispatcherUrl;
    });

    test("validates worker token", async () => {
      const originalWorkerToken = process.env.WORKER_TOKEN;
      delete process.env.WORKER_TOKEN;

      await expect(testWorker.execute()).rejects.toThrow();

      process.env.WORKER_TOKEN = originalWorkerToken;
    });
  });

  describe("Progress Processing", () => {
    test("processes different types of progress updates", async () => {
      await testWorker.execute();

      // Verify that processProgressUpdate was called for each progress type
      expect(testWorker.mockCalls.processProgressUpdate).toBe(4); // 4 updates in runAISession
    });

    test("handles progress update errors gracefully", async () => {
      // Mock a worker that throws errors in processProgressUpdate
      class ErrorWorker extends TestWorker {
        protected async processProgressUpdate(
          update: ProgressUpdate
        ): Promise<string | null> {
          super.processProgressUpdate(update);
          throw new Error("Progress processing error");
        }
      }

      const errorWorker = new ErrorWorker(mockWorkerConfig);

      // Should not throw, should handle errors gracefully
      await expect(errorWorker.execute()).resolves.not.toThrow();
    });
  });

  describe("Instruction Generation", () => {
    test("generates custom instructions with core provider", async () => {
      await testWorker.execute();

      expect(testWorker.mockCalls.getCoreInstructionProvider).toBe(1);
    });

    test("handles instruction generation errors", async () => {
      class ErrorWorker extends TestWorker {
        protected getCoreInstructionProvider(): InstructionProvider {
          super.getCoreInstructionProvider();
          throw new Error("Instruction generation error");
        }
      }

      const errorWorker = new ErrorWorker(mockWorkerConfig);
      await expect(errorWorker.execute()).rejects.toThrow(
        "Instruction generation error"
      );
    });
  });

  describe("Loading Messages", () => {
    test("shows loading messages for new session", async () => {
      await testWorker.execute();

      expect(testWorker.mockCalls.getLoadingMessages).toBe(1);
    });

    test("shows appropriate messages for resumed session", async () => {
      const configWithResume = {
        ...mockWorkerConfig,
        resumeSessionId: "existing-session-id",
      };

      const resumeWorker = new TestWorker(configWithResume);
      await resumeWorker.execute();

      expect(resumeWorker.mockCalls.getLoadingMessages).toBe(1);
    });
  });

  describe("Final Result Handling", () => {
    test("processes final result when available", async () => {
      testWorker.setMockFinalResult({
        text: "Final test result",
        isFinal: true,
      });

      await testWorker.execute();

      expect(testWorker.mockCalls.getFinalResult).toBeGreaterThan(0);
    });

    test("handles null final result", async () => {
      testWorker.setMockFinalResult(null);

      await testWorker.execute();

      expect(testWorker.mockCalls.getFinalResult).toBeGreaterThan(0);
    });
  });

  describe("Cleanup", () => {
    test("calls cleanup method", async () => {
      await testWorker.cleanup();

      expect(testWorker.mockCalls.cleanupSession).toBe(1);
    });

    test("cleanup is called even after execution errors", async () => {
      class ErrorWorker extends TestWorker {
        protected async runAISession(
          userPrompt: string,
          customInstructions: string,
          progressCallback: (update: ProgressUpdate) => Promise<void>
        ): Promise<SessionExecutionResult> {
          await super.runAISession(
            userPrompt,
            customInstructions,
            progressCallback
          );
          throw new Error("Session execution error");
        }
      }

      const errorWorker = new ErrorWorker(mockWorkerConfig);

      await expect(errorWorker.execute()).rejects.toThrow(
        "Session execution error"
      );
      expect(errorWorker.mockCalls.cleanupSession).toBe(1);
    });
  });

  describe("Gateway Integration", () => {
    test("has gateway integration available", () => {
      const gateway = testWorker.getGatewayIntegration();
      expect(gateway).not.toBeNull();
    });

    test("gateway integration can update status", async () => {
      const gateway = testWorker.getGatewayIntegration();
      expect(gateway).not.toBeNull();

      // Should not throw
      await expect(gateway!.updateStatus("Test status")).resolves.not.toThrow();
    });

    test("gateway integration can send content", async () => {
      const gateway = testWorker.getGatewayIntegration();
      expect(gateway).not.toBeNull();

      // Should not throw
      await expect(gateway!.sendContent("Test content")).resolves.not.toThrow();
    });
  });

  describe("Workspace Setup", () => {
    test("sets up workspace directory", async () => {
      await testWorker.execute();

      // Execution should complete without errors, indicating workspace was set up
      expect(testWorker.mockCalls.runAISession).toBe(1);
    });
  });

  describe("Configuration Handling", () => {
    test("processes worker config correctly", () => {
      expect(testWorker).toBeDefined();
      // BaseWorker should accept and store configuration
    });

    test("handles missing optional config fields", () => {
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

      const minimalWorker = new TestWorker(minimalConfig);
      expect(minimalWorker).toBeDefined();
    });
  });

  describe("Error Recovery", () => {
    test("resets progress state on execution start", async () => {
      await testWorker.execute();

      expect(testWorker.mockCalls.resetProgressState).toBe(1);
    });

    test("handles network errors gracefully", async () => {
      // Mock network failure
      const errorRestore = TestHelpers.mockFetch({});
      global.fetch = async () => {
        throw new Error("Network error");
      };

      await expect(testWorker.execute()).rejects.toThrow();

      errorRestore();
    });
  });
});
