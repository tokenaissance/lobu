import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { MockRedisClient } from "@lobu/core/testing";
import { AuthProfilesManager } from "../auth/settings/auth-profiles-manager";
import { AgentSettingsStore } from "../auth/settings/agent-settings-store";
import { RedisSecretStore } from "../secrets";

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
  const secretStore = new RedisSecretStore(r as any, "lobu:test:secrets:");
  const store = new AgentSettingsStore(r as any, secretStore);
  const authProfilesManager = new AuthProfilesManager(store, secretStore);
  return { store, redis: r, secretStore, authProfilesManager };
}

describe("AgentSettingsStore", () => {
  let redis: MockRedisClient;
  let store: AgentSettingsStore;
  let secretStore: RedisSecretStore;
  let authProfilesManager: AuthProfilesManager;

  beforeEach(() => {
    const created = createStore();
    redis = created.redis;
    store = created.store;
    secretStore = created.secretStore;
    authProfilesManager = created.authProfilesManager;
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

  describe("secret refs for authProfiles.credential", () => {
    test("credential is normalized to a ref and encrypted in the secret store", async () => {
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

      const rawData = await redis.get("agent:settings:agent-1");
      expect(rawData).not.toBeNull();
      const parsed = JSON.parse(rawData!);
      expect(parsed.authProfiles[0].credential).toBeUndefined();
      expect(parsed.authProfiles[0].credentialRef).toMatch(/^secret:\/\//);

      const resolved = await secretStore.get(
        parsed.authProfiles[0].credentialRef
      );
      expect(resolved).toBe(apiKey);

      const [, secretKeys] = await redis.scan(
        "0",
        "MATCH",
        "lobu:test:secrets:*"
      );
      expect(secretKeys).toHaveLength(1);
      const rawSecret = await redis.get(secretKeys[0]!);
      expect(rawSecret).not.toContain(apiKey);

      const [result] = await authProfilesManager.listProfiles("agent-1");
      expect(result!.credential).toBe(apiKey);
      // Resolved view maintains the AuthProfile invariant: exactly one of
      // credential / credentialRef is set. Since the credential was resolved
      // from the ref, only `credential` should be present on the view.
      expect(result!.credentialRef).toBeUndefined();
    });
  });

  describe("secret refs for refreshToken", () => {
    test("refreshToken is normalized to a ref and resolved on read", async () => {
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

      const rawData = await redis.get("agent:settings:agent-1");
      const parsed = JSON.parse(rawData!);
      expect(parsed.authProfiles[0].metadata.refreshToken).toBeUndefined();
      expect(parsed.authProfiles[0].metadata.refreshTokenRef).toMatch(
        /^secret:\/\//
      );

      const resolved = await secretStore.get(
        parsed.authProfiles[0].metadata.refreshTokenRef
      );
      expect(resolved).toBe(refreshToken);

      const [result] = await authProfilesManager.listProfiles("agent-1");
      expect(result!.metadata!.refreshToken).toBe(refreshToken);
    });
  });

  describe("ref persistence", () => {
    test("existing secret refs survive unrelated settings updates", async () => {
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
      const credentialRef = parsedFirst.authProfiles[0].credentialRef;

      await store.updateSettings("agent-1", { model: "claude-opus-4" });

      const rawAfterSecond = await redis.get("agent:settings:agent-1");
      const parsedSecond = JSON.parse(rawAfterSecond!);
      expect(parsedSecond.authProfiles[0].credentialRef).toBe(credentialRef);
      const [result] = await authProfilesManager.listProfiles("agent-1");
      expect(result!.credential).toBe("sk-key");
    });

    test("rotated refresh token rewrites the underlying secret value", async () => {
      await store.saveSettings("agent-1", {
        authProfiles: [
          {
            id: "profile-1",
            provider: "anthropic",
            model: "claude-sonnet-4",
            credential: "sk-key",
            label: "test",
            authType: "oauth",
            metadata: { refreshToken: "rt-original" },
            createdAt: Date.now(),
          },
        ],
      });

      const [initial] = await authProfilesManager.listProfiles("agent-1");
      const originalRef = initial!.metadata!.refreshTokenRef!;
      expect(initial!.metadata!.refreshToken).toBe("rt-original");

      // Simulate TokenRefreshJob updating the profile with a new plaintext
      // refreshToken on top of the existing refreshTokenRef. The store MUST
      // rewrite the secret value, not drop the new plaintext on the floor.
      const existing = await store.getSettings("agent-1");
      const updated = existing!.authProfiles!.map((p) => ({
        ...p,
        metadata: {
          ...(p.metadata || {}),
          refreshToken: "rt-rotated",
        },
      }));
      await store.updateSettings("agent-1", { authProfiles: updated });

      const [after] = await authProfilesManager.listProfiles("agent-1");
      expect(after!.metadata!.refreshTokenRef).toBe(originalRef);
      expect(after!.metadata!.refreshToken).toBe("rt-rotated");
    });
  });

  describe("missing encryption key", () => {
    test("fails to persist secret-backed settings when ENCRYPTION_KEY is missing", async () => {
      const savedKey = process.env.ENCRYPTION_KEY;
      delete process.env.ENCRYPTION_KEY;

      try {
        const { store: noEncStore } = createStore();

        const apiKey = "sk-plaintext-key";
        await expect(
          noEncStore.saveSettings("agent-1", {
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
          })
        ).rejects.toThrow("ENCRYPTION_KEY");
      } finally {
        process.env.ENCRYPTION_KEY = savedKey;
      }
    });
  });

  describe("cascade delete", () => {
    test("deleteSettings removes auth profile secrets from the store", async () => {
      await store.saveSettings("agent-1", {
        authProfiles: [
          {
            id: "profile-1",
            provider: "anthropic",
            model: "*",
            credential: "sk-one",
            label: "one",
            authType: "api-key",
            createdAt: Date.now(),
          },
          {
            id: "profile-2",
            provider: "openai",
            model: "*",
            credential: "sk-two",
            label: "two",
            authType: "oauth",
            metadata: { refreshToken: "rt-two" },
            createdAt: Date.now(),
          },
        ],
      });

      // Sanity: both credentials + the refresh token are in the store.
      const before = await secretStore.list("agents/agent-1/");
      expect(before).toHaveLength(3);

      await store.deleteSettings("agent-1");

      const after = await secretStore.list("agents/agent-1/");
      expect(after).toHaveLength(0);
      expect(await store.getSettings("agent-1")).toBeNull();
    });

    test("deleteProviderProfiles removes only the targeted profile's secrets", async () => {
      await store.saveSettings("agent-1", {
        authProfiles: [
          {
            id: "profile-1",
            provider: "anthropic",
            model: "*",
            credential: "sk-anthropic",
            label: "a",
            authType: "api-key",
            createdAt: Date.now(),
          },
          {
            id: "profile-2",
            provider: "openai",
            model: "*",
            credential: "sk-openai",
            label: "o",
            authType: "api-key",
            createdAt: Date.now(),
          },
        ],
      });

      await authProfilesManager.deleteProviderProfiles("agent-1", "openai");

      const remaining = await secretStore.list("agents/agent-1/");
      expect(remaining).toHaveLength(1);
      expect(remaining[0]?.name).toBe(
        "agents/agent-1/auth-profiles/profile-1/credential"
      );

      const [onlyProfile] = await authProfilesManager.listProfiles("agent-1");
      expect(onlyProfile?.provider).toBe("anthropic");
    });
  });

  describe("shared ephemeral profile registry", () => {
    test("ephemeral profiles registered on one manager are visible to others", async () => {
      // Two managers built against the same store — simulates core-services
      // and a provider module each constructing their own manager.
      const managerA = new AuthProfilesManager(store, secretStore);
      const managerB = new AuthProfilesManager(store, secretStore);

      managerA.registerEphemeralProfile({
        agentId: "agent-1",
        provider: "anthropic",
        credential: "sk-ephemeral",
        authType: "api-key",
        label: "from sdk",
      });

      const viaA = await managerA.listProfiles("agent-1");
      const viaB = await managerB.listProfiles("agent-1");
      expect(viaA).toHaveLength(1);
      expect(viaB).toHaveLength(1);
      expect(viaB[0]?.credential).toBe("sk-ephemeral");
      expect(await managerB.hasProviderProfiles("agent-1", "anthropic")).toBe(
        true
      );
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
