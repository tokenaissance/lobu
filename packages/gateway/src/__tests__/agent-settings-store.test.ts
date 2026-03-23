import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { MockRedisClient } from "@lobu/core/testing";
import { AgentSettingsStore } from "../auth/settings/agent-settings-store";

const TEST_ENCRYPTION_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

let originalEncryptionKey: string | undefined;

beforeAll(() => {
  originalEncryptionKey = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
});

afterAll(() => {
  if (originalEncryptionKey !== undefined) {
    process.env.ENCRYPTION_KEY = originalEncryptionKey;
  } else {
    delete process.env.ENCRYPTION_KEY;
  }
});

function createStore(redis?: MockRedisClient) {
  const r = redis ?? new MockRedisClient();
  const store = new AgentSettingsStore(r as any);
  return { store, redis: r };
}

describe("AgentSettingsStore", () => {
  let redis: MockRedisClient;
  let store: AgentSettingsStore;

  beforeEach(() => {
    const created = createStore();
    redis = created.redis;
    store = created.store;
  });

  describe("CRUD basics", () => {
    test("saveSettings stores and getSettings retrieves", async () => {
      await store.saveSettings("agent-1", { model: "claude-sonnet-4" });
      const result = await store.getSettings("agent-1");
      expect(result).not.toBeNull();
      expect(result!.model).toBe("claude-sonnet-4");
      expect(result!.updatedAt).toBeGreaterThan(0);
    });

    test("getSettings returns null for non-existent agent", async () => {
      const result = await store.getSettings("missing");
      expect(result).toBeNull();
    });

    test("updateSettings merges with existing", async () => {
      await store.saveSettings("agent-1", { model: "claude-sonnet-4" });
      await store.updateSettings("agent-1", { soulMd: "Be helpful" });
      const result = await store.getSettings("agent-1");
      expect(result!.model).toBe("claude-sonnet-4");
      expect(result!.soulMd).toBe("Be helpful");
    });

    test("deleteSettings removes settings", async () => {
      await store.saveSettings("agent-1", { model: "claude-sonnet-4" });
      await store.deleteSettings("agent-1");
      const result = await store.getSettings("agent-1");
      expect(result).toBeNull();
    });

    test("hasSettings returns boolean", async () => {
      expect(await store.hasSettings("agent-1")).toBe(false);
      await store.saveSettings("agent-1", { model: "claude-sonnet-4" });
      expect(await store.hasSettings("agent-1")).toBe(true);
    });
  });

  describe("partial update merging", () => {
    test("merges new fields with existing", async () => {
      await store.saveSettings("agent-1", {
        model: "claude-sonnet-4",
        soulMd: "Original",
      });
      await store.updateSettings("agent-1", { userMd: "New field" });
      const result = await store.getSettings("agent-1");
      expect(result!.model).toBe("claude-sonnet-4");
      expect(result!.soulMd).toBe("Original");
      expect(result!.userMd).toBe("New field");
    });

    test("overwrites overlapping fields", async () => {
      await store.saveSettings("agent-1", { model: "claude-sonnet-4" });
      await store.updateSettings("agent-1", { model: "claude-opus-4" });
      const result = await store.getSettings("agent-1");
      expect(result!.model).toBe("claude-opus-4");
    });

    test("creates if no existing settings", async () => {
      await store.updateSettings("agent-1", { model: "claude-opus-4" });
      const result = await store.getSettings("agent-1");
      expect(result).not.toBeNull();
      expect(result!.model).toBe("claude-opus-4");
    });
  });

  describe("encryption of authProfiles.credential", () => {
    test("credential is encrypted in Redis and decrypted on read", async () => {
      const apiKey = "sk-ant-secret-key-12345";
      await store.saveSettings("agent-1", {
        authProfiles: [
          {
            id: "profile-1",
            provider: "anthropic",
            model: "claude-sonnet-4",
            credential: apiKey,
            label: "test",
            authType: "api-key",
            createdAt: Date.now(),
          },
        ],
      });

      // Check raw value in Redis has enc:v1: prefix
      const rawData = await redis.get("agent:settings:agent-1");
      expect(rawData).not.toBeNull();
      const parsed = JSON.parse(rawData!);
      expect(parsed.authProfiles[0].credential).toStartWith("enc:v1:");
      expect(parsed.authProfiles[0].credential).not.toBe(apiKey);

      // Check decrypted on read
      const result = await store.getSettings("agent-1");
      expect(result!.authProfiles![0].credential).toBe(apiKey);
    });
  });

  describe("encryption of refreshToken", () => {
    test("refreshToken is encrypted in Redis and decrypted on read", async () => {
      const refreshToken = "rt-secret-refresh-token-xyz";
      await store.saveSettings("agent-1", {
        authProfiles: [
          {
            id: "profile-1",
            provider: "anthropic",
            model: "claude-sonnet-4",
            credential: "sk-key",
            label: "test",
            authType: "oauth",
            metadata: {
              refreshToken,
              email: "user@example.com",
            },
            createdAt: Date.now(),
          },
        ],
      });

      // Check raw value in Redis
      const rawData = await redis.get("agent:settings:agent-1");
      const parsed = JSON.parse(rawData!);
      expect(parsed.authProfiles[0].metadata.refreshToken).toStartWith(
        "enc:v1:"
      );

      // Check decrypted on read
      const result = await store.getSettings("agent-1");
      expect(result!.authProfiles![0].metadata!.refreshToken).toBe(
        refreshToken
      );
    });
  });

  describe("no double-encryption", () => {
    test("already encrypted values are not re-encrypted", async () => {
      // Save once to encrypt
      await store.saveSettings("agent-1", {
        authProfiles: [
          {
            id: "profile-1",
            provider: "anthropic",
            model: "claude-sonnet-4",
            credential: "sk-key",
            label: "test",
            authType: "api-key",
            createdAt: Date.now(),
          },
        ],
      });

      const rawAfterFirst = await redis.get("agent:settings:agent-1");
      const parsedFirst = JSON.parse(rawAfterFirst!);
      const encryptedCredential = parsedFirst.authProfiles[0].credential;

      // Update to re-save (simulating save with already-encrypted value)
      await store.updateSettings("agent-1", { model: "claude-opus-4" });

      const rawAfterSecond = await redis.get("agent:settings:agent-1");
      const parsedSecond = JSON.parse(rawAfterSecond!);

      // The credential should still be encrypted, not double-encrypted
      // Both should decrypt to the same plaintext
      const result = await store.getSettings("agent-1");
      expect(result!.authProfiles![0].credential).toBe("sk-key");
    });
  });

  describe("graceful plaintext when ENCRYPTION_KEY missing", () => {
    test("values stored as plaintext without encryption key", async () => {
      const savedKey = process.env.ENCRYPTION_KEY;
      delete process.env.ENCRYPTION_KEY;

      try {
        const { store: noEncStore, redis: noEncRedis } = createStore();

        const apiKey = "sk-plaintext-key";
        await noEncStore.saveSettings("agent-1", {
          authProfiles: [
            {
              id: "profile-1",
              provider: "anthropic",
              model: "claude-sonnet-4",
              credential: apiKey,
              label: "test",
              authType: "api-key",
              createdAt: Date.now(),
            },
          ],
        });

        // Raw value should be plaintext (no enc:v1: prefix)
        const rawData = await noEncRedis.get("agent:settings:agent-1");
        const parsed = JSON.parse(rawData!);
        expect(parsed.authProfiles[0].credential).toBe(apiKey);
        expect(parsed.authProfiles[0].credential).not.toStartWith("enc:v1:");

        // Read should also return plaintext
        const result = await noEncStore.getSettings("agent-1");
        expect(result!.authProfiles![0].credential).toBe(apiKey);
      } finally {
        process.env.ENCRYPTION_KEY = savedKey;
      }
    });
  });

  describe("findTemplateAgentId", () => {
    test("returns first agent with installedProviders", async () => {
      // Agent without installedProviders
      await store.saveSettings("agent-no-providers", {
        model: "claude-sonnet-4",
      });

      // Agent with installedProviders
      await store.saveSettings("agent-with-providers", {
        model: "claude-opus-4",
        installedProviders: [
          {
            id: "anthropic",
            displayName: "Anthropic",
            envVarName: "ANTHROPIC_API_KEY",
            upstreamBaseUrl: "https://api.anthropic.com",
          },
        ],
      });

      const templateId = await store.findTemplateAgentId();
      expect(templateId).toBe("agent-with-providers");
    });

    test("returns null when no agents have providers", async () => {
      await store.saveSettings("agent-1", { model: "claude-sonnet-4" });
      await store.saveSettings("agent-2", { model: "claude-opus-4" });

      const templateId = await store.findTemplateAgentId();
      expect(templateId).toBeNull();
    });
  });

  describe("findSandboxAgentIds", () => {
    test("returns agent IDs referencing template", async () => {
      const templateId = "template-agent";

      await store.saveSettings(templateId, {
        model: "claude-opus-4",
        installedProviders: [
          {
            id: "anthropic",
            displayName: "Anthropic",
            envVarName: "ANTHROPIC_API_KEY",
            upstreamBaseUrl: "https://api.anthropic.com",
          },
        ],
      });

      await store.saveSettings("sandbox-1", {
        model: "claude-sonnet-4",
        templateAgentId: templateId,
      });

      await store.saveSettings("sandbox-2", {
        model: "claude-sonnet-4",
        templateAgentId: templateId,
      });

      // Unrelated agent
      await store.saveSettings("other-agent", {
        model: "claude-sonnet-4",
      });

      const sandboxIds = await store.findSandboxAgentIds(templateId);
      expect(sandboxIds).toHaveLength(2);
      expect(sandboxIds.sort()).toEqual(["sandbox-1", "sandbox-2"]);
    });

    test("returns empty array when no sandboxes exist", async () => {
      await store.saveSettings("agent-1", { model: "claude-sonnet-4" });
      const sandboxIds = await store.findSandboxAgentIds("non-existent");
      expect(sandboxIds).toEqual([]);
    });
  });
});
