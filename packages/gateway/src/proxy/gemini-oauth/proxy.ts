/**
 * Thin credential-swap proxy for Google Code Assist.
 *
 * Pattern: the worker runs pi-ai's `google-gemini-cli` provider natively, so
 * requests arrive here in Gemini-native `:streamGenerateContent` (or
 * `:generateContent`) shape already. Our only job is:
 *
 *   1. Look up the agent's OAuth profile.
 *   2. Refresh the access token if expired, discover the cloudaicompanion
 *      project if we haven't yet (cached).
 *   3. Replace the top-level `project` field in the request body with the
 *      real projectId.
 *   4. Swap `Authorization: Bearer <placeholder>` → `Bearer <real-access>`.
 *   5. Add pi-ai's Code Assist headers (User-Agent / X-Goog-Api-Client /
 *      Client-Metadata).
 *   6. Forward to `cloudcode-pa.googleapis.com` and stream the response back
 *      untouched.
 *
 * No OpenAI/Gemini translation, no retry ladder, no tier manipulation — pi-ai
 * already handles those inside the worker.
 */

import { createLogger } from "@lobu/core";
import { Hono } from "hono";
import type { AuthProfilesManager } from "../../auth/settings/auth-profiles-manager";
import {
  buildUpstreamHeaders,
  codeAssistUpstreamUrl,
  type OAuthCreds,
  resolveCodeAssist,
} from "./code-assist-client";

const logger = createLogger("gemini-oauth-proxy");

const PROVIDER_ID = "gemini-cli";

export interface GeminiOAuthProxyOptions {
  authProfilesManager: AuthProfilesManager;
}

function parseCreds(raw: string): OAuthCreds | null {
  try {
    const parsed = JSON.parse(raw) as Partial<OAuthCreds>;
    if (!parsed.refresh_token || typeof parsed.refresh_token !== "string") {
      return null;
    }
    return {
      access_token: parsed.access_token || "",
      refresh_token: parsed.refresh_token,
      expiry_date: parsed.expiry_date,
      token_type: parsed.token_type,
      id_token: parsed.id_token,
      scope: parsed.scope,
    };
  } catch {
    return null;
  }
}

export function createGeminiOAuthProxyApp(
  options: GeminiOAuthProxyOptions,
): Hono {
  const app = new Hono();

  app.get("/health", (c) =>
    c.json({ service: "gemini-oauth-proxy", status: "enabled" }),
  );

  app.all("/a/:agentId/*", async (c) => {
    const agentId = decodeURIComponent(c.req.param("agentId"));

    const profile = await options.authProfilesManager.getBestProfile(
      agentId,
      PROVIDER_ID,
    );
    if (!profile?.credential) {
      logger.warn({ agentId }, "No gemini-cli auth profile for agent");
      return c.json(
        {
          error: {
            message:
              "Agent has no gemini-cli auth profile configured. Install the 'gemini-cli' provider and paste ~/.gemini/oauth_creds.json.",
            code: 401,
            status: "UNAUTHENTICATED",
          },
        },
        401,
      );
    }

    const creds = parseCreds(profile.credential);
    if (!creds) {
      return c.json(
        {
          error: {
            message:
              "gemini-cli credential is not valid JSON with refresh_token",
            code: 400,
            status: "INVALID_ARGUMENT",
          },
        },
        400,
      );
    }

    let accessToken: string;
    let projectId: string;
    try {
      const resolved = await resolveCodeAssist(creds);
      accessToken = resolved.accessToken;
      projectId = resolved.projectId;
    } catch (err) {
      logger.error(
        { agentId, err: String(err) },
        "Code Assist resolve failed",
      );
      return c.json(
        {
          error: {
            message: err instanceof Error ? err.message : String(err),
            code: 500,
            status: "INTERNAL",
          },
        },
        500,
      );
    }

    // Forward path: everything after `/a/<agentId>`. The wildcard in the route
    // parameter strips the leading prefix for us via c.req.path.
    const url = new URL(c.req.url);
    const prefix = `/a/${encodeURIComponent(agentId)}`;
    const idx = url.pathname.indexOf(prefix);
    const upstreamPath =
      idx >= 0 ? url.pathname.slice(idx + prefix.length) : url.pathname;
    const upstreamUrl = codeAssistUpstreamUrl(upstreamPath, url.search);

    const method = c.req.method;
    let upstreamBody: string | undefined;
    if (method !== "GET" && method !== "HEAD") {
      const raw = await c.req.text();
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as Record<string, unknown>;
          parsed.project = projectId;
          upstreamBody = JSON.stringify(parsed);
        } catch {
          // Non-JSON body (shouldn't happen for Code Assist); forward as-is.
          upstreamBody = raw;
        }
      }
    }

    const upstreamHeaders = buildUpstreamHeaders(
      accessToken,
      Object.fromEntries(
        Object.entries(c.req.header()).filter(([_, v]) => typeof v === "string"),
      ) as Record<string, string>,
    );

    logger.info(
      { agentId, method, upstreamUrl },
      "Forwarding Code Assist request",
    );

    const response = await fetch(upstreamUrl, {
      method,
      headers: upstreamHeaders,
      body: upstreamBody,
    });

    if (!response.ok) {
      const errBody = await response
        .clone()
        .text()
        .catch(() => "");
      logger.warn(
        { status: response.status, upstreamUrl, errBody: errBody.slice(0, 300) },
        "Code Assist returned non-2xx",
      );
    }

    const responseHeaders = new Headers();
    response.headers.forEach((value, key) => {
      if (
        !["transfer-encoding", "connection", "upgrade", "content-encoding"].includes(
          key.toLowerCase(),
        )
      ) {
        responseHeaders.set(key, value);
      }
    });

    const contentType = response.headers.get("content-type") || "";
    if (
      contentType.includes("text/event-stream") ||
      response.headers.get("transfer-encoding") === "chunked"
    ) {
      responseHeaders.set("Cache-Control", "no-cache");
      responseHeaders.set("Connection", "keep-alive");
      if (response.body) {
        return new Response(response.body as ReadableStream, {
          status: response.status,
          headers: responseHeaders,
        });
      }
    }

    const text = await response.text();
    return new Response(text, {
      status: response.status,
      headers: responseHeaders,
    });
  });

  return app;
}

export { PROVIDER_ID as GEMINI_OAUTH_PROVIDER_ID };
