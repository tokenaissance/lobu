/**
 * Tests for SessionManager and RedisSessionStore
 * Tests session storage, retrieval, and thread ownership validation
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { RedisSessionStore, SessionManager } from "../services/session-manager";
import { computeSessionKey, type ThreadSession } from "../session";
import { cleanupTestEnv, MockMessageQueue, setupTestEnv } from "./setup";

describe("SessionManager", () => {
  let mockQueue: MockMessageQueue;
  let store: RedisSessionStore;
  let manager: SessionManager;

  beforeEach(() => {
    setupTestEnv();
    mockQueue = new MockMessageQueue();
    store = new RedisSessionStore(mockQueue as any);
    manager = new SessionManager(store);
  });

  afterEach(() => {
    cleanupTestEnv();
  });

  describe("Session Creation and Retrieval", () => {
    test("creates and retrieves session", async () => {
      const session: ThreadSession = {
        channelId: "C123",
        userId: "U123",
        conversationId: "1234567890.123456",
        threadId: "1234567890.123456",
        threadCreator: "U123",
        status: "pending",
        createdAt: Date.now(),
        lastActivity: Date.now(),
      };

      await manager.setSession(session);

      const sessionKey = computeSessionKey(session);
      const retrieved = await manager.getSession(sessionKey);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.userId).toBe("U123");
      expect(retrieved?.channelId).toBe("C123");
      expect(retrieved?.threadId).toBe("1234567890.123456");
    });

    test("returns null for non-existent session", async () => {
      const session = await manager.getSession("non-existent");
      expect(session).toBeNull();
    });

    test("stores all session fields correctly", async () => {
      const session: ThreadSession = {
        channelId: "C456",
        userId: "U456",
        conversationId: "9876543210.654321",
        threadId: "9876543210.654321",
        threadCreator: "U456",
        status: "running",
        createdAt: Date.now(),
        lastActivity: Date.now(),
      };

      await manager.setSession(session);

      const sessionKey = computeSessionKey(session);
      const retrieved = await manager.getSession(sessionKey);
      expect(retrieved).toMatchObject({
        channelId: "C456",
        userId: "U456",
        conversationId: "9876543210.654321",
        threadId: "9876543210.654321",
        threadCreator: "U456",
        status: "running",
      });
    });
  });

  describe("Session Deletion", () => {
    test("deletes existing session", async () => {
      const session: ThreadSession = {
        channelId: "C123",
        userId: "U123",
        conversationId: "1234567890.123456",
        threadId: "1234567890.123456",
        status: "completed",
        createdAt: Date.now(),
        lastActivity: Date.now(),
      };

      await manager.setSession(session);
      const sessionKey = computeSessionKey(session);
      expect(await manager.getSession(sessionKey)).not.toBeNull();

      await manager.deleteSession(sessionKey);
      expect(await manager.getSession(sessionKey)).toBeNull();
    });

    test("handles deleting non-existent session gracefully", async () => {
      // Should not throw
      await manager.deleteSession("non-existent");
      expect(true).toBe(true); // Test passes if no error thrown
    });

    test("deletes both session and thread index", async () => {
      const session: ThreadSession = {
        channelId: "C123",
        userId: "U123",
        conversationId: "1234567890.123456",
        threadId: "1234567890.123456",
        status: "completed",
        createdAt: Date.now(),
        lastActivity: Date.now(),
      };

      await manager.setSession(session);
      const sessionKey = computeSessionKey(session);

      // Should be able to find by thread
      const byThread = await manager.findSessionByThread(
        "C123",
        "1234567890.123456"
      );
      expect(byThread).not.toBeNull();

      // Delete
      await manager.deleteSession(sessionKey);

      // Should no longer find by thread
      const afterDelete = await manager.findSessionByThread(
        "C123",
        "1234567890.123456"
      );
      expect(afterDelete).toBeNull();
    });
  });

  describe("Thread Index Lookup", () => {
    test("finds session by thread ID", async () => {
      const session: ThreadSession = {
        channelId: "C789",
        userId: "U789",
        conversationId: "1111111111.111111",
        threadId: "1111111111.111111",
        status: "pending",
        createdAt: Date.now(),
        lastActivity: Date.now(),
      };

      await manager.setSession(session);

      const found = await manager.findSessionByThread(
        "C789",
        "1111111111.111111"
      );
      expect(found).not.toBeNull();
      expect(found?.userId).toBe("U789");
    });

    test("returns null when thread not found", async () => {
      const found = await manager.findSessionByThread(
        "C999",
        "9999999999.999999"
      );
      expect(found).toBeNull();
    });

    test("handles multiple sessions in different threads", async () => {
      const session1: ThreadSession = {
        channelId: "C111",
        userId: "U111",
        conversationId: "1111111111.111111",
        threadId: "1111111111.111111",
        status: "pending",
        createdAt: Date.now(),
        lastActivity: Date.now(),
      };

      const session2: ThreadSession = {
        channelId: "C222",
        userId: "U222",
        conversationId: "2222222222.222222",
        threadId: "2222222222.222222",
        status: "running",
        createdAt: Date.now(),
        lastActivity: Date.now(),
      };

      await manager.setSession(session1);
      await manager.setSession(session2);

      const found1 = await manager.findSessionByThread(
        "C111",
        "1111111111.111111"
      );
      const found2 = await manager.findSessionByThread(
        "C222",
        "2222222222.222222"
      );

      expect(found1?.channelId).toBe("C111");
      expect(found2?.channelId).toBe("C222");
    });

    test("updates session when thread index already exists", async () => {
      const session: ThreadSession = {
        channelId: "C123",
        userId: "U123",
        conversationId: "1234567890.123456",
        threadId: "1234567890.123456",
        status: "pending",
        createdAt: Date.now(),
        lastActivity: Date.now(),
      };

      await manager.setSession(session);

      // Update the same session
      const updatedSession = { ...session, status: "completed" as const };
      await manager.setSession(updatedSession);

      const found = await manager.findSessionByThread(
        "C123",
        "1234567890.123456"
      );
      expect(found?.status).toBe("completed");
    });
  });

  describe("Thread Ownership Validation", () => {
    test("allows access when no session exists", async () => {
      const result = await manager.validateThreadOwnership(
        "C123",
        "1234567890.123456",
        "U123"
      );

      expect(result.allowed).toBe(true);
      expect(result.owner).toBeUndefined();
    });

    test("allows access when no thread creator is set", async () => {
      const session: ThreadSession = {
        channelId: "C123",
        userId: "U123",
        conversationId: "1234567890.123456",
        threadId: "1234567890.123456",
        // No threadCreator set
        status: "pending",
        createdAt: Date.now(),
        lastActivity: Date.now(),
      };

      await manager.setSession(session);

      const result = await manager.validateThreadOwnership(
        "C123",
        "1234567890.123456",
        "U456" // Different user
      );

      expect(result.allowed).toBe(true);
    });

    test("allows access when user is thread creator", async () => {
      const session: ThreadSession = {
        channelId: "C123",
        userId: "U123",
        conversationId: "1234567890.123456",
        threadId: "1234567890.123456",
        threadCreator: "U123",
        status: "running",
        createdAt: Date.now(),
        lastActivity: Date.now(),
      };

      await manager.setSession(session);

      const result = await manager.validateThreadOwnership(
        "C123",
        "1234567890.123456",
        "U123"
      );

      expect(result.allowed).toBe(true);
      expect(result.owner).toBe("U123");
    });

    test("denies access when user is not thread creator", async () => {
      const session: ThreadSession = {
        channelId: "C123",
        userId: "U123",
        conversationId: "1234567890.123456",
        threadId: "1234567890.123456",
        threadCreator: "U123",
        status: "running",
        createdAt: Date.now(),
        lastActivity: Date.now(),
      };

      await manager.setSession(session);

      const result = await manager.validateThreadOwnership(
        "C123",
        "1234567890.123456",
        "U456" // Different user
      );

      expect(result.allowed).toBe(false);
      expect(result.owner).toBe("U123");
    });

    test("validates ownership across multiple threads correctly", async () => {
      const session1: ThreadSession = {
        channelId: "C111",
        userId: "U111",
        conversationId: "1111111111.111111",
        threadId: "1111111111.111111",
        threadCreator: "U111",
        status: "running",
        createdAt: Date.now(),
        lastActivity: Date.now(),
      };

      const session2: ThreadSession = {
        channelId: "C222",
        userId: "U222",
        conversationId: "2222222222.222222",
        threadId: "2222222222.222222",
        threadCreator: "U222",
        status: "running",
        createdAt: Date.now(),
        lastActivity: Date.now(),
      };

      await manager.setSession(session1);
      await manager.setSession(session2);

      // User 111 can access their thread
      const result1 = await manager.validateThreadOwnership(
        "C111",
        "1111111111.111111",
        "U111"
      );
      expect(result1.allowed).toBe(true);

      // User 111 cannot access user 222's thread
      const result2 = await manager.validateThreadOwnership(
        "C222",
        "2222222222.222222",
        "U111"
      );
      expect(result2.allowed).toBe(false);
      expect(result2.owner).toBe("U222");
    });
  });

  describe("Session Activity Tracking", () => {
    test("updates lastActivity timestamp", async () => {
      const session: ThreadSession = {
        channelId: "C123",
        userId: "U123",
        conversationId: "activity.123456",
        threadId: "activity.123456",
        status: "running",
        createdAt: Date.now(),
        lastActivity: Date.now() - 1000, // 1 second ago
      };

      await manager.setSession(session);
      const sessionKey = computeSessionKey(session);

      const before = await manager.getSession(sessionKey);
      const beforeActivity = before?.lastActivity;

      // Wait a bit and touch
      await new Promise((resolve) => setTimeout(resolve, 10));
      await manager.touchSession(sessionKey);

      const after = await manager.getSession(sessionKey);
      expect(after?.lastActivity).toBeGreaterThan(beforeActivity!);
    });

    test("handles touching non-existent session gracefully", async () => {
      // Should not throw
      await manager.touchSession("non-existent");
      expect(true).toBe(true); // Test passes if no error thrown
    });

    test("preserves other fields when touching", async () => {
      const session: ThreadSession = {
        channelId: "C123",
        userId: "U123",
        conversationId: "preserve.123456",
        threadId: "preserve.123456",
        threadCreator: "U123",
        status: "running",
        createdAt: Date.now(),
        lastActivity: Date.now(),
      };

      await manager.setSession(session);
      const sessionKey = computeSessionKey(session);
      await manager.touchSession(sessionKey);

      const updated = await manager.getSession(sessionKey);
      expect(updated?.channelId).toBe("C123");
      expect(updated?.userId).toBe("U123");
      expect(updated?.threadId).toBe("preserve.123456");
      expect(updated?.status).toBe("running");
    });
  });

  describe("Session Status Updates", () => {
    test("updates session status", async () => {
      const session: ThreadSession = {
        channelId: "C123",
        userId: "U123",
        conversationId: "status.123456",
        threadId: "status.123456",
        status: "pending",
        createdAt: Date.now(),
        lastActivity: Date.now(),
      };

      await manager.setSession(session);
      const sessionKey = computeSessionKey(session);

      const updated = { ...session, status: "completed" as const };
      await manager.setSession(updated);

      const retrieved = await manager.getSession(sessionKey);
      expect(retrieved?.status).toBe("completed");
    });

    test("handles all valid status transitions", async () => {
      const statuses: Array<ThreadSession["status"]> = [
        "pending",
        "starting",
        "running",
        "completed",
        "error",
        "timeout",
      ];

      for (const status of statuses) {
        const session: ThreadSession = {
          channelId: "C123",
          userId: "U123",
          conversationId: `status-${status}.123456`,
          threadId: `status-${status}.123456`,
          status,
          createdAt: Date.now(),
          lastActivity: Date.now(),
        };

        await manager.setSession(session);
        const sessionKey = computeSessionKey(session);

        const retrieved = await manager.getSession(sessionKey);
        expect(retrieved?.status).toBe(status);
      }
    });
  });

  describe("Redis TTL Behavior", () => {
    test("cleanup returns 0 for Redis-based store", async () => {
      const count = await manager.cleanupExpired(3600);
      expect(count).toBe(0); // Redis handles TTL automatically
    });
  });

  describe("Error Handling", () => {
    test("handles invalid JSON in Redis gracefully", async () => {
      // Store invalid JSON directly in Redis
      const redis = mockQueue.getRedisClient();
      await redis.set("session:invalid-json", "{invalid json}", 3600);

      const session = await manager.getSession("invalid-json");
      expect(session).toBeNull(); // Should return null on parse error
    });

    test("handles concurrent session updates", async () => {
      const session: ThreadSession = {
        channelId: "C123",
        userId: "U123",
        conversationId: "concurrent.123456",
        threadId: "concurrent.123456",
        status: "pending",
        createdAt: Date.now(),
        lastActivity: Date.now(),
      };

      const sessionKey = computeSessionKey(session);

      // Simulate concurrent updates
      await Promise.all([
        manager.setSession({ ...session, status: "running" }),
        manager.setSession({ ...session, status: "completed" }),
      ]);

      // Last write wins
      const retrieved = await manager.getSession(sessionKey);
      expect(retrieved).not.toBeNull();
      expect(["running", "completed"]).toContain(retrieved?.status);
    });
  });

  describe("Session Store Key Formatting", () => {
    test("uses correct key prefix for sessions", async () => {
      const session: ThreadSession = {
        channelId: "C123",
        userId: "U123",
        conversationId: "keyformat.123456",
        threadId: "keyformat.123456",
        status: "pending",
        createdAt: Date.now(),
        lastActivity: Date.now(),
      };

      await manager.setSession(session);

      const redis = mockQueue.getRedisClient();
      // Key format: session:{channelId}:{threadId}
      const hasKey = redis.has("session:C123:keyformat.123456");
      expect(hasKey).toBe(true);
    });

    test("uses correct key format for thread index", async () => {
      const session: ThreadSession = {
        channelId: "C123",
        userId: "U123",
        conversationId: "1234567890.123456",
        threadId: "1234567890.123456",
        status: "pending",
        createdAt: Date.now(),
        lastActivity: Date.now(),
      };

      await manager.setSession(session);

      const redis = mockQueue.getRedisClient();
      // Thread index should use format: thread_index:{channelId}:{threadTs}
      const hasIndex = redis.has("thread_index:C123:1234567890.123456");
      expect(hasIndex).toBe(true);
    });
  });

  describe("Edge Cases", () => {
    test("handles API platform sessions (channelId equals threadId)", async () => {
      const agentId = "agent-123";
      const session: ThreadSession = {
        channelId: agentId,
        userId: "U123",
        conversationId: agentId, // Primary identifier for API platform
        threadId: agentId, // Legacy alias (same as conversationId for API platform)
        status: "pending",
        createdAt: Date.now(),
        lastActivity: Date.now(),
      };

      await manager.setSession(session);

      // For API platform, key should just be conversationId
      const sessionKey = computeSessionKey(session);
      expect(sessionKey).toBe(agentId);

      const retrieved = await manager.getSession(sessionKey);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.conversationId).toBe(agentId);
    });

    test("handles special characters in IDs", async () => {
      const session: ThreadSession = {
        channelId: "C-123-test",
        userId: "U_special_123",
        conversationId: "1234567890.123456-extra",
        threadId: "1234567890.123456-extra",
        status: "pending",
        createdAt: Date.now(),
        lastActivity: Date.now(),
      };

      await manager.setSession(session);
      const sessionKey = computeSessionKey(session);

      const retrieved = await manager.getSession(sessionKey);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.channelId).toBe("C-123-test");
    });
  });
});
