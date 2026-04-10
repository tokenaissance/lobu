import { beforeEach, describe, expect, test } from "bun:test";
import { MockRedisClient } from "@lobu/core/testing";
import { createBuiltinSecretRef } from "@lobu/core";
import {
  generatePlaceholder,
  type SecretMapping,
  storeSecretMapping,
} from "../proxy/secret-proxy";

describe("storeSecretMapping", () => {
  let redis: MockRedisClient;

  beforeEach(() => {
    redis = new MockRedisClient();
  });

  test("stores mapping at expected key", async () => {
    const mapping: SecretMapping = {
      agentId: "agent-1",
      envVarName: "API_KEY",
      secretRef: createBuiltinSecretRef("deployments/agent-1/API_KEY"),
      deploymentName: "deploy-1",
    };
    await storeSecretMapping(redis as any, "test-uuid", mapping);
    const raw = await redis.get("lobu:secret:test-uuid");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.agentId).toBe("agent-1");
    expect(parsed.secretRef).toBe("secret://deployments/agent-1/API_KEY");
  });

  test("uses custom TTL", async () => {
    const mapping: SecretMapping = {
      agentId: "agent-1",
      envVarName: "KEY",
      secretRef: createBuiltinSecretRef("deployments/agent-1/KEY"),
      deploymentName: "deploy-1",
    };
    await storeSecretMapping(redis as any, "uuid-2", mapping, 3600);
    const raw = await redis.get("lobu:secret:uuid-2");
    expect(raw).not.toBeNull();
  });
});

describe("generatePlaceholder", () => {
  let redis: MockRedisClient;

  beforeEach(() => {
    redis = new MockRedisClient();
  });

  test("returns placeholder with prefix", async () => {
    const placeholder = await generatePlaceholder(
      redis as any,
      "agent-1",
      "API_KEY",
      createBuiltinSecretRef("deployments/agent-1/API_KEY"),
      "deploy-1"
    );
    expect(placeholder).toStartWith("lobu_secret_");
  });

  test("stores mapping in Redis", async () => {
    const placeholder = await generatePlaceholder(
      redis as any,
      "agent-1",
      "API_KEY",
      createBuiltinSecretRef("deployments/agent-1/API_KEY"),
      "deploy-1"
    );
    const uuid = placeholder.replace("lobu_secret_", "");
    const raw = await redis.get(`lobu:secret:${uuid}`);
    expect(raw).not.toBeNull();
    const mapping = JSON.parse(raw!);
    expect(mapping.agentId).toBe("agent-1");
    expect(mapping.envVarName).toBe("API_KEY");
    expect(mapping.secretRef).toBe("secret://deployments/agent-1/API_KEY");
    expect(mapping.deploymentName).toBe("deploy-1");
  });

  test("generates unique placeholders", async () => {
    const p1 = await generatePlaceholder(
      redis as any,
      "a",
      "K",
      createBuiltinSecretRef("deployments/a/K/1"),
      "d"
    );
    const p2 = await generatePlaceholder(
      redis as any,
      "a",
      "K",
      createBuiltinSecretRef("deployments/a/K/2"),
      "d"
    );
    expect(p1).not.toBe(p2);
  });
});
