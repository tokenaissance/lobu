import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AuthSessionStore } from "../../auth/settings/session-store";
import type { SettingsSessionPayload } from "../../auth/settings/token-service";

export const SETTINGS_SESSION_COOKIE_NAME = "lobu_settings_session";

/**
 * Singleton reference to the session store.
 * Set once during app initialization via `setSessionStore()`.
 */
let _sessionStore: AuthSessionStore | undefined;

export function setSessionStore(store: AuthSessionStore): void {
  _sessionStore = store;
}

function getSessionStore(): AuthSessionStore {
  if (!_sessionStore) {
    throw new Error(
      "AuthSessionStore not initialized — call setSessionStore() first"
    );
  }
  return _sessionStore;
}

function getSessionIdFromQuery(c: Context): string | undefined {
  // New session-based param
  const sid = c.req.query("s");
  if (sid && sid.trim().length > 0) return sid.trim();
  return undefined;
}

function getSessionIdFromCookie(c: Context): string | undefined {
  const sid = getCookie(c, SETTINGS_SESSION_COOKIE_NAME);
  if (!sid || sid.trim().length === 0) return undefined;
  return sid.trim();
}

function isSecureRequest(c: Context): boolean {
  const forwardedProto = c.req.header("x-forwarded-proto");
  if (forwardedProto) {
    return forwardedProto.split(",")[0]?.trim().toLowerCase() === "https";
  }
  return new URL(c.req.url).protocol === "https:";
}

/**
 * Resolve the session ID from query param or cookie.
 */
export function resolveSessionId(c: Context): string | undefined {
  return getSessionIdFromQuery(c) ?? getSessionIdFromCookie(c);
}

/**
 * Verify the current settings session.
 * Looks up the session ID in Redis and returns the payload if valid.
 */
export async function verifySettingsSession(
  c: Context
): Promise<SettingsSessionPayload | null> {
  const sessionId = resolveSessionId(c);
  if (!sessionId) return null;

  const store = getSessionStore();
  return store.getSession(sessionId);
}

/**
 * Set the session cookie with the session ID.
 */
export function setSettingsSessionCookie(
  c: Context,
  sessionId: string,
  payload: SettingsSessionPayload
): boolean {
  const maxAgeSeconds = Math.max(
    1,
    Math.floor((payload.exp - Date.now()) / 1000)
  );

  setCookie(c, SETTINGS_SESSION_COOKIE_NAME, sessionId, {
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    secure: isSecureRequest(c),
    maxAge: maxAgeSeconds,
  });

  return true;
}

export function clearSettingsSessionCookie(c: Context): void {
  deleteCookie(c, SETTINGS_SESSION_COOKIE_NAME, { path: "/" });
}
