import type { IntegrationAccountInfo, IntegrationInfo } from "@lobu/core";
import { createLogger } from "@lobu/core";
import { Hono } from "hono";
import type { InteractionService } from "../../interactions";
import { authenticateWorker } from "../../routes/internal/worker-auth";
import type { AgentSettingsStore } from "../settings/agent-settings-store";
import type { IntegrationConfigService } from "./config-service";
import type { IntegrationCredentialStore } from "./credential-store";
import type { IntegrationOAuthModule } from "./oauth-module";

const logger = createLogger("integration-routes");

type WorkerContext = {
  Variables: {
    worker: {
      userId: string;
      conversationId: string;
      channelId: string;
      teamId?: string;
      agentId?: string;
      connectionId?: string;
      platform?: string;
    };
  };
};

/**
 * Create internal integration routes for workers.
 * GET  /internal/integrations          — list all integrations and connection status
 * POST /internal/integrations/connect  — request connection (triggers OAuth)
 * POST /internal/integrations/disconnect — disconnect an integration
 */
export function createIntegrationRoutes(
  configService: IntegrationConfigService,
  credentialStore: IntegrationCredentialStore,
  oauthModule: IntegrationOAuthModule,
  publicGatewayUrl: string,
  interactionService?: InteractionService,
  agentSettingsStore?: AgentSettingsStore
): Hono<WorkerContext> {
  const router = new Hono<WorkerContext>();

  /**
   * GET /internal/integrations
   * Returns list of all configured integrations with connection status.
   */
  router.get("/internal/integrations", authenticateWorker, async (c) => {
    const worker = c.get("worker");
    const agentId = worker.agentId;

    if (!agentId) {
      return c.json({ error: "Missing agentId in worker token" }, 400);
    }

    try {
      const allConfigs = await configService.getAll();
      const integrations: IntegrationInfo[] = [];

      for (const [id, config] of Object.entries(allConfigs)) {
        const authType = config.authType || "oauth";
        const accountList = await credentialStore.listAccounts(agentId, id);
        const accounts: IntegrationAccountInfo[] = accountList.map((a) => ({
          accountId: a.accountId,
          grantedScopes: a.credentials.grantedScopes,
        }));
        // Resolve per-agent config to check if OAuth credentials are set
        const resolved = await configService.getIntegration(id, agentId);
        const isOAuth = authType === "oauth";
        const configured =
          !isOAuth ||
          !!(resolved?.oauth?.clientId && resolved?.oauth?.clientSecret);
        integrations.push({
          id,
          label: config.label,
          authType,
          connected: accounts.length > 0,
          configured,
          accounts,
          availableScopes: config.scopes?.available ?? [],
        });
      }

      return c.json({ integrations });
    } catch (error) {
      logger.error("Failed to list integrations", { error });
      return c.json({ error: "Failed to list integrations" }, 500);
    }
  });

  /**
   * POST /internal/integrations/connect
   * Body: { integration: string, scopes?: string[], reason?: string }
   * Validates scopes, checks if already granted, triggers OAuth if needed.
   */
  router.post(
    "/internal/integrations/connect",
    authenticateWorker,
    async (c) => {
      const worker = c.get("worker");
      const agentId = worker.agentId;

      if (!agentId) {
        return c.json({ error: "Missing agentId in worker token" }, 400);
      }

      try {
        const body = await c.req.json();
        const { integration, scopes, account } = body;
        const accountId: string = account || "default";

        if (!integration) {
          return c.json({ error: "Missing 'integration' field" }, 400);
        }

        const config = await configService.getIntegration(integration, agentId);
        if (!config) {
          return c.json(
            { error: `Integration "${integration}" not found` },
            404
          );
        }

        // API key integrations can't use OAuth connect flow
        if ((config.authType || "oauth") === "api-key") {
          return c.json(
            {
              error: `Integration "${integration}" uses API key auth. Configure it in the settings page.`,
            },
            400
          );
        }

        // Validate OAuth credentials are configured
        if (
          config.oauth &&
          (!config.oauth.clientId || !config.oauth.clientSecret)
        ) {
          return c.json(
            {
              error: `Integration "${integration}" requires OAuth app credentials. Use InstallSkill to install it, then configure credentials in settings.`,
            },
            400
          );
        }

        // Determine requested scopes
        const requestedScopes =
          scopes && scopes.length > 0 ? scopes : (config.scopes?.default ?? []);

        // Validate all requested scopes are in the available list
        const availableScopes = config.scopes?.available ?? [];
        const defaultScopes = config.scopes?.default ?? [];
        const invalidScopes = requestedScopes.filter(
          (s: string) =>
            !availableScopes.includes(s) && !defaultScopes.includes(s)
        );
        if (invalidScopes.length > 0) {
          return c.json(
            {
              error: `Scope(s) not allowed by admin: ${invalidScopes.join(", ")}`,
              availableScopes,
            },
            403
          );
        }

        // Check if all requested scopes are already granted for this account
        const existing = await credentialStore.getCredentials(
          agentId,
          integration,
          accountId
        );
        if (existing?.grantedScopes?.length) {
          const granted = existing.grantedScopes;
          const allGranted = requestedScopes.every((s: string) =>
            granted.includes(s)
          );
          if (allGranted) {
            return c.json({
              status: "already_connected",
              message: `Already connected to "${integration}" (account: ${accountId}) with all requested scopes.`,
              grantedScopes: existing.grantedScopes,
            });
          }
        }

        // Generate OAuth URL with thread context for post-auth notification
        const token = oauthModule.generateSecureToken(
          worker.userId,
          agentId,
          integration,
          requestedScopes,
          accountId,
          {
            channelId: worker.channelId,
            conversationId: worker.conversationId,
            teamId: worker.teamId || "",
            platform: worker.platform || "api",
            connectionId: worker.connectionId,
          }
        );
        const oauthUrl = `${publicGatewayUrl}/api/v1/auth/integration/init/${integration}?token=${encodeURIComponent(token)}`;

        // Send login link to user via InteractionService
        if (interactionService) {
          const platform = worker.platform || "api";
          await interactionService.postLinkButton(
            worker.userId,
            worker.conversationId,
            worker.channelId,
            worker.teamId,
            worker.connectionId,
            platform,
            oauthUrl,
            `Connect ${config.label}`,
            "oauth"
          );

          return c.json({
            status: "login_required",
            message: `A login button for "${config.label}" has been sent to the user. Session will end now.`,
          });
        }

        // Fallback: return URL directly
        return c.json({
          status: "login_required",
          message: `User must authenticate with ${config.label}`,
          url: oauthUrl,
        });
      } catch (error) {
        logger.error("Failed to request integration connection", { error });
        return c.json({ error: "Failed to request connection" }, 500);
      }
    }
  );

  /**
   * POST /internal/integrations/disconnect
   * Body: { integration: string }
   * Deletes credentials from store. For agent-created integrations, also removes the config.
   */
  router.post(
    "/internal/integrations/disconnect",
    authenticateWorker,
    async (c) => {
      const worker = c.get("worker");
      const agentId = worker.agentId;

      if (!agentId) {
        return c.json({ error: "Missing agentId in worker token" }, 400);
      }

      try {
        const body = await c.req.json();
        const { integration, account } = body;
        const accountId: string = account || "default";

        if (!integration) {
          return c.json({ error: "Missing 'integration' field" }, 400);
        }

        await credentialStore.deleteCredentials(
          agentId,
          integration,
          accountId
        );

        // If this is an agent-created integration, also remove the config
        if (agentSettingsStore) {
          const settings = await agentSettingsStore.getSettings(agentId);
          if (settings?.agentIntegrations?.[integration]) {
            const updated = { ...settings.agentIntegrations };
            delete updated[integration];
            await agentSettingsStore.updateSettings(agentId, {
              agentIntegrations:
                Object.keys(updated).length > 0 ? updated : undefined,
            });
          }
        }

        logger.info(
          `Disconnected integration "${integration}" account "${accountId}" for agent ${agentId}`
        );
        return c.json({
          success: true,
          message: `Disconnected from "${integration}" (account: ${accountId}).`,
        });
      } catch (error) {
        logger.error("Failed to disconnect integration", { error });
        return c.json({ error: "Failed to disconnect" }, 500);
      }
    }
  );

  logger.info("Integration routes registered");
  return router;
}
