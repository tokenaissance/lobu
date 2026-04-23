import { createLogger } from "@lobu/core";
import { Hono } from "hono";
import type { AuthProfilesManager } from "../../auth/settings/auth-profiles-manager";
import { getCodeAssistClient, type OAuthCreds } from "./code-assist-client";
import {
  geminiResponseToOpenAI,
  openaiRequestToGemini,
  type OpenAIChatRequest,
  transformStream,
} from "./openai-adapter";

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

/**
 * Sub-app mounted at a slug (e.g. `/gemini-cli`).
 * Routes follow the same `/a/{agentId}/...` layout as the secret proxy, but
 * instead of passing traffic through it translates OpenAI Chat Completions
 * to Google Code Assist calls backed by the agent's OAuth auth profile.
 */
export function createGeminiOAuthProxyApp(
  options: GeminiOAuthProxyOptions
): Hono {
  const app = new Hono();

  app.post("/a/:agentId/chat/completions", async (c) => {
    const agentId = decodeURIComponent(c.req.param("agentId"));

    const profile = await options.authProfilesManager.getBestProfile(
      agentId,
      PROVIDER_ID
    );
    if (!profile?.credential) {
      logger.warn({ agentId }, "No gemini-cli auth profile for agent");
      return c.json(
        {
          error: {
            message:
              "Agent has no gemini-cli auth profile configured. Install the 'gemini-cli' provider and paste ~/.gemini/oauth_creds.json.",
            type: "authentication_error",
            code: "no_credentials",
          },
        },
        401
      );
    }

    const creds = parseCreds(profile.credential);
    if (!creds) {
      return c.json(
        {
          error: {
            message:
              "gemini-cli credential is not valid JSON with refresh_token",
            type: "invalid_request_error",
            code: "invalid_credential",
          },
        },
        400
      );
    }

    let openaiReq: OpenAIChatRequest;
    try {
      openaiReq = (await c.req.json()) as OpenAIChatRequest;
    } catch {
      return c.json(
        {
          error: {
            message: "Invalid JSON body",
            type: "invalid_request_error",
          },
        },
        400
      );
    }

    const { model, request } = openaiRequestToGemini(openaiReq);
    const geminiRequest = request as unknown as Record<string, unknown>;
    const client = getCodeAssistClient(creds);

    try {
      if (openaiReq.stream) {
        const upstream = await client.streamGenerateContent({
          model,
          request: geminiRequest,
        });
        if (!upstream.ok || !upstream.body) {
          const errText = upstream.body
            ? await upstream.text().catch(() => "")
            : "";
          logger.warn(
            {
              agentId,
              status: upstream.status,
              errText: errText.slice(0, 300),
            },
            "Code Assist stream returned non-2xx"
          );
          return c.json(
            {
              error: {
                message: `Code Assist error: ${upstream.status} ${errText.slice(0, 300)}`,
                type: "upstream_error",
              },
            },
            upstream.status as 500
          );
        }
        return new Response(transformStream(upstream.body, model), {
          status: 200,
          headers: {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
            connection: "keep-alive",
          },
        });
      }

      const response = await client.generateContent({
        model,
        request: geminiRequest,
      });
      return c.json(geminiResponseToOpenAI(response, model));
    } catch (err) {
      logger.error({ agentId, err: String(err) }, "Code Assist call failed");
      return c.json(
        {
          error: {
            message: err instanceof Error ? err.message : String(err),
            type: "upstream_error",
          },
        },
        502
      );
    }
  });

  app.get("/health", (c) =>
    c.json({ service: "gemini-oauth-proxy", status: "enabled" })
  );

  return app;
}

export { PROVIDER_ID as GEMINI_OAUTH_PROVIDER_ID };
