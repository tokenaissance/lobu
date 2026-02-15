/**
 * OAuth Utility Routes
 *
 * OAuth code exchange and redirect handling.
 */

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { ClaudeOAuthStateStore } from "../../auth/oauth/state-store";
import type { AgentSettingsStore } from "../../auth/settings";
import { verifySettingsToken } from "../../auth/settings/token-service";
import { renderErrorPage } from "./settings-page";

const TAG = "OAuth";
const ErrorResponse = z.object({ error: z.string() });
const SuccessResponse = z.object({ success: z.boolean() });

export interface ProviderCredentialStore {
  hasCredentials(agentId: string): Promise<boolean>;
  deleteCredentials(agentId: string): Promise<void>;
  setCredentials(agentId: string, credentials: unknown): Promise<void>;
}

export interface ProviderOAuthClient {
  generateCodeVerifier(): string;
  buildAuthUrl(state: string, codeVerifier: string): string;
  exchangeCodeForToken(
    code: string,
    codeVerifier: string,
    redirectUri?: string,
    state?: string
  ): Promise<unknown>;
}

const codeExchangeRoute = createRoute({
  method: "post",
  path: "/providers/{provider}/code",
  tags: [TAG],
  summary: "Exchange OAuth code for token",
  request: {
    query: z.object({ token: z.string() }),
    params: z.object({ provider: z.string() }),
    body: {
      content: {
        "application/json": {
          schema: z.object({ code: z.string() }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Exchanged",
      content: { "application/json": { schema: SuccessResponse } },
    },
    400: {
      description: "Invalid",
      content: { "application/json": { schema: ErrorResponse } },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: ErrorResponse } },
    },
  },
});

const providerLogoutRoute = createRoute({
  method: "post",
  path: "/providers/{provider}/logout",
  tags: [TAG],
  summary: "Disconnect OAuth provider",
  request: {
    query: z.object({ token: z.string() }),
    params: z.object({ provider: z.string() }),
  },
  responses: {
    200: {
      description: "Disconnected",
      content: { "application/json": { schema: SuccessResponse } },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: ErrorResponse } },
    },
    404: {
      description: "Not found",
      content: { "application/json": { schema: ErrorResponse } },
    },
  },
});

const githubLogoutRoute = createRoute({
  method: "post",
  path: "/github/logout",
  tags: [TAG],
  summary: "Disconnect GitHub account",
  request: {
    query: z.object({ token: z.string() }),
  },
  responses: {
    200: {
      description: "Disconnected",
      content: { "application/json": { schema: SuccessResponse } },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: ErrorResponse } },
    },
  },
});

export interface OAuthRoutesConfig {
  providerStores?: Record<string, ProviderCredentialStore>;
  oauthClients?: Record<string, ProviderOAuthClient>;
  oauthStateStore?: ClaudeOAuthStateStore;
  agentSettingsStore: AgentSettingsStore;
  githubOAuthClientId?: string;
  githubOAuthClientSecret?: string;
  publicGatewayUrl?: string;
}

export function createOAuthRoutes(config: OAuthRoutesConfig): OpenAPIHono {
  const app = new OpenAPIHono();

  const verifyToken = (token: string | undefined) =>
    token ? verifySettingsToken(token) : null;

  // --- Provider login redirect (excluded from docs) ---
  app.get("/providers/:provider/login", async (c) => {
    const payload = verifyToken(c.req.query("token"));
    if (!payload) return c.json({ error: "Unauthorized" }, 401);

    const provider = c.req.param("provider");
    const oauthClient = config.oauthClients?.[provider];
    if (!oauthClient) return c.json({ error: "Unknown provider" }, 404);
    if (!config.oauthStateStore)
      return c.json({ error: "Not configured" }, 500);

    const codeVerifier = oauthClient.generateCodeVerifier();
    const state = await config.oauthStateStore.create({
      userId: payload.userId,
      agentId: payload.agentId,
      codeVerifier,
      context: { platform: payload.platform, channelId: payload.agentId },
    });

    return c.redirect(oauthClient.buildAuthUrl(state, codeVerifier));
  });

  // --- GitHub OAuth login redirect (excluded from docs) ---
  app.get("/github/login", async (c) => {
    const token = c.req.query("token");
    const payload = verifyToken(token);
    if (!payload) return c.json({ error: "Unauthorized" }, 401);
    if (!config.githubOAuthClientId || !config.publicGatewayUrl) {
      return c.json({ error: "GitHub OAuth not configured" }, 500);
    }

    const state = Buffer.from(
      JSON.stringify({ settingsToken: token, timestamp: Date.now() })
    ).toString("base64url");

    const authUrl = new URL("https://github.com/login/oauth/authorize");
    authUrl.searchParams.set("client_id", config.githubOAuthClientId);
    authUrl.searchParams.set(
      "redirect_uri",
      `${config.publicGatewayUrl}/api/v1/oauth/github/callback`
    );
    authUrl.searchParams.set("scope", "read:user");
    authUrl.searchParams.set("state", state);

    return c.redirect(authUrl.toString());
  });

  // --- GitHub OAuth callback (excluded from docs) ---
  app.get("/github/callback", async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");
    const error = c.req.query("error");

    if (error)
      return c.html(renderErrorPage(`GitHub OAuth failed: ${error}`), 400);
    if (!code || !state)
      return c.html(renderErrorPage("Missing code or state"), 400);

    let stateData: { settingsToken: string; timestamp: number };
    try {
      stateData = JSON.parse(Buffer.from(state, "base64url").toString("utf-8"));
    } catch {
      return c.html(renderErrorPage("Invalid OAuth state"), 400);
    }

    if (Date.now() - stateData.timestamp > 10 * 60 * 1000) {
      return c.html(renderErrorPage("OAuth state expired"), 400);
    }

    const payload = verifySettingsToken(stateData.settingsToken);
    if (!payload) return c.html(renderErrorPage("Invalid settings token"), 401);

    if (
      !config.githubOAuthClientId ||
      !config.githubOAuthClientSecret ||
      !config.publicGatewayUrl
    ) {
      return c.html(renderErrorPage("GitHub OAuth not configured"), 500);
    }

    try {
      const tokenResponse = await fetch(
        "https://github.com/login/oauth/access_token",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            client_id: config.githubOAuthClientId,
            client_secret: config.githubOAuthClientSecret,
            code,
            redirect_uri: `${config.publicGatewayUrl}/api/v1/oauth/github/callback`,
          }),
        }
      );

      const tokenData = (await tokenResponse.json()) as {
        access_token?: string;
        error?: string;
      };
      if (!tokenData.access_token) {
        return c.html(
          renderErrorPage(
            `GitHub auth failed: ${tokenData.error || "Unknown"}`
          ),
          400
        );
      }

      const userResponse = await fetch("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "Lobu",
        },
      });

      if (!userResponse.ok) {
        return c.html(renderErrorPage("Failed to fetch GitHub user"), 500);
      }

      const userData = (await userResponse.json()) as {
        login: string;
        id: number;
        avatar_url: string;
      };

      const currentSettings = await config.agentSettingsStore.getSettings(
        payload.agentId
      );
      await config.agentSettingsStore.updateSettings(payload.agentId, {
        ...currentSettings,
        githubUser: {
          login: userData.login,
          id: userData.id,
          avatarUrl: userData.avatar_url,
          accessToken: tokenData.access_token,
          connectedAt: Date.now(),
        },
      });

      return c.redirect(
        `/settings?token=${encodeURIComponent(stateData.settingsToken)}&github_connected=true`
      );
    } catch {
      return c.html(renderErrorPage("GitHub authentication failed"), 500);
    }
  });

  // --- Provider code exchange ---
  app.openapi(codeExchangeRoute, async (c): Promise<any> => {
    const { token } = c.req.valid("query");
    const payload = verifyToken(token);
    if (!payload) return c.json({ error: "Unauthorized" }, 401);

    const { provider } = c.req.valid("param");
    const oauthClient = config.oauthClients?.[provider];
    const credentialStore = config.providerStores?.[provider];
    if (!oauthClient || !credentialStore)
      return c.json({ error: "Unknown provider" }, 404);
    if (!config.oauthStateStore)
      return c.json({ error: "Not configured" }, 500);

    const { code: input } = c.req.valid("json");
    const parts = input.split("#");
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      return c.json({ error: "Invalid format" }, 400);
    }

    const authCode = parts[0].trim();
    const state = parts[1].trim();
    const stateData = await config.oauthStateStore.consume(state);
    if (!stateData) return c.json({ error: "Invalid state" }, 400);

    try {
      const credentials = await oauthClient.exchangeCodeForToken(
        authCode,
        stateData.codeVerifier,
        "https://console.anthropic.com/oauth/code/callback",
        state
      );
      await credentialStore.setCredentials(payload.agentId, credentials);
      return c.json({ success: true });
    } catch (e) {
      return c.json(
        { error: e instanceof Error ? e.message : "Exchange failed" },
        400
      );
    }
  });

  // --- Provider logout ---
  app.openapi(providerLogoutRoute, async (c): Promise<any> => {
    const payload = verifyToken(c.req.valid("query").token);
    if (!payload) return c.json({ error: "Unauthorized" }, 401);

    const { provider } = c.req.valid("param");
    const store = config.providerStores?.[provider];
    if (!store) return c.json({ error: "Unknown provider" }, 404);

    await store.deleteCredentials(payload.agentId);
    return c.json({ success: true });
  });

  // --- GitHub logout ---
  app.openapi(githubLogoutRoute, async (c): Promise<any> => {
    const payload = verifyToken(c.req.valid("query").token);
    if (!payload) return c.json({ error: "Unauthorized" }, 401);

    const settings = await config.agentSettingsStore.getSettings(
      payload.agentId
    );
    if (settings) {
      const { githubUser: _, ...rest } = settings as any;
      await config.agentSettingsStore.saveSettings(payload.agentId, rest);
    }
    return c.json({ success: true });
  });

  return app;
}
