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
import { collectProviderModelOptions } from "../../auth/provider-model-options";
import type { AgentSettingsStore } from "../../auth/settings";
import { verifySettingsToken } from "../../auth/settings/token-service";
import type { GitHubAppAuth } from "../../modules/git-filesystem/github-app";
import type { ProviderMeta } from "./settings-page";
import { renderErrorPage, renderSettingsPage } from "./settings-page";

export interface SettingsPageConfig {
  agentSettingsStore: AgentSettingsStore;
  githubAuth?: GitHubAppAuth;
  githubAppInstallUrl?: string;
  githubOAuthClientId?: string;
}

function buildProviderMeta(
  m: ReturnType<typeof moduleRegistry.getModelProviderModules>[number]
): ProviderMeta {
  return {
    id: m.providerId,
    name: m.providerDisplayName,
    iconUrl: m.providerIconUrl || "",
    authType: (m.authType || "oauth") as ProviderMeta["authType"],
    supportedAuthTypes:
      (m.supportedAuthTypes as ProviderMeta["supportedAuthTypes"]) || [
        m.authType || "oauth",
      ],
    apiKeyInstructions: m.apiKeyInstructions || "",
    apiKeyPlaceholder: m.apiKeyPlaceholder || "",
    catalogDescription: m.catalogDescription || "",
  };
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

    // Build provider metadata from registry
    const allModules = moduleRegistry.getModelProviderModules();
    const allProviderMeta = allModules
      .filter((m) => m.catalogVisible !== false)
      .map(buildProviderMeta);

    // Resolve installed providers in order
    const installedIds = (settings?.installedProviders || []).map(
      (ip) => ip.providerId
    );
    const installedSet = new Set(installedIds);
    const installedProviders = installedIds
      .map((id) => allProviderMeta.find((p) => p.id === id))
      .filter((p): p is ProviderMeta => p !== undefined);

    // Catalog providers = all that are not installed
    const catalogProviders = allProviderMeta.filter(
      (p) => !installedSet.has(p.id)
    );

    const providerModelOptions = await collectProviderModelOptions(
      payload.agentId,
      payload.userId
    );

    return c.html(
      renderSettingsPage(payload, settings, token, {
        githubAppConfigured: !!config.githubAuth,
        githubAppInstallUrl: config.githubAppInstallUrl,
        githubOAuthConfigured: !!config.githubOAuthClientId,
        providers: installedProviders,
        catalogProviders,
        providerModelOptions,
      })
    );
  });

  return app;
}
