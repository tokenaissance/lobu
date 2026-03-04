import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	buildTelegramSettingsUrl,
	formatSettingsTokenTtl,
	getSettingsTokenTtlMs,
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
			"https://app.example.com/settings?platform=telegram&chat=12345",
		);
	});

	test("encodes chatId", () => {
		delete process.env.PUBLIC_GATEWAY_URL;
		const url = buildTelegramSettingsUrl("chat with spaces");
		expect(url).toContain("chat=chat%20with%20spaces");
	});
});
