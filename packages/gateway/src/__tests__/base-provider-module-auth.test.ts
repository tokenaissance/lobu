import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import {
	type BaseProviderConfig,
	BaseProviderModule,
} from "../auth/base-provider-module";
import { createAuthProfileLabel } from "../auth/settings/auth-profiles-manager";
import type { SettingsSessionPayload } from "../auth/settings/token-service";

/**
 * In-memory session store for testing (replaces Redis-backed AuthSessionStore).
 */
class TestSessionStore {
	private sessions = new Map<string, SettingsSessionPayload>();
	private nextId = 0;

	createSession(
		payload: Omit<SettingsSessionPayload, "exp">,
		ttlMs: number,
	): { sessionId: string; expiresAt: number } {
		const sessionId = `test-session-${++this.nextId}`;
		const expiresAt = Date.now() + ttlMs;
		this.sessions.set(sessionId, { ...payload, exp: expiresAt });
		return { sessionId, expiresAt };
	}

	getSession(sessionId: string): SettingsSessionPayload | null {
		const payload = this.sessions.get(sessionId);
		if (!payload) return null;
		if (Date.now() > payload.exp) {
			this.sessions.delete(sessionId);
			return null;
		}
		return payload;
	}
}

class TestProviderModule extends BaseProviderModule {
	constructor(authProfilesManager: {
		upsertProfile(input: unknown): Promise<void>;
		deleteProviderProfiles(
			agentId: string,
			providerId: string,
			profileId?: string,
		): Promise<void>;
		hasProviderProfiles(agentId: string, providerId: string): Promise<boolean>;
		getBestProfile(agentId: string, providerId: string): Promise<unknown>;
	}) {
		const config: BaseProviderConfig = {
			providerId: "test-provider",
			providerDisplayName: "Test Provider",
			providerIconUrl: "https://example.com/icon.png",
			credentialEnvVarName: "TEST_PROVIDER_API_KEY",
			secretEnvVarNames: ["TEST_PROVIDER_API_KEY"],
			authType: "api-key",
		};

		super(config, authProfilesManager as any);
	}
}

function createAuthProfilesManagerMock() {
	const upsertCalls: unknown[] = [];
	const deleteCalls: Array<{
		agentId: string;
		providerId: string;
		profileId?: string;
	}> = [];

	const manager = {
		async upsertProfile(input: unknown): Promise<void> {
			upsertCalls.push(input);
		},
		async deleteProviderProfiles(
			agentId: string,
			providerId: string,
			profileId?: string,
		): Promise<void> {
			deleteCalls.push({ agentId, providerId, profileId });
		},
		async hasProviderProfiles(): Promise<boolean> {
			return false;
		},
		async getBestProfile(): Promise<null> {
			return null;
		},
	};

	return { manager, upsertCalls, deleteCalls };
}

/**
 * Build a mini auth router that mirrors the session-based pattern
 * from gateway.ts (POST /:provider/save-key, POST /:provider/logout).
 * Uses in-memory session store instead of Redis.
 */
function createAuthRouter(
	providerModule: TestProviderModule,
	authProfilesManager: ReturnType<
		typeof createAuthProfilesManagerMock
	>["manager"],
	sessionStore: TestSessionStore,
) {
	const app = new Hono();
	const providerModuleMap = new Map([
		[providerModule.providerId, providerModule],
	]);

	const resolveSession = (c: any): SettingsSessionPayload | null => {
		const sid = c.req.query("s");
		if (!sid) return null;
		return sessionStore.getSession(sid);
	};

	app.post("/:provider/save-key", async (c) => {
		try {
			const providerId = c.req.param("provider");
			const mod = providerModuleMap.get(providerId);
			if (!mod) return c.json({ error: "Unknown provider" }, 404);

			const body = await c.req.json();
			const { agentId, apiKey } = body;
			if (!agentId || !apiKey) {
				return c.json({ error: "Missing agentId or apiKey" }, 400);
			}

			const payload = resolveSession(c);
			if (!payload?.agentId || payload.agentId !== agentId) {
				return c.json({ error: "Unauthorized" }, 401);
			}

			await authProfilesManager.upsertProfile({
				agentId,
				provider: providerId,
				credential: apiKey,
				authType: "api-key",
				label: createAuthProfileLabel(mod.providerDisplayName, apiKey),
				makePrimary: true,
			});

			return c.json({ success: true });
		} catch {
			return c.json({ error: "Failed to save API key" }, 500);
		}
	});

	app.post("/:provider/logout", async (c) => {
		try {
			const providerId = c.req.param("provider");
			const mod = providerModuleMap.get(providerId);
			if (!mod) return c.json({ error: "Unknown provider" }, 404);

			const body = await c.req.json().catch(() => ({}));
			const agentId = body.agentId || c.req.query("agentId");

			if (!agentId) {
				return c.json({ error: "Missing agentId" }, 400);
			}

			const payload = resolveSession(c);
			if (!payload?.agentId || payload.agentId !== agentId) {
				return c.json({ error: "Unauthorized" }, 401);
			}

			await authProfilesManager.deleteProviderProfiles(
				agentId,
				providerId,
				body.profileId,
			);

			return c.json({ success: true });
		} catch {
			return c.json({ error: "Failed to logout" }, 500);
		}
	});

	return app;
}

describe("Auth router parameterized save-key/logout", () => {
	test("rejects unauthenticated save-key requests", async () => {
		const { manager, upsertCalls } = createAuthProfilesManagerMock();
		const module = new TestProviderModule(manager);
		const sessionStore = new TestSessionStore();
		const app = createAuthRouter(module, manager, sessionStore);

		const response = await app.request("/test-provider/save-key", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ agentId: "agent-1", apiKey: "sk-test" }),
		});

		expect(response.status).toBe(401);
		expect(upsertCalls).toHaveLength(0);
	});

	test("rejects unauthenticated logout requests", async () => {
		const { manager, deleteCalls } = createAuthProfilesManagerMock();
		const module = new TestProviderModule(manager);
		const sessionStore = new TestSessionStore();
		const app = createAuthRouter(module, manager, sessionStore);

		const response = await app.request("/test-provider/logout", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ agentId: "agent-1" }),
		});

		expect(response.status).toBe(401);
		expect(deleteCalls).toHaveLength(0);
	});

	test("accepts authenticated save-key requests with matching agent session", async () => {
		const { manager, upsertCalls } = createAuthProfilesManagerMock();
		const module = new TestProviderModule(manager);
		const sessionStore = new TestSessionStore();
		const app = createAuthRouter(module, manager, sessionStore);
		const { sessionId } = sessionStore.createSession(
			{ agentId: "agent-1", userId: "user-1", platform: "slack" },
			60_000,
		);

		const response = await app.request(
			`/test-provider/save-key?s=${encodeURIComponent(sessionId)}`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ agentId: "agent-1", apiKey: "sk-test" }),
			},
		);

		expect(response.status).toBe(200);
		expect(upsertCalls).toHaveLength(1);
	});

	test("rejects authenticated save-key requests when session agent mismatches", async () => {
		const { manager, upsertCalls } = createAuthProfilesManagerMock();
		const module = new TestProviderModule(manager);
		const sessionStore = new TestSessionStore();
		const app = createAuthRouter(module, manager, sessionStore);
		const { sessionId } = sessionStore.createSession(
			{ agentId: "agent-2", userId: "user-1", platform: "slack" },
			60_000,
		);

		const response = await app.request(
			`/test-provider/save-key?s=${encodeURIComponent(sessionId)}`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ agentId: "agent-1", apiKey: "sk-test" }),
			},
		);

		expect(response.status).toBe(401);
		expect(upsertCalls).toHaveLength(0);
	});

	test("rejects channel-scoped session for save-key requests", async () => {
		const { manager, upsertCalls } = createAuthProfilesManagerMock();
		const module = new TestProviderModule(manager);
		const sessionStore = new TestSessionStore();
		const app = createAuthRouter(module, manager, sessionStore);
		const { sessionId } = sessionStore.createSession(
			{ userId: "user-1", platform: "slack", channelId: "C123" },
			60_000,
		);

		const response = await app.request(
			`/test-provider/save-key?s=${encodeURIComponent(sessionId)}`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ agentId: "agent-1", apiKey: "sk-test" }),
			},
		);

		expect(response.status).toBe(401);
		expect(upsertCalls).toHaveLength(0);
	});

	test("returns 404 for unknown provider", async () => {
		const { manager } = createAuthProfilesManagerMock();
		const module = new TestProviderModule(manager);
		const sessionStore = new TestSessionStore();
		const app = createAuthRouter(module, manager, sessionStore);
		const { sessionId } = sessionStore.createSession(
			{ agentId: "agent-1", userId: "user-1", platform: "slack" },
			60_000,
		);

		const response = await app.request(
			`/unknown-provider/save-key?s=${encodeURIComponent(sessionId)}`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ agentId: "agent-1", apiKey: "sk-test" }),
			},
		);

		expect(response.status).toBe(404);
	});
});
