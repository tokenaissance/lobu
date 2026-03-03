import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  buildSettingsUrl,
  buildTelegramSettingsUrl,
  formatSettingsTokenTtl,
  generateChannelSettingsToken,
  generateSettingsToken,
  getSettingsTokenTtlMs,
  verifySettingsToken,
} from "../auth/settings/token-service";

describe("getSettingsTokenTtlMs", () => {
  let originalTtl: string | undefined;

  beforeEach(() => {
    originalTtl = process.env.SETTINGS_TOKEN_TTL_MS;
  });

  afterEach(() => {
    if (originalTtl !== undefined) {
      process.env.SETTINGS_TOKEN_TTL_MS = originalTtl;
    } else {
      delete process.env.SETTINGS_TOKEN_TTL_MS;
    }
  });

  test("returns default 1 hour when env not set", () => {
    delete process.env.SETTINGS_TOKEN_TTL_MS;
    expect(getSettingsTokenTtlMs()).toBe(3600000);
  });

  test("returns default for empty string", () => {
    process.env.SETTINGS_TOKEN_TTL_MS = "";
    expect(getSettingsTokenTtlMs()).toBe(3600000);
  });

  test("returns default for invalid value", () => {
    process.env.SETTINGS_TOKEN_TTL_MS = "not-a-number";
    expect(getSettingsTokenTtlMs()).toBe(3600000);
  });

  test("returns default for negative value", () => {
    process.env.SETTINGS_TOKEN_TTL_MS = "-1000";
    expect(getSettingsTokenTtlMs()).toBe(3600000);
  });

  test("returns parsed value for valid number", () => {
    process.env.SETTINGS_TOKEN_TTL_MS = "7200000";
    expect(getSettingsTokenTtlMs()).toBe(7200000);
  });
});

describe("formatSettingsTokenTtl", () => {
  test("formats weeks", () => {
    const week = 7 * 24 * 60 * 60 * 1000;
    expect(formatSettingsTokenTtl(week)).toBe("1 week");
    expect(formatSettingsTokenTtl(2 * week)).toBe("2 weeks");
  });

  test("formats days", () => {
    const day = 24 * 60 * 60 * 1000;
    expect(formatSettingsTokenTtl(day)).toBe("1 day");
    expect(formatSettingsTokenTtl(3 * day)).toBe("3 days");
  });

  test("formats hours", () => {
    const hour = 60 * 60 * 1000;
    expect(formatSettingsTokenTtl(hour)).toBe("1 hour");
    expect(formatSettingsTokenTtl(2 * hour)).toBe("2 hours");
  });

  test("formats minutes", () => {
    const minute = 60 * 1000;
    expect(formatSettingsTokenTtl(minute)).toBe("1 minute");
    expect(formatSettingsTokenTtl(5 * minute)).toBe("5 minutes");
  });

  test("formats seconds as fallback", () => {
    expect(formatSettingsTokenTtl(1000)).toBe("1 second");
    expect(formatSettingsTokenTtl(30000)).toBe("30 seconds");
  });
});

describe("generateSettingsToken / verifySettingsToken", () => {
  let originalKey: string | undefined;

  beforeEach(() => {
    originalKey = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY =
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  });

  afterEach(() => {
    if (originalKey !== undefined) {
      process.env.ENCRYPTION_KEY = originalKey;
    } else {
      delete process.env.ENCRYPTION_KEY;
    }
  });

  test("generates token that can be verified", () => {
    const token = generateSettingsToken("agent-1", "user-1", "slack");
    const payload = verifySettingsToken(token);
    expect(payload).not.toBeNull();
    expect(payload!.agentId).toBe("agent-1");
    expect(payload!.userId).toBe("user-1");
    expect(payload!.platform).toBe("slack");
  });

  test("channel-based token round-trip", () => {
    const token = generateChannelSettingsToken(
      "user-1",
      "telegram",
      "C123",
      "T456"
    );
    const payload = verifySettingsToken(token);
    expect(payload).not.toBeNull();
    expect(payload!.agentId).toBeUndefined();
    expect(payload!.channelId).toBe("C123");
    expect(payload!.teamId).toBe("T456");
  });

  test("throws when neither agentId nor channelId", () => {
    expect(() => generateSettingsToken(undefined, "user-1", "slack")).toThrow(
      "requires at least one of agentId or channelId"
    );
  });

  test("includes optional fields when provided", () => {
    const token = generateSettingsToken("agent-1", "user-1", "slack", {
      message: "Setup your key",
      prefillEnvVars: ["API_KEY"],
      prefillGrants: ["*.openai.com"],
    });
    const payload = verifySettingsToken(token);
    expect(payload!.message).toBe("Setup your key");
    expect(payload!.prefillEnvVars).toEqual(["API_KEY"]);
    expect(payload!.prefillGrants).toEqual(["*.openai.com"]);
  });

  test("backwards compat: number as options is ttlMs", () => {
    const token = generateSettingsToken("agent-1", "user-1", "slack", 5000);
    const payload = verifySettingsToken(token);
    expect(payload).not.toBeNull();
    // Token should expire very soon (5 seconds)
    expect(payload!.exp).toBeLessThan(Date.now() + 6000);
  });

  test("returns null for expired token", async () => {
    // Generate token with very short TTL
    const token = generateSettingsToken("agent-1", "user-1", "slack", 1);
    // Wait for it to expire
    await new Promise((r) => setTimeout(r, 10));
    const payload = verifySettingsToken(token);
    expect(payload).toBeNull();
  });

  test("returns null for garbage token", () => {
    expect(verifySettingsToken("not-a-valid-token")).toBeNull();
  });
});

describe("buildSettingsUrl", () => {
  let originalGateway: string | undefined;

  beforeEach(() => {
    originalGateway = process.env.PUBLIC_GATEWAY_URL;
  });

  afterEach(() => {
    if (originalGateway !== undefined) {
      process.env.PUBLIC_GATEWAY_URL = originalGateway;
    } else {
      delete process.env.PUBLIC_GATEWAY_URL;
    }
  });

  test("uses PUBLIC_GATEWAY_URL when set", () => {
    process.env.PUBLIC_GATEWAY_URL = "https://app.example.com";
    const url = buildSettingsUrl("mytoken");
    expect(url).toStartWith("https://app.example.com/settings#st=");
  });

  test("defaults to localhost:8080", () => {
    delete process.env.PUBLIC_GATEWAY_URL;
    const url = buildSettingsUrl("mytoken");
    expect(url).toStartWith("http://localhost:8080/settings#st=");
  });

  test("encodes token in hash fragment", () => {
    delete process.env.PUBLIC_GATEWAY_URL;
    const url = buildSettingsUrl("tok/en+with=special");
    expect(url).toContain("#st=");
    // Token should be URI-encoded
    expect(url).toContain(encodeURIComponent("tok/en+with=special"));
  });
});

describe("buildTelegramSettingsUrl", () => {
  let originalGateway: string | undefined;

  beforeEach(() => {
    originalGateway = process.env.PUBLIC_GATEWAY_URL;
  });

  afterEach(() => {
    if (originalGateway !== undefined) {
      process.env.PUBLIC_GATEWAY_URL = originalGateway;
    } else {
      delete process.env.PUBLIC_GATEWAY_URL;
    }
  });

  test("builds URL with platform and chat params", () => {
    process.env.PUBLIC_GATEWAY_URL = "https://app.example.com";
    const url = buildTelegramSettingsUrl("12345");
    expect(url).toBe(
      "https://app.example.com/settings?platform=telegram&chat=12345"
    );
  });

  test("encodes chatId", () => {
    delete process.env.PUBLIC_GATEWAY_URL;
    const url = buildTelegramSettingsUrl("chat with spaces");
    expect(url).toContain("chat=chat%20with%20spaces");
  });
});
