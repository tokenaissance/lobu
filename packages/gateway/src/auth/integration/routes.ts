import type {
  AgentIntegrationConfig,
  IntegrationAccountInfo,
  IntegrationCredentialRecord,
  IntegrationInfo,
} from "@lobu/core";
import { createLogger, verifyWorkerToken } from "@lobu/core";
import { Hono } from "hono";
import type { InteractionService } from "../../interactions";
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

  // Worker authentication middleware
  const authenticateWorker = async (c: any, next: () => Promise<void>) => {
    const authHeader = c.req.header("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return c.json({ error: "Missing or invalid authorization" }, 401);
    }
    const workerToken = authHeader.substring(7);
    const tokenData = verifyWorkerToken(workerToken);
    if (!tokenData) {
      return c.json({ error: "Invalid worker token" }, 401);
    }
    c.set("worker", tokenData);
    await next();
  };

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
        integrations.push({
          id,
          label: config.label,
          authType,
          connected: accounts.length > 0,
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
              error: `Integration "${integration}" uses API key auth. Use GetSettingsLink to configure it.`,
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
          const allGranted = requestedScopes.every((s: string) =>
            existing.grantedScopes.includes(s)
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
            platform: worker.platform || "slack",
          }
        );
        const oauthUrl = `${publicGatewayUrl}/api/v1/auth/integration/init/${integration}?token=${encodeURIComponent(token)}`;

        // Send login link to user via InteractionService
        if (interactionService) {
          const platform = worker.platform || "slack";
          await interactionService.postLinkButton(
            worker.userId,
            worker.conversationId,
            worker.channelId,
            worker.teamId,
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

        // Fallback: no interaction service. Never return the raw OAuth URL
        // to the worker — it would be visible to the agent (security risk).
        logger.warn(
          "No interactionService available — OAuth link generated but cannot be delivered",
          { integration, agentId: worker.agentId }
        );
        return c.json({
          status: "login_required",
          message: `A login link for "${config.label}" has been sent to the user. Session will end now.`,
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

  /**
   * POST /internal/integrations/create
   * Body: { id, label, apiKey: { headerName, headerTemplate }, apiDomains, key? }
   * Creates an agent-scoped API key integration. Key is optional — if omitted,
   * the integration is saved but not connected (user enters key on settings page).
   */
  router.post(
    "/internal/integrations/create",
    authenticateWorker,
    async (c) => {
      const worker = c.get("worker");
      const agentId = worker.agentId;

      if (!agentId) {
        return c.json({ error: "Missing agentId in worker token" }, 400);
      }

      if (!agentSettingsStore) {
        return c.json({ error: "Agent settings store not configured" }, 500);
      }

      try {
        const body = await c.req.json();
        const { id, label, apiKey, apiDomains, key } = body;

        if (!id || !label || !apiDomains?.length) {
          return c.json(
            { error: "Missing required fields: id, label, apiDomains" },
            400
          );
        }

        const headerName = apiKey?.headerName || "Authorization";
        const headerTemplate = apiKey?.headerTemplate || "Bearer {{key}}";

        // Save config to agent settings
        const agentIntegration: AgentIntegrationConfig = {
          label,
          authType: "api-key",
          apiKey: { headerName, headerTemplate },
          apiDomains,
        };

        const settings = await agentSettingsStore.getSettings(agentId);
        const existingIntegrations = settings?.agentIntegrations || {};
        await agentSettingsStore.updateSettings(agentId, {
          agentIntegrations: {
            ...existingIntegrations,
            [id]: agentIntegration,
          },
        });

        // Store the API key as a credential (only if key provided)
        if (key) {
          const credential: IntegrationCredentialRecord = {
            accessToken: key,
            tokenType: "api-key",
            grantedScopes: [],
          };
          await credentialStore.setCredentials(agentId, id, credential);
        }

        const connected = !!key;
        logger.info(
          `Created API key integration "${id}" for agent ${agentId} (connected: ${connected})`
        );
        return c.json({
          success: true,
          connected,
          message: connected
            ? `Integration "${label}" created and connected. You can now use CallService with integration="${id}".`
            : `Integration "${label}" configured. User needs to enter their API key on the settings page to activate it.`,
        });
      } catch (error) {
        logger.error("Failed to create integration", { error });
        return c.json({ error: "Failed to create integration" }, 500);
      }
    }
  );

  logger.info("Integration routes registered");
  return router;
}
