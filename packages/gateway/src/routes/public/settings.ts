/**
 * Settings HTML Page Route
 *
 * Serves the settings configuration page via magic link.
 * API endpoints have been moved to:
 *   - /api/v1/agents/{id}/config - Agent configuration
 *   - /api/v1/agents/{id}/schedules - Schedule management
 *   - /api/v1/github/* - GitHub utilities
 *   - /api/v1/skills/* - Skills utilities
 *   - /api/v1/oauth/* - OAuth flows
 */

import { OpenAPIHono } from "@hono/zod-openapi";
import { moduleRegistry } from "@lobu/core";
import type { AgentSettingsStore } from "../../auth/settings";
import { verifySettingsToken } from "../../auth/settings/token-service";
import type { GitHubAppAuth } from "../../modules/git-filesystem/github-app";
import { renderErrorPage, renderSettingsPage } from "./settings-page";

export interface SettingsPageConfig {
  agentSettingsStore: AgentSettingsStore;
  githubAuth?: GitHubAppAuth;
  githubAppInstallUrl?: string;
  githubOAuthClientId?: string;
}

export function createSettingsPageRoutes(
  config: SettingsPageConfig
): OpenAPIHono {
  const app = new OpenAPIHono();

  // HTML Settings Page (excluded from OpenAPI docs)
  app.get("/settings", async (c) => {
    const token = c.req.query("token");
    if (!token) {
      return c.html(
        renderErrorPage("Missing token. Please use the link sent to you."),
        400
      );
    }

    const payload = verifySettingsToken(token);
    if (!payload) {
      return c.html(
        renderErrorPage(
          "Invalid or expired link. Use /configure to request a new settings link."
        ),
        401
      );
    }

    const settings = await config.agentSettingsStore.getSettings(
      payload.agentId
    );

    // Build provider metadata from registry for dynamic UI rendering
    const providers = moduleRegistry.getModelProviderModules().map((m) => ({
      id: m.providerId,
      name: m.providerDisplayName,
      iconUrl: m.providerIconUrl || "",
      authType: m.authType || "oauth",
      apiKeyInstructions: m.apiKeyInstructions || "",
      apiKeyPlaceholder: m.apiKeyPlaceholder || "",
    }));

    return c.html(
      renderSettingsPage(payload, settings, token, {
        githubAppConfigured: !!config.githubAuth,
        githubAppInstallUrl: config.githubAppInstallUrl,
        githubOAuthConfigured: !!config.githubOAuthClientId,
        providers,
      })
    );
  });

  return app;
}

// Re-export for backwards compatibility during transition
export { createSettingsPageRoutes as createSettingsRoutes };
