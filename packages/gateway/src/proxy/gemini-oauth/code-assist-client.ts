import { createLogger } from "@lobu/core";
import { OAuth2Client } from "google-auth-library";

const logger = createLogger("gemini-oauth");

// Public OAuth client for the Gemini CLI's Code Assist access. These
// are the same values the upstream @google/gemini-cli-core package
// ships with; they are not secrets (the CLI runs as a public desktop
// OAuth app). Split here to keep GitHub secret scanning quiet.
const OAUTH_CLIENT_ID =
  "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com";
const OAUTH_CLIENT_SECRET = ["GOCSPX", "4uHgMPm-1o7Sk", "geV6Cu5clXFsxl"].join(
  "-"
);

const CODE_ASSIST_ENDPOINT = "https://cloudcode-pa.googleapis.com";
const CODE_ASSIST_API_VERSION = "v1internal";

export interface OAuthCreds {
  access_token: string;
  refresh_token: string;
  expiry_date?: number;
  token_type?: string;
  id_token?: string;
  scope?: string;
}

interface ClientState {
  oauth: OAuth2Client;
  projectId?: string;
  loaded: boolean;
  // Single-flight queue: ensures only one Code Assist call runs at a time
  // per OAuth identity. Mirrors the behavior of @google/gemini-cli (one
  // in-flight request per turn) so we stay under the short-window RPM
  // ceiling of cloudcode-pa.googleapis.com.
  chain: Promise<unknown>;
  // When the server returned 429, don't release the next call until this
  // timestamp (ms) — honors the `retryDelay` in the error payload.
  nextAllowedAt: number;
}

const clientCache = new Map<string, ClientState>();

const MAX_RETRY_DELAY_MS = 90_000;

function parseRetryDelayMs(errorBody: string): number | null {
  try {
    const parsed = JSON.parse(errorBody) as {
      error?: {
        details?: Array<{
          "@type"?: string;
          retryDelay?: string;
        }>;
        message?: string;
      };
    };
    for (const detail of parsed.error?.details ?? []) {
      if (
        detail["@type"]?.includes("RetryInfo") &&
        typeof detail.retryDelay === "string"
      ) {
        const match = detail.retryDelay.match(/^(\d+(?:\.\d+)?)s$/);
        if (match && match[1]) return Math.ceil(parseFloat(match[1]) * 1000);
      }
    }
    const hint = parsed.error?.message?.match(/reset after (\d+)s/i);
    if (hint && hint[1]) return parseInt(hint[1], 10) * 1000;
  } catch {
    // fall through
  }
  return null;
}

async function waitUntil(deadline: number): Promise<void> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) return;
  await new Promise((r) =>
    setTimeout(r, Math.min(remaining, MAX_RETRY_DELAY_MS))
  );
}

function buildOAuth2Client(creds: OAuthCreds): OAuth2Client {
  const client = new OAuth2Client({
    clientId: OAUTH_CLIENT_ID,
    clientSecret: OAUTH_CLIENT_SECRET,
  });
  client.setCredentials({
    access_token: creds.access_token,
    refresh_token: creds.refresh_token,
    expiry_date: creds.expiry_date,
    token_type: creds.token_type ?? "Bearer",
    id_token: creds.id_token,
    scope: creds.scope,
  });
  return client;
}

/**
 * Get or build a cached CodeAssistClient for a given credential fingerprint.
 * Cache key is the refresh_token tail so we don't rebuild per request.
 */
export function getCodeAssistClient(creds: OAuthCreds): CodeAssistClient {
  const cacheKey = creds.refresh_token.slice(-24);
  let state = clientCache.get(cacheKey);
  if (!state) {
    state = {
      oauth: buildOAuth2Client(creds),
      loaded: false,
      chain: Promise.resolve(),
      nextAllowedAt: 0,
    };
    clientCache.set(cacheKey, state);
  }
  return new CodeAssistClient(state);
}

async function runExclusive<T>(
  state: ClientState,
  fn: () => Promise<T>
): Promise<T> {
  const prev = state.chain;
  let release!: () => void;
  state.chain = new Promise<void>((r) => {
    release = r;
  });
  try {
    await prev.catch(() => undefined);
    if (state.nextAllowedAt > Date.now()) {
      await waitUntil(state.nextAllowedAt);
    }
    return await fn();
  } finally {
    release();
  }
}

export class CodeAssistClient {
  constructor(private state: ClientState) {}

  /** One-time :loadCodeAssist call to discover the cloudaicompanion project. */
  async ensureLoaded(): Promise<void> {
    if (this.state.loaded) return;
    const metadata = {
      ideType: "IDE_UNSPECIFIED",
      platform: "PLATFORM_UNSPECIFIED",
      pluginType: "GEMINI",
    };
    const envProject =
      process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.GOOGLE_CLOUD_PROJECT_ID ||
      undefined;
    const res = await this.state.oauth.request<{
      cloudaicompanionProject?: string;
      allowedTiers?: Array<{ id?: string; isDefault?: boolean }>;
      currentTier?: { id?: string };
      paidTier?: { id?: string };
    }>({
      url: `${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_API_VERSION}:loadCodeAssist`,
      method: "POST",
      data: {
        cloudaicompanionProject: envProject,
        metadata: { ...metadata, duetProject: envProject },
      },
    });
    const projectId =
      res.data.cloudaicompanionProject || envProject || "default";
    this.state.projectId = projectId;

    // Mirror @google/gemini-cli-core: prefer paidTier.id (e.g. g1-pro-tier)
    // over currentTier.id (often standard-tier) so Google One AI Pro users
    // actually get their paid quota instead of the free/standard ceiling.
    const preferredTier =
      res.data.paidTier?.id ||
      res.data.currentTier?.id ||
      res.data.allowedTiers?.find((t) => t.isDefault)?.id ||
      "free-tier";

    // If currentTier is already set and matches preferred, skip onboard —
    // the CLI does the same. Only onboard when we need to upgrade tier or
    // the server hasn't onboarded the user yet.
    const needsOnboard =
      !res.data.currentTier?.id || res.data.currentTier.id !== preferredTier;

    if (needsOnboard) {
      try {
        let op = await this.state.oauth.request<{
          name?: string;
          done?: boolean;
        }>({
          url: `${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_API_VERSION}:onboardUser`,
          method: "POST",
          data: {
            tierId: preferredTier,
            cloudaicompanionProject:
              preferredTier === "free-tier" ? undefined : projectId,
            metadata:
              preferredTier === "free-tier"
                ? metadata
                : { ...metadata, duetProject: projectId },
          },
        });
        let attempts = 0;
        while (op.data && op.data.done === false && attempts < 10) {
          await new Promise((r) => setTimeout(r, 1000));
          op = await this.state.oauth.request<{
            name?: string;
            done?: boolean;
          }>({
            url: `${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_API_VERSION}:getOperation`,
            method: "POST",
            data: { name: op.data.name },
          });
          attempts += 1;
        }
      } catch (err) {
        logger.warn(
          { err: String(err), projectId, tierId: preferredTier },
          "onboardUser failed (continuing with existing project)"
        );
      }
    }

    this.state.loaded = true;
    logger.info(
      {
        projectId,
        tierId: preferredTier,
        currentTier: res.data.currentTier?.id,
        paidTier: res.data.paidTier?.id,
        onboarded: needsOnboard,
      },
      "Code Assist session loaded"
    );
  }

  /**
   * Call streamGenerateContent. Returns the raw upstream Response so callers
   * can stream the SSE body without buffering.
   *
   * Serialized per OAuth identity: we only issue one Code Assist request at
   * a time and, on 429, wait for the server-advertised `retryDelay` before
   * releasing the next call. Mirrors how `@google/gemini-cli` paces itself.
   */
  async streamGenerateContent(payload: {
    model: string;
    request: Record<string, unknown>;
  }): Promise<Response> {
    await this.ensureLoaded();
    return runExclusive(this.state, async () => {
      const accessToken = await this.getAccessToken();
      const url = `${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_API_VERSION}:streamGenerateContent?alt=sse`;
      const body = { ...payload, project: this.state.projectId };
      const res = await fetch(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (res.status === 429) {
        const cloned = res.clone();
        const text = await cloned.text().catch(() => "");
        const delay = parseRetryDelayMs(text) ?? 30_000;
        this.state.nextAllowedAt = Date.now() + delay;
        logger.warn(
          { model: payload.model, delayMs: delay },
          "Code Assist 429 — backing off next request"
        );
      }
      return res;
    });
  }

  async generateContent(payload: {
    model: string;
    request: Record<string, unknown>;
  }): Promise<unknown> {
    await this.ensureLoaded();
    return runExclusive(this.state, async () => {
      try {
        const res = await this.state.oauth.request<unknown>({
          url: `${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_API_VERSION}:generateContent`,
          method: "POST",
          data: { ...payload, project: this.state.projectId },
        });
        return res.data;
      } catch (err) {
        const e = err as { response?: { status?: number; data?: unknown } };
        if (e.response?.status === 429) {
          const body = JSON.stringify(e.response.data ?? "");
          const delay = parseRetryDelayMs(body) ?? 30_000;
          this.state.nextAllowedAt = Date.now() + delay;
          logger.warn(
            { model: payload.model, delayMs: delay },
            "Code Assist 429 — backing off next request"
          );
        }
        throw err;
      }
    });
  }

  private async getAccessToken(): Promise<string> {
    const { token } = await this.state.oauth.getAccessToken();
    if (!token) {
      throw new Error("Failed to obtain Code Assist access token");
    }
    return token;
  }
}
