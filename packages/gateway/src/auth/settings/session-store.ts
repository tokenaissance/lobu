import { randomBytes } from "node:crypto";
import { BaseRedisStore, createLogger } from "@lobu/core";
import type Redis from "ioredis";
import type { SettingsSessionPayload } from "./token-service";

const logger = createLogger("auth-session-store");

/**
 * Redis-backed session store for all auth flows.
 *
 * Replaces encrypted tokens in URLs with opaque session IDs.
 * Context (userId, agentId, prefills, etc.) lives server-side in Redis.
 *
 * Key pattern: auth:session:{uuid}
 */
export class AuthSessionStore extends BaseRedisStore<SettingsSessionPayload> {
	constructor(redis: Redis) {
		super({
			redis,
			keyPrefix: "auth:session",
			loggerName: "auth-session-store",
		});
	}

	/**
	 * Create a new session with the given payload.
	 * Returns an opaque session ID (URL-safe random string).
	 */
	async createSession(
		payload: Omit<SettingsSessionPayload, "exp">,
		ttlMs: number,
	): Promise<{ sessionId: string; expiresAt: number }> {
		const sessionId = randomBytes(32).toString("base64url");
		const expiresAt = Date.now() + ttlMs;
		const fullPayload: SettingsSessionPayload = { ...payload, exp: expiresAt };

		const ttlSeconds = Math.ceil(ttlMs / 1000);
		const key = this.buildKey(sessionId);
		await this.set(key, fullPayload, ttlSeconds);

		logger.info("Created auth session", {
			sessionId: `${sessionId.substring(0, 8)}...`,
			userId: payload.userId,
			agentId: payload.agentId,
			platform: payload.platform,
		});

		return { sessionId, expiresAt };
	}

	/**
	 * Look up a session by ID.
	 * Returns the payload if found and not expired, null otherwise.
	 */
	async getSession(sessionId: string): Promise<SettingsSessionPayload | null> {
		const key = this.buildKey(sessionId);
		const payload = await this.get(key);
		if (!payload) return null;

		// Double-check expiry (Redis TTL is authoritative, but belt-and-suspenders)
		if (Date.now() > payload.exp) {
			logger.warn("Session expired (clock check)", {
				sessionId: `${sessionId.substring(0, 8)}...`,
			});
			await this.delete(key);
			return null;
		}

		return payload;
	}

	/**
	 * Consume a session (one-time use). Returns payload and deletes.
	 * Used for integration init URLs and MCP login URLs.
	 */
	async consumeSession(
		sessionId: string,
	): Promise<SettingsSessionPayload | null> {
		const key = this.buildKey(sessionId);

		// Atomic get+delete
		const data = await this.redis.getdel(key);
		if (!data) return null;

		try {
			const payload = JSON.parse(data) as SettingsSessionPayload;

			if (Date.now() > payload.exp) {
				logger.warn("Consumed session was expired", {
					sessionId: `${sessionId.substring(0, 8)}...`,
				});
				return null;
			}

			return payload;
		} catch (error) {
			logger.error("Failed to parse session data", { error });
			return null;
		}
	}

	/**
	 * Delete a session explicitly.
	 */
	async deleteSession(sessionId: string): Promise<void> {
		const key = this.buildKey(sessionId);
		await this.delete(key);
	}

	override validate(value: SettingsSessionPayload): boolean {
		return !!value.userId && !!value.platform && !!value.exp;
	}
}

/**
 * Build a settings URL with session ID as a query parameter.
 * The GET /settings handler validates the session, sets a cookie, and redirects clean.
 */
export function buildSessionUrl(sessionId: string): string {
	const baseUrl = process.env.PUBLIC_GATEWAY_URL || "http://localhost:8080";
	return `${baseUrl}/settings?s=${encodeURIComponent(sessionId)}`;
}

/**
 * Build an integration init URL with session ID.
 */
export function buildIntegrationInitUrl(
	integrationId: string,
	sessionId: string,
): string {
	const baseUrl = process.env.PUBLIC_GATEWAY_URL || "http://localhost:8080";
	return `${baseUrl}/api/v1/auth/integration/init/${integrationId}?s=${encodeURIComponent(sessionId)}`;
}
