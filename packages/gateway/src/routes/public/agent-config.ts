/**
 * Agent Config Routes
 *
 * Configuration endpoints mounted under /api/v1/agents/{agentId}/config
 */

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { createLogger } from "@lobu/core";
import type { ProviderCatalogService } from "../../auth/provider-catalog";
import type { ProviderStatus } from "../../auth/provider-status";
import type { AgentSettings, AgentSettingsStore } from "../../auth/settings";
import { verifySettingsToken } from "../../auth/settings/token-service";
import type { IMessageQueue } from "../../infrastructure/queue";
import type { GitHubAppAuth } from "../../modules/git-filesystem/github-app";
import { collectModelValues } from "../../auth/provider-model-options";

const TAG = "Agents";
const ErrorResponse = z.object({ error: z.string() });
const TokenQuery = z.object({ token: z.string() });
const logger = createLogger("agent-config-routes");

// --- Route Definitions ---

const getConfigRoute = createRoute({
  method: "get",
  path: "/",
  tags: [TAG],
  summary: "Get agent configuration",
  request: { query: TokenQuery },
  responses: {
    200: {
      description: "Configuration",
      content: {
        "application/json": {
          schema: z.object({
            agentId: z.string(),
            settings: z.any(),
            providers: z.record(
              z.string(),
              z.object({
                connected: z.boolean(),
                userConnected: z.boolean(),
                systemConnected: z.boolean(),
              })
            ),
            github: z.object({
              configured: z.boolean(),
              installUrl: z.string().nullable(),
              installations: z.array(
                z.object({
                  id: z.number(),
                  account: z.string(),
                  accountType: z.string(),
                  avatarUrl: z.string(),
                })
              ),
              user: z
                .object({
                  login: z.string(),
                  id: z.number(),
                  avatarUrl: z.string(),
                })
                .nullable(),
            }),
          }),
        },
      },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: ErrorResponse } },
    },
  },
});

const updateConfigRoute = createRoute({
  method: "patch",
  path: "/",
  tags: [TAG],
  summary: "Update agent configuration",
  request: {
    query: TokenQuery,
    body: {
      content: {
        "application/json": {
          schema: z.object({
            model: z.string().optional(),
            soulMd: z.string().optional(),
            userMd: z.string().optional(),
            identityMd: z.string().optional(),
            networkConfig: z
              .object({
                allowedDomains: z.array(z.string()).optional(),
                deniedDomains: z.array(z.string()).optional(),
              })
              .optional(),
            gitConfig: z
              .object({
                repoUrl: z.string().optional(),
                branch: z.string().optional(),
                sparse: z.array(z.string()).optional(),
              })
              .nullable()
              .optional(),
            nixConfig: z
              .object({
                flakeUrl: z.string().optional(),
                packages: z.array(z.string()).optional(),
              })
              .nullable()
              .optional(),
            mcpServers: z.record(z.string(), z.any()).optional(),
            envVars: z.record(z.string(), z.string()).optional(),
            skillsConfig: z
              .object({
                skills: z.array(
                  z.object({
                    repo: z.string(),
                    name: z.string(),
                    description: z.string(),
                    enabled: z.boolean(),
                    content: z.string().optional(),
                    contentFetchedAt: z.number().optional(),
                  })
                ),
              })
              .optional(),
            pluginsConfig: z
              .object({
                plugins: z.array(
                  z.object({
                    source: z.string(),
                    slot: z.enum(["tool", "provider"]),
                    enabled: z.boolean().optional(),
                  })
                ),
              })
              .optional(),
            verboseLogging: z.boolean().optional(),
            githubUser: z
              .null()
              .optional()
              .openapi({ description: "Set to null to disconnect GitHub" }),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Updated",
      content: {
        "application/json": {
          schema: z.object({ success: z.boolean(), agentId: z.string() }),
        },
      },
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

export interface ProviderCredentialStore {
  hasCredentials(agentId: string): Promise<boolean>;
}

export interface AgentConfigRoutesConfig {
  agentSettingsStore: AgentSettingsStore;
  providerStores?: Record<string, ProviderCredentialStore>;
  /**
   * Provider connectivity overrides (e.g., system token means "connected" even if no user credentials are stored).
   */
  providerConnectedOverrides?: Record<string, boolean>;
  providerCatalogService?: ProviderCatalogService;
  githubAuth?: GitHubAppAuth;
  githubAppInstallUrl?: string;
  githubOAuthClientId?: string;
  queue?: IMessageQueue;
}

export function createAgentConfigRoutes(
  config: AgentConfigRoutesConfig
): OpenAPIHono {
  const app = new OpenAPIHono();

  const verifyToken = (token: string | undefined, agentId: string) => {
    if (!token) return null;
    const payload = verifySettingsToken(token);
    // Validate agentId matches token
    if (payload && payload.agentId !== agentId) return null;
    return payload;
  };

  app.openapi(getConfigRoute, async (c): Promise<any> => {
    const agentId = c.req.param("agentId") || "";
    const payload = verifyToken(c.req.valid("query").token, agentId);
    if (!payload) return c.json({ error: "Unauthorized" }, 401);

    const settings = await config.agentSettingsStore.getSettings(agentId);

    // Provider status
    const providers: Record<string, ProviderStatus> = {};
    if (config.providerStores) {
      for (const [name, store] of Object.entries(config.providerStores)) {
        try {
          const hasSystemCredentials =
            config.providerConnectedOverrides?.[name] === true;
          const hasUserCredentials = await store.hasCredentials(agentId);
          providers[name] = {
            connected: hasUserCredentials || hasSystemCredentials,
            userConnected: hasUserCredentials,
            systemConnected: hasSystemCredentials,
          };
        } catch {
          providers[name] = {
            connected: false,
            userConnected: false,
            systemConnected: false,
          };
        }
      }
    }

    // GitHub status
    const github = {
      configured: !!config.githubAuth,
      installUrl: config.githubAppInstallUrl || null,
      installations: [] as any[],
      user: null as any,
    };

    const githubUser = (settings as any)?.githubUser;
    if (githubUser) {
      github.user = {
        login: githubUser.login,
        id: githubUser.id,
        avatarUrl: githubUser.avatarUrl,
      };
    }

    if (config.githubAuth) {
      if (githubUser?.accessToken) {
        const resp = await fetch("https://api.github.com/user/installations", {
          headers: {
            Authorization: `Bearer ${githubUser.accessToken}`,
            Accept: "application/vnd.github+json",
            "User-Agent": "Lobu",
          },
        });
        if (resp.ok) {
          const data = (await resp.json()) as {
            installations: Array<{
              id: number;
              account: { login: string; type: string; avatar_url: string };
            }>;
          };
          github.installations = data.installations.map((i) => ({
            id: i.id,
            account: i.account.login,
            accountType: i.account.type,
            avatarUrl: i.account.avatar_url,
          }));
        }
      } else {
        const installations = await config.githubAuth.listInstallations();
        github.installations = installations.map((i) => ({
          id: i.id,
          account: i.account.login,
          accountType: i.account.type,
          avatarUrl: i.account.avatar_url,
        }));
      }
    }

    return c.json({
      agentId,
      settings: settings || {},
      providers,
      github,
    });
  });

  app.openapi(updateConfigRoute, async (c): Promise<any> => {
    const agentId = c.req.param("agentId") || "";
    const payload = verifyToken(c.req.valid("query").token, agentId);
    if (!payload) return c.json({ error: "Unauthorized" }, 401);

    try {
      const existingSettings =
        await config.agentSettingsStore.getSettings(agentId);
      const availableModels = await collectModelValues(agentId, payload.userId);
      const body = c.req.valid("json");

      const updates: Partial<AgentSettings> = {};

      // Handle explicit null for githubUser (disconnect)
      if (body.githubUser === null) {
        updates.githubUser = undefined;
        delete body.githubUser;
      }

      // Handle explicit null for gitConfig (clear)
      if (body.gitConfig === null) {
        updates.gitConfig = undefined;
        delete body.gitConfig;
      }

      // Handle explicit null for nixConfig (clear)
      if (body.nixConfig === null) {
        updates.nixConfig = undefined;
        delete body.nixConfig;
      }

      if (Object.keys(body).length > 0) {
        const validated = await validateSettings(
          body as Partial<AgentSettings>,
          availableModels
        );
        Object.assign(updates, validated);
      }

      if (Object.keys(updates).length > 0) {
        await config.agentSettingsStore.updateSettings(agentId, updates);
      }

      if (body.mcpServers && config.queue && payload.sourceContext) {
        await maybeSendMcpInstalledNotifications({
          queue: config.queue,
          agentSettingsStore: config.agentSettingsStore,
          agentId,
          userId: payload.userId,
          platform: payload.sourceContext.platform || payload.platform,
          channelId: payload.sourceContext.channelId,
          conversationId: payload.sourceContext.conversationId,
          teamId: payload.sourceContext.teamId,
          previousSettings: existingSettings,
          nextMcpServers: updates.mcpServers || existingSettings?.mcpServers,
        });
      }

      return c.json({ success: true, agentId });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "Invalid" }, 400);
    }
  });

  // --- Provider Catalog Endpoints ---

  // GET /providers/catalog
  app.get("/providers/catalog", async (c): Promise<any> => {
    const agentId = c.req.param("agentId") || "";
    const token = c.req.query("token");
    const payload = verifyToken(token, agentId);
    if (!payload) return c.json({ error: "Unauthorized" }, 401);

    if (!config.providerCatalogService) {
      return c.json({ error: "Provider catalog not available" }, 503);
    }

    const allProviders = config.providerCatalogService.listCatalogProviders();
    const installed =
      await config.providerCatalogService.getInstalledProviders(agentId);
    const installedIds = new Set(installed.map((ip) => ip.providerId));

    const catalog = allProviders.map((p) => ({
      providerId: p.providerId,
      name: p.providerDisplayName,
      iconUrl: p.providerIconUrl || "",
      authType: p.authType || "api-key",
      description: p.catalogDescription || "",
      installed: installedIds.has(p.providerId),
    }));

    return c.json({ catalog, installedProviders: installed });
  });

  // POST /providers/install
  app.post("/providers/install", async (c): Promise<any> => {
    const agentId = c.req.param("agentId") || "";
    const token = c.req.query("token");
    const payload = verifyToken(token, agentId);
    if (!payload) return c.json({ error: "Unauthorized" }, 401);

    if (!config.providerCatalogService) {
      return c.json({ error: "Provider catalog not available" }, 503);
    }

    try {
      const body = await c.req.json();
      const { providerId, config: providerConfig } = body;
      if (!providerId || typeof providerId !== "string") {
        return c.json({ error: "providerId is required" }, 400);
      }

      await config.providerCatalogService.installProvider(
        agentId,
        providerId.trim(),
        providerConfig
      );
      return c.json({ success: true, agentId });
    } catch (e) {
      return c.json(
        { error: e instanceof Error ? e.message : "Install failed" },
        400
      );
    }
  });

  // POST /providers/uninstall
  app.post("/providers/uninstall", async (c): Promise<any> => {
    const agentId = c.req.param("agentId") || "";
    const token = c.req.query("token");
    const payload = verifyToken(token, agentId);
    if (!payload) return c.json({ error: "Unauthorized" }, 401);

    if (!config.providerCatalogService) {
      return c.json({ error: "Provider catalog not available" }, 503);
    }

    try {
      const body = await c.req.json();
      const { providerId } = body;
      if (!providerId || typeof providerId !== "string") {
        return c.json({ error: "providerId is required" }, 400);
      }

      await config.providerCatalogService.uninstallProvider(
        agentId,
        providerId.trim()
      );
      return c.json({ success: true, agentId });
    } catch (e) {
      return c.json(
        { error: e instanceof Error ? e.message : "Uninstall failed" },
        400
      );
    }
  });

  // PATCH /providers/reorder
  app.patch("/providers/reorder", async (c): Promise<any> => {
    const agentId = c.req.param("agentId") || "";
    const token = c.req.query("token");
    const payload = verifyToken(token, agentId);
    if (!payload) return c.json({ error: "Unauthorized" }, 401);

    if (!config.providerCatalogService) {
      return c.json({ error: "Provider catalog not available" }, 503);
    }

    try {
      const body = await c.req.json();
      const { providerIds } = body;
      if (!Array.isArray(providerIds)) {
        return c.json({ error: "providerIds array is required" }, 400);
      }

      await config.providerCatalogService.reorderProviders(
        agentId,
        providerIds.filter((id): id is string => typeof id === "string")
      );
      return c.json({ success: true, agentId });
    } catch (e) {
      return c.json(
        { error: e instanceof Error ? e.message : "Reorder failed" },
        400
      );
    }
  });

  return app;
}

// --- Validation ---

async function validateSettings(
  input: Partial<AgentSettings>,
  availableModels: Set<string>
): Promise<Omit<AgentSettings, "updatedAt">> {
  const settings: Omit<AgentSettings, "updatedAt"> = {};

  if (typeof input.soulMd === "string") {
    settings.soulMd = input.soulMd;
  }
  if (typeof input.userMd === "string") {
    settings.userMd = input.userMd;
  }
  if (typeof input.identityMd === "string") {
    settings.identityMd = input.identityMd;
  }

  if (typeof input.model === "string") {
    const cleanModel = input.model.trim();
    if (!cleanModel) {
      settings.model = undefined;
    } else {
      if (availableModels.size === 0) {
        throw new Error(
          "No models are currently available from configured providers."
        );
      }
      if (!availableModels.has(cleanModel)) {
        throw new Error(`Invalid model: ${cleanModel}`);
      }
      settings.model = cleanModel;
    }
  }

  if (input.networkConfig) {
    settings.networkConfig = {
      allowedDomains: input.networkConfig.allowedDomains
        ?.filter((d) => typeof d === "string" && d.trim())
        .map((d) => d.trim().toLowerCase()),
      deniedDomains: input.networkConfig.deniedDomains
        ?.filter((d) => typeof d === "string" && d.trim())
        .map((d) => d.trim().toLowerCase()),
    };
  }

  if (input.gitConfig) {
    const repoUrl = input.gitConfig.repoUrl?.trim();
    const branch = input.gitConfig.branch?.trim();
    const sparse = input.gitConfig.sparse
      ?.filter((p): p is string => typeof p === "string" && !!p.trim())
      .map((p) => p.trim());

    if (!repoUrl) {
      throw new Error("gitConfig.repoUrl is required when gitConfig is set");
    }
    if (!repoUrl.startsWith("https://") && !repoUrl.startsWith("git@")) {
      throw new Error("Repository URL must start with https:// or git@");
    }
    settings.gitConfig = {
      repoUrl,
      branch: branch || undefined,
      sparse: sparse?.length ? sparse : undefined,
    };
  }

  if (input.nixConfig) {
    const flakeUrl = input.nixConfig.flakeUrl?.trim();
    const packages = input.nixConfig.packages
      ?.filter((pkg): pkg is string => typeof pkg === "string" && !!pkg.trim())
      .map((pkg) => pkg.trim());

    if (!flakeUrl && (!packages || packages.length === 0)) {
      throw new Error(
        "nixConfig requires flakeUrl or at least one package when set"
      );
    }

    settings.nixConfig = {
      flakeUrl: flakeUrl || undefined,
      packages: packages?.length ? packages : undefined,
    };
  }

  if (input.mcpServers && typeof input.mcpServers === "object") {
    settings.mcpServers = {};
    for (const [id, config] of Object.entries(input.mcpServers)) {
      // Validate MCP ID format (alphanumeric, dash, underscore, starting with letter)
      const cleanId = id.trim();
      if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(cleanId)) {
        throw new Error(`Invalid MCP ID: ${cleanId}`);
      }

      // Skip if config is not an object
      if (typeof config !== "object" || config === null) continue;

      const mcpConfig: Record<string, unknown> = {};
      const cfg = config as Record<string, unknown>;

      // Validate URL for HTTP MCPs
      if (typeof cfg.url === "string") {
        const url = cfg.url.trim();
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
          throw new Error(
            `Invalid MCP URL for ${cleanId}: must be http:// or https://`
          );
        }
        mcpConfig.url = url;
      }

      // Handle command-based MCPs
      if (typeof cfg.command === "string") {
        mcpConfig.command = cfg.command;
        if (Array.isArray(cfg.args)) {
          mcpConfig.args = cfg.args.filter((a) => typeof a === "string");
        }
      }

      // Optional fields
      if (typeof cfg.description === "string") {
        mcpConfig.description = cfg.description;
      }
      if (typeof cfg.enabled === "boolean") {
        mcpConfig.enabled = cfg.enabled;
      }

      // Copy through any other config fields (oauth, headers, etc.)
      for (const [key, value] of Object.entries(cfg)) {
        if (
          !["url", "command", "args", "description", "enabled"].includes(key)
        ) {
          mcpConfig[key] = value;
        }
      }

      settings.mcpServers[cleanId] = mcpConfig;
    }
  }

  if (input.envVars && typeof input.envVars === "object") {
    settings.envVars = {};
    for (const [key, value] of Object.entries(input.envVars)) {
      const cleanKey = key.trim();
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(cleanKey)) {
        settings.envVars[cleanKey] = String(value);
      }
    }
  }

  if (input.skillsConfig) {
    settings.skillsConfig = input.skillsConfig;
  }

  if (input.pluginsConfig) {
    settings.pluginsConfig = {
      plugins: input.pluginsConfig.plugins
        .filter((p) => typeof p.source === "string" && p.source.trim())
        .map((p) => ({
          source: p.source.trim(),
          slot: p.slot,
          enabled: p.enabled ?? true,
        })),
    };
  }

  if (typeof input.verboseLogging === "boolean") {
    settings.verboseLogging = input.verboseLogging;
  }

  return settings;
}

function getEnabledHttpMcpIds(
  mcpServers: AgentSettings["mcpServers"] | undefined
): Set<string> {
  const ids = new Set<string>();
  for (const [id, config] of Object.entries(mcpServers || {})) {
    if (!config || typeof config !== "object") continue;
    const cfg = config as Record<string, unknown>;
    if (cfg.enabled === false) continue;
    if (typeof cfg.url !== "string") continue;
    const url = cfg.url.trim();
    if (!url.startsWith("http://") && !url.startsWith("https://")) continue;
    ids.add(id);
  }
  return ids;
}

async function maybeSendMcpInstalledNotifications(options: {
  queue: IMessageQueue;
  agentSettingsStore: AgentSettingsStore;
  agentId: string;
  userId: string;
  platform: string;
  channelId: string;
  conversationId: string;
  teamId?: string;
  previousSettings: AgentSettings | null;
  nextMcpServers: AgentSettings["mcpServers"] | undefined;
}): Promise<void> {
  const {
    queue,
    agentSettingsStore,
    agentId,
    userId,
    platform,
    channelId,
    conversationId,
    teamId,
    previousSettings,
    nextMcpServers,
  } = options;

  const previousMcpIds = getEnabledHttpMcpIds(previousSettings?.mcpServers);
  const previousNotified = { ...(previousSettings?.mcpInstallNotified || {}) };
  const currentMcpIds = getEnabledHttpMcpIds(nextMcpServers);

  const candidatesToNotify = Array.from(currentMcpIds).filter(
    (mcpId) => !previousMcpIds.has(mcpId) && !previousNotified[mcpId]
  );

  if (candidatesToNotify.length === 0) return;

  await queue.createQueue("thread_response");

  const notifiedUpdates: Record<string, number> = { ...previousNotified };
  for (const mcpId of candidatesToNotify) {
    const messageId = `mcp-installed:${agentId}:${mcpId}:${Date.now()}`;
    try {
      await queue.send("thread_response", {
        messageId,
        channelId,
        conversationId,
        userId,
        teamId: teamId || "no-team",
        platform,
        content: `MCP "${mcpId}" is installed and ready. You can use it in this chat on your next message.`,
        timestamp: Date.now(),
        ephemeral: true,
      });
      notifiedUpdates[mcpId] = Date.now();
      logger.info("Sent MCP installed notification", {
        agentId,
        mcpId,
        channelId,
        conversationId,
      });
    } catch (error) {
      logger.warn("Failed to send MCP installed notification", {
        agentId,
        mcpId,
        error,
      });
    }
  }

  const changed =
    Object.keys(notifiedUpdates).length !==
    Object.keys(previousNotified).length;
  if (changed) {
    await agentSettingsStore.updateSettings(agentId, {
      mcpInstallNotified: notifiedUpdates,
    });
  }
}
