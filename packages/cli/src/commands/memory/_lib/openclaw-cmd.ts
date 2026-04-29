import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openInBrowser } from "./browser.js";
import { ApiError, ValidationError } from "./errors.js";
import {
  baseMcpUrl,
  getSessionForOrg,
  getUsableToken,
  mcpUrlForOrg,
  normalizeMcpUrl,
  type OpenClawOAuthSession,
  resolveOrg,
  resolveServerUrl,
  upsertStoredSession,
} from "./openclaw-auth.js";
import { isJson, printJson, printText } from "./output.js";

type OAuthRegistrationResponse = {
  client_id: string;
  client_secret?: string;
};

type OAuthTokenResponse = {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
};

const MCP_PROTOCOL_VERSION = "2025-03-26";
declare const __CLI_VERSION__: string;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function getCliVersion(): Promise<string> {
  if (typeof __CLI_VERSION__ !== "undefined") return __CLI_VERSION__;
  const dir = dirname(fileURLToPath(import.meta.url));
  const pkg = JSON.parse(
    readFileSync(resolve(dir, "../../package.json"), "utf-8")
  );
  return pkg.version;
}

function extractErrorMessage(
  parsed: Record<string, unknown>,
  status: number,
  statusText: string
): string {
  if (isRecord(parsed.error) && typeof parsed.error.message === "string")
    return parsed.error.message;
  if (typeof parsed.error_description === "string")
    return parsed.error_description;
  if (typeof parsed.error === "string") return parsed.error;
  return `HTTP ${status} ${statusText}`;
}

function parseJsonWithError<T>(text: string, fallbackMessage: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError(fallbackMessage);
  }
}

async function postJson<T>(
  url: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {}
): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  const parsed = raw
    ? parseJsonWithError<Record<string, unknown>>(
        raw,
        `Invalid JSON from ${url}`
      )
    : {};

  if (!res.ok) {
    throw new ApiError(
      `Request failed: ${extractErrorMessage(parsed, res.status, res.statusText)}`,
      res.status
    );
  }

  return parsed as T;
}

async function initializeMcpSession(
  url: string,
  accessToken: string
): Promise<string> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "__init__",
      method: "initialize",
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "lobu-memory", version: "1.0.0" },
      },
    }),
  });

  const raw = await response.text();
  const parsed = raw
    ? parseJsonWithError<Record<string, unknown>>(
        raw,
        `Invalid JSON from ${url}`
      )
    : {};

  if (!response.ok) {
    throw new ApiError(
      `Request failed: ${extractErrorMessage(parsed, response.status, response.statusText)}`,
      response.status
    );
  }

  const sessionId = response.headers.get("mcp-session-id");
  if (!sessionId) {
    throw new ApiError(
      "MCP initialize did not return an mcp-session-id header"
    );
  }

  await postJson(
    url,
    {
      jsonrpc: "2.0",
      method: "notifications/initialized",
    },
    {
      Authorization: `Bearer ${accessToken}`,
      "mcp-session-id": sessionId,
    }
  );

  return sessionId;
}

function buildPkceVerifier(): string {
  return randomBytes(32).toString("base64url");
}

function buildPkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function buildState(): string {
  return randomBytes(16).toString("base64url");
}

function computeExpiryIso(expiresInSeconds?: number): string | undefined {
  if (!expiresInSeconds || !Number.isFinite(expiresInSeconds)) return undefined;
  return new Date(
    Date.now() + Math.max(0, Math.floor(expiresInSeconds)) * 1000
  ).toISOString();
}

function resolveLoginUrl(urlArg?: string): string {
  if (urlArg) return normalizeMcpUrl(urlArg);
  if (process.env.OWLETTO_URL) return normalizeMcpUrl(process.env.OWLETTO_URL);
  throw new ValidationError(
    "URL is required. Pass a URL argument (e.g. https://lobu.ai/mcp) or set OWLETTO_URL."
  );
}

function deriveOAuthBaseUrl(mcpUrl: string, override?: string): string {
  if (override) return override.replace(/\/$/, "");
  const base = new URL(mcpUrl);
  base.pathname = "/";
  base.search = "";
  base.hash = "";
  return base.toString().replace(/\/$/, "");
}

async function startOAuthCallbackServer(
  expectedState: string,
  timeoutMs: number
): Promise<{
  redirectUri: string;
  waitForCode: () => Promise<string>;
}> {
  let resolver: ((code: string) => void) | null = null;
  let rejecter: ((error: Error) => void) | null = null;
  let done = false;
  let timeout: NodeJS.Timeout | null = null;

  const complete = (fn: () => void) => {
    if (done) return;
    done = true;
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }
    fn();
  };

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (url.pathname !== "/oauth/callback") {
      res.statusCode = 404;
      res.end("Not found");
      return;
    }

    const state = url.searchParams.get("state");
    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");
    const errorDescription = url.searchParams.get("error_description");

    if (error) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end(
        "Login failed. You can close this tab and return to your terminal."
      );
      complete(() =>
        rejecter?.(
          new ApiError(
            errorDescription
              ? `${error}: ${errorDescription}`
              : `OAuth error: ${error}`
          )
        )
      );
      void server.close();
      return;
    }

    if (!code) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Missing OAuth code. You can close this tab.");
      complete(() =>
        rejecter?.(new ApiError("OAuth callback did not include a code"))
      );
      void server.close();
      return;
    }

    if (!state || state !== expectedState) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("State mismatch. You can close this tab.");
      complete(() => rejecter?.(new ApiError("OAuth state mismatch")));
      void server.close();
      return;
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end(
      "Owletto login complete. You can close this tab and return to your terminal."
    );
    complete(() => resolver?.(code));
    void server.close();
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new ApiError("Failed to bind OAuth callback server");
  }

  const redirectUri = `http://127.0.0.1:${(address as AddressInfo).port}/oauth/callback`;

  const waitForCode = () =>
    new Promise<string>((resolve, reject) => {
      resolver = resolve;
      rejecter = reject;
      timeout = setTimeout(() => {
        complete(() =>
          reject(new ApiError("Timed out waiting for OAuth callback"))
        );
        void server.close();
      }, timeoutMs);
    });

  return { redirectUri, waitForCode };
}

async function getUsableTokenOrThrow(
  mcpUrl?: string,
  storePath?: string
): Promise<{
  token: string;
  session: OpenClawOAuthSession;
  storePath: string;
}> {
  const result = await getUsableToken(mcpUrl, storePath);
  if (!result) {
    if (mcpUrl) {
      throw new ValidationError(
        `No saved login for ${baseMcpUrl(mcpUrl)}. Run: owletto login`
      );
    }
    throw new ValidationError("No active session. Run: owletto login");
  }
  return result;
}

/**
 * Resolve session + org-scoped MCP URL.
 * If --org is given, find the session for that org (tokens are org-scoped).
 * Otherwise use the active session.
 */
async function resolveSessionAndUrl(
  urlFlag?: string,
  orgFlag?: string,
  storePath?: string
): Promise<{ token: string; session: OpenClawOAuthSession; mcpUrl: string }> {
  const org = resolveOrg(orgFlag);

  // If an explicit org is requested, find the session for that org
  if (org) {
    const orgSession = getSessionForOrg(org, storePath);
    if (orgSession) {
      const result = await getUsableToken(orgSession.key, storePath);
      if (result) {
        return {
          token: result.token,
          session: result.session,
          mcpUrl: orgSession.key,
        };
      }
    }
    // No session for that org — try constructing URL from active session's server
    const serverUrl = resolveServerUrl(urlFlag, storePath);
    if (serverUrl) {
      const orgUrl = mcpUrlForOrg(serverUrl, org);
      const result = await getUsableToken(orgUrl, storePath);
      if (result) {
        return { token: result.token, session: result.session, mcpUrl: orgUrl };
      }
    }
    throw new ValidationError(
      `No session for org "${org}". Run: owletto login <server-url>/mcp/${org}`
    );
  }

  // No explicit org — use active session
  const serverUrl = resolveServerUrl(urlFlag, storePath);
  const { token, session } = await getUsableTokenOrThrow(
    serverUrl || undefined,
    storePath
  );
  return { token, session, mcpUrl: session.mcpUrl };
}

function readJsonObject(filePath: string): Record<string, unknown> {
  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (isRecord(parsed)) return parsed;
    return {};
  } catch {
    return {};
  }
}

function writeJsonObject(filePath: string, payload: Record<string, unknown>) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

export interface LoginOptions {
  url?: string;
  oauthBaseUrl?: string;
  scope?: string;
  timeoutSec?: string;
  noOpen?: boolean;
  device?: boolean;
  storePath?: string;
}

export async function memoryLogin(opts: LoginOptions = {}): Promise<void> {
  const args = {
    scope: "mcp:read mcp:write profile:read",
    timeoutSec: "300",
    ...opts,
  };
  const mcpUrl = resolveLoginUrl(args.url);
  const issuer = deriveOAuthBaseUrl(mcpUrl, args.oauthBaseUrl);
  const timeoutSec = Number.parseInt(args.timeoutSec || "300", 10);
  if (!Number.isFinite(timeoutSec) || timeoutSec < 10) {
    throw new ValidationError("timeout-sec must be at least 10");
  }

  let token: OAuthTokenResponse | null = null;
  let clientId: string;
  let clientSecret: string | undefined;

  if (args.device) {
    // Device code flow — no local callback server needed
    const resource = mcpUrl;
    const scope = args.scope || "mcp:read mcp:write profile:read";
    const version = await getCliVersion();

    const registration = await postJson<OAuthRegistrationResponse>(
      `${issuer}/oauth/register`,
      {
        grant_types: [
          "urn:ietf:params:oauth:grant-type:device_code",
          "refresh_token",
        ],
        token_endpoint_auth_method: "none",
        client_name: "Lobu CLI",
        software_id: "lobu-memory",
        software_version: version,
        scope,
      }
    );

    const deviceAuth = await postJson<{
      device_code: string;
      user_code: string;
      verification_uri: string;
      verification_uri_complete: string;
      expires_in: number;
      interval: number;
    }>(`${issuer}/oauth/device_authorization`, {
      client_id: registration.client_id,
      scope,
      resource,
    });

    printText(
      `\nOpen this URL in your browser:\n  ${deviceAuth.verification_uri_complete || deviceAuth.verification_uri}`
    );
    printText(`\nEnter code: ${deviceAuth.user_code}\n`);
    printText("Waiting for approval...");

    const interval = Math.max((deviceAuth.interval || 5) * 1000, 5000);
    const deadline = Date.now() + timeoutSec * 1000;

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, interval));

      const body: Record<string, string> = {
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        client_id: registration.client_id,
        device_code: deviceAuth.device_code,
      };
      if (registration.client_secret) {
        body.client_secret = registration.client_secret;
      }

      const res = await fetch(`${issuer}/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const raw = await res.text();
      let data: Record<string, unknown>;
      try {
        data = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      } catch {
        // Non-JSON response during polling — retry on next interval
        continue;
      }

      if (res.ok && typeof data.access_token === "string") {
        token = data as OAuthTokenResponse;
        break;
      }

      const error = typeof data.error === "string" ? data.error : "";
      if (error === "authorization_pending" || error === "slow_down") {
        continue;
      }
      if (error === "expired_token") {
        throw new ApiError("Device code expired. Please try again.");
      }
      if (error === "access_denied") {
        throw new ApiError("Authorization request was denied.");
      }
      const desc =
        typeof data.error_description === "string"
          ? data.error_description
          : error;
      throw new ApiError(desc || "Device login failed");
    }

    if (!token) {
      throw new ApiError("Timed out waiting for device approval");
    }

    clientId = registration.client_id;
    clientSecret = registration.client_secret;
  } else {
    // Authorization code flow with local callback server
    const state = buildState();
    const verifier = buildPkceVerifier();
    const challenge = buildPkceChallenge(verifier);
    const callback = await startOAuthCallbackServer(state, timeoutSec * 1000);
    const version = await getCliVersion();

    const registration = await postJson<OAuthRegistrationResponse>(
      `${issuer}/oauth/register`,
      {
        redirect_uris: [callback.redirectUri],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        client_name: "Lobu CLI",
        software_id: "lobu-memory",
        software_version: version,
        scope: args.scope,
      }
    );

    const authorize = new URL("/oauth/authorize", `${issuer}/`);
    authorize.searchParams.set("client_id", registration.client_id);
    authorize.searchParams.set("redirect_uri", callback.redirectUri);
    authorize.searchParams.set("response_type", "code");
    authorize.searchParams.set(
      "scope",
      args.scope || "mcp:read mcp:write profile:read"
    );
    authorize.searchParams.set("state", state);
    authorize.searchParams.set("code_challenge", challenge);
    authorize.searchParams.set("code_challenge_method", "S256");
    authorize.searchParams.set("resource", mcpUrl);

    const authUrl = authorize.toString();
    if (!args.noOpen) {
      const opened = openInBrowser(authUrl);
      if (!opened) {
        printText(`Open this URL in your browser:\n${authUrl}`);
      }
    } else {
      printText(`Open this URL in your browser:\n${authUrl}`);
    }

    const code = await callback.waitForCode();
    token = await postJson<OAuthTokenResponse>(`${issuer}/oauth/token`, {
      grant_type: "authorization_code",
      client_id: registration.client_id,
      client_secret: registration.client_secret,
      code,
      redirect_uri: callback.redirectUri,
      code_verifier: verifier,
    });

    clientId = registration.client_id;
    clientSecret = registration.client_secret;
  }

  if (!token?.access_token || !token.refresh_token) {
    throw new ApiError(
      "OAuth token response missing access_token or refresh_token"
    );
  }

  let org: string | undefined;
  try {
    const res = await fetch(`${issuer}/oauth/userinfo`, {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    if (res.ok) {
      const userInfo = (await res.json()) as { organization_slug?: string };
      org = userInfo.organization_slug || undefined;
    }
  } catch {
    // Non-fatal: the session remains usable without the org cached locally.
  }

  // Store session at the org-scoped URL when org is known (tokens are org-scoped)
  const sessionMcpUrl = org ? mcpUrlForOrg(mcpUrl, org) : mcpUrl;
  const session: OpenClawOAuthSession = {
    mcpUrl: sessionMcpUrl,
    issuer,
    org,
    clientId,
    clientSecret,
    refreshToken: token.refresh_token,
    accessToken: token.access_token,
    accessTokenExpiresAt: computeExpiryIso(token.expires_in),
    tokenType: token.token_type || "Bearer",
    scope: token.scope,
    updatedAt: new Date().toISOString(),
  };
  upsertStoredSession(session, args.storePath);

  const server = baseMcpUrl(mcpUrl);

  if (isJson()) {
    printJson({
      server,
      issuer,
      org: org || null,
      scope: session.scope,
      storePath: resolve(
        args.storePath || resolve(homedir(), ".owletto", "openclaw-auth.json")
      ),
    });
    return;
  }

  printText(`Logged in. Server: ${server}`);
  printText(`Org: ${org || "(none)"}`);
  printText(
    "Use `lobu memory org set <slug>` or `--org` to set your workspace."
  );
}

export interface TokenOptions {
  url?: string;
  org?: string;
  raw?: boolean;
  storePath?: string;
}

export async function printMemoryToken(opts: TokenOptions = {}): Promise<void> {
  const {
    token: accessToken,
    session,
    mcpUrl,
  } = await resolveSessionAndUrl(opts.url, opts.org, opts.storePath);

  if (opts.raw) {
    process.stdout.write(`${accessToken}\n`);
    return;
  }

  const org = resolveOrg(opts.org, session);

  if (isJson()) {
    printJson({
      mcpUrl,
      org: org || null,
      tokenType: session.tokenType || "Bearer",
      accessToken,
    });
    return;
  }

  printText(`mcpUrl: ${mcpUrl}`);
  printText(`org: ${org || "(none)"}`);
  printText(`tokenType: ${session.tokenType || "Bearer"}`);
  printText(`accessToken: ${accessToken}`);
}

export interface HealthOptions {
  url?: string;
  org?: string;
  storePath?: string;
}

export async function checkMemoryHealth(
  opts: HealthOptions = {}
): Promise<void> {
  const {
    token: accessToken,
    session,
    mcpUrl: targetMcpUrl,
  } = await resolveSessionAndUrl(opts.url, opts.org, opts.storePath);
  const org = resolveOrg(opts.org, session);
  const sessionId = await initializeMcpSession(targetMcpUrl, accessToken);

  const result = await postJson<{ result?: { tools?: unknown[] } }>(
    targetMcpUrl,
    {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    },
    {
      Authorization: `Bearer ${accessToken}`,
      "mcp-session-id": sessionId,
    }
  );

  const toolsCount = Array.isArray(result.result?.tools)
    ? result.result?.tools.length
    : 0;

  if (isJson()) {
    printJson({
      ok: true,
      server: session.mcpUrl,
      mcpUrl: targetMcpUrl,
      issuer: session.issuer,
      org: org || null,
      toolsCount,
    });
    return;
  }

  printText("ok: true");
  printText(`server: ${session.mcpUrl}`);
  printText(`mcpUrl: ${targetMcpUrl}`);
  printText(`issuer: ${session.issuer}`);
  printText(`org: ${org || "(none)"}`);
  printText(`tools: ${toolsCount}`);
}

export interface ConfigureOptions {
  url?: string;
  configPath?: string;
  tokenCommand?: string;
}

export function configureMemoryPlugin(opts: ConfigureOptions = {}): void {
  const resolvedMcpUrl = resolveLoginUrl(opts.url);
  const configPath = resolve(
    opts.configPath || resolve(homedir(), ".openclaw", "openclaw.json")
  );
  const config = readJsonObject(configPath);

  if (!isRecord(config.plugins)) {
    config.plugins = {};
  }
  const plugins = config.plugins as Record<string, unknown>;
  if (!isRecord(plugins.entries)) {
    plugins.entries = {};
  }
  const entries = plugins.entries as Record<string, unknown>;
  const pluginId = "openclaw-owletto";
  const existingEntry = isRecord(entries[pluginId])
    ? (entries[pluginId] as Record<string, unknown>)
    : {};
  const existingConfig = isRecord(existingEntry.config)
    ? (existingEntry.config as Record<string, unknown>)
    : {};

  const tokenCommand = opts.tokenCommand || "lobu memory token --raw";

  entries[pluginId] = {
    ...existingEntry,
    enabled: true,
    config: {
      ...existingConfig,
      mcpUrl: normalizeMcpUrl(resolvedMcpUrl),
      tokenCommand,
    },
  };

  writeJsonObject(configPath, config);

  if (isJson()) {
    printJson({
      updated: true,
      configPath,
      pluginId,
      mcpUrl: normalizeMcpUrl(resolvedMcpUrl),
      tokenCommand,
    });
    return;
  }

  printText(`Updated ${configPath}`);
  printText(`Plugin: ${pluginId}`);
  printText(`mcpUrl: ${normalizeMcpUrl(resolvedMcpUrl)}`);
  printText(`tokenCommand: ${tokenCommand}`);
}
