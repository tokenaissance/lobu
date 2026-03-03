/**
 * Test setup and utilities for Gateway tests.
 *
 * Shared mocks (Redis, Queue, fetch, factories) live in @lobu/core fixtures.
 * This file re-exports them and adds gateway-specific helpers.
 */

import { createMockJob as _createMockJob } from "@lobu/core/testing";

export {
  createInstructionContext,
  createMockJob,
  createWorkerConfig,
  MockMessageQueue,
  MockRedisClient,
  mockFetch,
} from "@lobu/core/testing";

/**
 * Mock Express Response for SSE testing (gateway-specific)
 */
export class MockResponse {
  private _ended = false;
  private _written: string[] = [];
  private _closeCallbacks: (() => void)[] = [];

  write(chunk: string): boolean {
    if (this._ended) {
      throw new Error("Cannot write to ended response");
    }
    this._written.push(chunk);
    return true;
  }

  end(): void {
    this._ended = true;
  }

  onClose(callback: () => void): void {
    this._closeCallbacks.push(callback);
  }

  simulateClose(): void {
    for (const cb of this._closeCallbacks) cb();
  }

  isEnded(): boolean {
    return this._ended;
  }

  getWritten(): string[] {
    return this._written;
  }

  getLastWrite(): string | undefined {
    return this._written[this._written.length - 1];
  }

  getAllWrites(): string {
    return this._written.join("");
  }

  clearWrites(): void {
    this._written = [];
  }
}

/**
 * Test utilities
 */
export class TestHelpers {
  static createMockJob(overrides: any = {}): any {
    return _createMockJob(overrides);
  }

  static async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  static parseSSE(sse: string): { event: string; data: any }[] {
    const events: { event: string; data: any }[] = [];
    const lines = sse.split("\n");

    let currentEvent = "";
    let currentData = "";

    for (const line of lines) {
      if (line.startsWith("event:")) {
        currentEvent = line.substring(6).trim();
      } else if (line.startsWith("data:")) {
        currentData = line.substring(5).trim();
      } else if (line === "") {
        if (currentEvent && currentData) {
          try {
            events.push({
              event: currentEvent,
              data: JSON.parse(currentData),
            });
          } catch {
            events.push({
              event: currentEvent,
              data: currentData,
            });
          }
          currentEvent = "";
          currentData = "";
        }
      }
    }

    return events;
  }
}

/**
 * Mock environment variables
 */
const mockEnvVars = {
  WORKER_STALE_TIMEOUT_MINUTES: "10",
  PUBLIC_GATEWAY_URL: "https://test-gateway.example.com",
};

export function setupTestEnv(): void {
  for (const [key, value] of Object.entries(mockEnvVars)) {
    process.env[key] = value;
  }
}

export function cleanupTestEnv(): void {
  for (const key of Object.keys(mockEnvVars)) {
    delete process.env[key];
  }
}
