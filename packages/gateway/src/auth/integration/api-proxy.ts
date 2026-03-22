import type {
  IntegrationConfig,
  IntegrationCredentialRecord,
} from "@lobu/core";
import { createLogger } from "@lobu/core";
import { Hono } from "hono";
import { authenticateWorker } from "../../routes/internal/worker-auth";
import { GenericOAuth2Client } from "../oauth/generic-client";
import type { IntegrationConfigService } from "./config-service";
import type { IntegrationCredentialStore } from "./credential-store";

const logger = createLogger("integration-api-proxy");

/**
 * API proxy for integration requests.
 * Worker sends: POST /internal/integrations/:id/api
 * Gateway injects credentials and forwards to the actual API.
 */
export function createIntegrationApiProxy(
  configService: IntegrationConfigService,
  credentialStore: IntegrationCredentialStore
): Hono {
  const router = new Hono();
  const oauth2Client = new GenericOAuth2Client();

  /**
   * POST /internal/integrations/:id/api
   * Body: { method, url, headers?, body? }
   * Gateway validates domain, injects Bearer token, forwards request.
   */
  router.post(
    "/internal/integrations/:id/api",
    authenticateWorker,
    async (c) => {
      const integrationId = c.req.param("id");
      const worker = c.get("worker");
      const agentId = worker.agentId;

      if (!agentId) {
        return c.json({ error: "Missing agentId in worker token" }, 400);
      }

      try {
        const config = await configService.getIntegration(
          integrationId,
          agentId
        );
        if (!config) {
          return c.json({ error: "Integration not found" }, 404);
        }

        const body = await c.req.json();
        const {
          method,
          url,
          headers: reqHeaders,
          body: reqBody,
          account,
        } = body;
        const accountId: string = account || "default";

        if (!method || !url) {
          return c.json({ error: "Missing method or url" }, 400);
        }

        // Validate URL domain against configured apiDomains
        const parsedUrl = new URL(url);
        const isAllowed = config.apiDomains.some((domain) => {
          if (domain.startsWith(".")) {
            return parsedUrl.hostname.endsWith(domain);
          }
          return parsedUrl.hostname === domain;
        });

        if (!isAllowed) {
          return c.json(
            {
              error: `Domain ${parsedUrl.hostname} is not allowed for integration "${integrationId}". Allowed: ${config.apiDomains.join(", ")}`,
            },
            403
          );
        }

        // Fetch credentials for the specific account
        let credentials = await credentialStore.getCredentials(
          agentId,
          integrationId,
          accountId
        );
        if (!credentials) {
          return c.json(
            {
              error: `Not connected to "${integrationId}". Use ConnectService to connect first.`,
            },
            401
          );
        }

        // Auto-refresh if expired (only for OAuth integrations)
        const authType = config.authType || "oauth";
        if (
          authType === "oauth" &&
          credentials.expiresAt &&
          Date.now() > credentials.expiresAt
        ) {
          credentials = await refreshCredentials(
            oauth2Client,
            credentialStore,
            config,
            credentials,
            agentId,
            integrationId,
            accountId
          );
          if (!credentials) {
            return c.json(
              {
                error: `Token expired and refresh failed for "${integrationId}". Use ConnectService to re-authenticate.`,
              },
              401
            );
          }
        }

        // Forward request with injected auth
        let response = await forwardRequest(
          method,
          url,
          reqHeaders,
          reqBody,
          credentials,
          config
        );

        // If 401, try refresh once and retry (only for OAuth)
        if (
          response.status === 401 &&
          authType === "oauth" &&
          credentials.refreshToken
        ) {
          const refreshed = await refreshCredentials(
            oauth2Client,
            credentialStore,
            config,
            credentials,
            agentId,
            integrationId,
            accountId
          );
          if (refreshed) {
            credentials = refreshed;
            response = await forwardRequest(
              method,
              url,
              reqHeaders,
              reqBody,
              credentials,
              config
            );
          }
        }

        // Return response to worker
        const responseBody = await response.text();
        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          responseHeaders[key] = value;
        });

        return c.json({
          status: response.status,
          headers: responseHeaders,
          body: responseBody,
        });
      } catch (error) {
        logger.error("Integration API proxy error", { error, integrationId });
        return c.json(
          {
            error: `API call failed: ${error instanceof Error ? error.message : String(error)}`,
          },
          500
        );
      }
    }
  );

  return router;
}

async function forwardRequest(
  method: string,
  url: string,
  headers: Record<string, string> | undefined,
  body: string | undefined,
  credentials: IntegrationCredentialRecord,
  config: IntegrationConfig
): Promise<Response> {
  const finalHeaders: Record<string, string> = { ...headers };
  const authType = config.authType || "oauth";

  if (authType === "api-key" && config.apiKey) {
    const headerValue = config.apiKey.headerTemplate.replace(
      "{{key}}",
      credentials.accessToken
    );
    finalHeaders[config.apiKey.headerName] = headerValue;
  } else {
    finalHeaders.Authorization = `${credentials.tokenType || "Bearer"} ${credentials.accessToken}`;
  }

  return fetch(url, {
    method,
    headers: finalHeaders,
    body: method !== "GET" && method !== "HEAD" ? body : undefined,
  });
}

async function refreshCredentials(
  oauth2Client: GenericOAuth2Client,
  credentialStore: IntegrationCredentialStore,
  config: {
    oauth?: {
      tokenUrl: string;
      clientId?: string;
      clientSecret?: string;
      tokenEndpointAuthMethod?: string;
    };
  },
  credentials: IntegrationCredentialRecord,
  agentId: string,
  integrationId: string,
  accountId = "default"
): Promise<IntegrationCredentialRecord | null> {
  if (!credentials.refreshToken || !config.oauth) return null;

  try {
    const refreshed = await oauth2Client.refreshToken(
      credentials.refreshToken,
      {
        authUrl: config.oauth.tokenUrl, // not used for refresh, but required by interface
        tokenUrl: config.oauth.tokenUrl,
        clientId: config.oauth.clientId || "",
        clientSecret: config.oauth.clientSecret || "",
        tokenEndpointAuthMethod: config.oauth.tokenEndpointAuthMethod,
      }
    );

    // Parse scopes from refreshed token
    const scopeString = (refreshed.metadata?.scope as string) || "";
    const refreshedScopes = scopeString
      ? scopeString.split(/[\s,]+/).filter(Boolean)
      : credentials.grantedScopes;

    const updated: IntegrationCredentialRecord = {
      accessToken: refreshed.accessToken,
      tokenType: refreshed.tokenType || "Bearer",
      expiresAt: refreshed.expiresAt,
      refreshToken: refreshed.refreshToken || credentials.refreshToken,
      grantedScopes: refreshedScopes,
      metadata: {
        ...credentials.metadata,
        refreshedAt: new Date().toISOString(),
      },
    };

    await credentialStore.setCredentials(
      agentId,
      integrationId,
      updated,
      accountId
    );
    logger.info(
      `Refreshed credentials for agent ${agentId}, integration ${integrationId}, account ${accountId}`
    );
    return updated;
  } catch (error) {
    logger.error("Failed to refresh integration credentials", {
      error,
      integrationId,
    });
    return null;
  }
}
