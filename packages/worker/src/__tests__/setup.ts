/**
 * Test setup and configuration for base worker architecture tests
 */

import { beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import type { WorkerConfig } from "../types";

// Mock environment variables for testing
export const mockEnvVars = {
  DISPATCHER_URL: "https://test-dispatcher.example.com",
  WORKER_TOKEN: "test-worker-token-123",
  SLACK_THREAD_TS: "1234567890.123456",
  SLACK_RESPONSE_TS: "1234567890.123457",
  WORKER_SESSION_KEY: "test-session-key",
  WORKER_USER_ID: "U1234567890",
  WORKER_CHANNEL_ID: "C1234567890",
  WORKER_USER_PROMPT: Buffer.from("Test user prompt").toString("base64"),
  WORKER_SLACK_RESPONSE_CHANNEL: "C1234567890",
  WORKER_SLACK_RESPONSE_TS: "1234567890.123457",
  WORKER_CLAUDE_OPTIONS: JSON.stringify({
    model: "claude-3-5-sonnet-20241022",
    max_tokens: 8192,
  }),
  WORKER_TEAM_ID: "T1234567890",
  WORKER_WORKSPACE_BASE_DIRECTORY: "/tmp/test-workspace",
};

// Default test configuration
export const mockWorkerConfig: WorkerConfig = {
  sessionKey: "test-session-key",
  userId: "U1234567890",
  channelId: "C1234567890",
  threadId: "1234567890.123456",
  userPrompt: Buffer.from("Test user prompt").toString("base64"),
  responseChannel: "C1234567890",
  responseId: "1234567890.123457",
  platform: "slack",
  agentOptions: JSON.stringify({
    model: "claude-3-5-sonnet-20241022",
    max_tokens: 8192,
  }),
  teamId: "T1234567890",
  workspace: {
    baseDirectory: "/tmp/test-workspace",
  },
};

// Test utility functions
export class TestHelpers {
  static createMockProgressUpdate(
    type: "output" | "completion" | "error" | "status",
    data: any
  ) {
    return {
      type,
      data,
      timestamp: Date.now(),
    };
  }

  static createMockInstructionContext(overrides = {}) {
    return {
      userId: "U1234567890",
      sessionKey: "test-session-key",
      workingDirectory: "/tmp/test-workspace/test-thread",
      projects: [],
      ...overrides,
    };
  }

  static async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  static mockFetch(responses: Record<string, any> = {}) {
    const originalFetch = global.fetch;

    global.fetch = async (url: string | URL, _options?: RequestInit) => {
      const urlString = url.toString();

      if (responses[urlString]) {
        const response = responses[urlString];
        return new Response(JSON.stringify(response), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Default successful response
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    return () => {
      global.fetch = originalFetch;
    };
  }

  static mockEventSource() {
    class MockEventSource {
      url: string;
      readyState: number = 1; // OPEN
      onopen: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;

      constructor(url: string) {
        this.url = url;
        setTimeout(() => {
          if (this.onopen) {
            this.onopen(new Event("open"));
          }
        }, 10);
      }

      close() {
        this.readyState = 2; // CLOSED
      }

      // Helper to simulate receiving messages
      simulateMessage(data: any) {
        if (this.onmessage) {
          this.onmessage(
            new MessageEvent("message", { data: JSON.stringify(data) })
          );
        }
      }

      // Helper to simulate errors
      simulateError() {
        if (this.onerror) {
          this.onerror(new Event("error"));
        }
      }
    }

    const originalEventSource = global.EventSource;
    global.EventSource = MockEventSource as any;

    return () => {
      global.EventSource = originalEventSource;
    };
  }
}

// Global test setup
beforeAll(() => {
  // Set up mock environment variables
  Object.entries(mockEnvVars).forEach(([key, value]) => {
    process.env[key] = value;
  });
});

afterAll(() => {
  // Clean up environment variables
  Object.keys(mockEnvVars).forEach((key) => {
    delete process.env[key];
  });
});

// Per-test cleanup
beforeEach(() => {
  // Reset any global state before each test
});

afterEach(() => {
  // Clean up after each test
});
