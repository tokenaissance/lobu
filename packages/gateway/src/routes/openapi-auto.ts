import type { OpenAPIHono, RouteConfig } from "@hono/zod-openapi";
import { z } from "@hono/zod-openapi";

type OpenApiDefinition =
  | { type: "route"; route: { method: string; path: string } }
  | { type: string; route?: { method: string; path: string } };

// Internal route prefixes - worker-facing, excluded from public docs
const INTERNAL_PREFIXES = ["/api/proxy", "/internal", "/worker", "/mcp"];

// Routes excluded from docs entirely: HTML pages, OAuth redirects/callbacks,
// platform webhooks, system probes, and infra endpoints
const EXCLUDED_ROUTES = [
  "/", // Landing page
  "/agent", // HTML agent page
  "/api/v1/auth/{provider}/login", // OAuth redirect (browser-only)
  "/agent/{agentId}/history", // HTML history page
  "/slack/install", // Slack app install
  "/slack/oauth_callback", // Slack OAuth callback
];

const EXCLUDED_PREFIXES = [
  "/health", // K8s liveness probe
  "/ready", // K8s readiness probe
  "/metrics", // Prometheus scraping
  "/api/telegram", // Telegram webhook
  "/api/v1/webhooks", // Chat SDK connection webhooks
  "/slack/", // Slack events
  "/agent/oauth", // Agent OAuth flow
];

function isInternalRoute(path: string): boolean {
  return INTERNAL_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function isExcludedRoute(path: string): boolean {
  if (EXCLUDED_ROUTES.includes(path)) return true;
  return EXCLUDED_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function normalizePath(path: string): string {
  let normalized = path.replace(/:([A-Za-z0-9_]+)(?:\{[^}]+\})?/g, "{$1}");
  normalized = normalized.replace(/\/\*/g, "/{wildcard}");
  normalized = normalized.replace(/\*/g, "{wildcard}");
  // Collapse double slashes from sub-router mounting (e.g. app.route("", router))
  normalized = normalized.replace(/\/\/+/g, "/");
  return normalized;
}

function extractPathParams(path: string): string[] {
  const params: string[] = [];
  for (const match of path.matchAll(/\{([^}]+)\}/g)) {
    if (match[1]) {
      params.push(match[1]);
    }
  }
  return params;
}

/**
 * Derive an API documentation tag from the route path.
 */
function deriveTag(path: string): string {
  // Messages — sending and streaming
  if (
    path === "/api/v1/messaging/send" ||
    path.includes("/messages") ||
    path.includes("/events") ||
    path.includes("/interactions")
  ) {
    return "Messages";
  }

  // Agents — CRUD and status
  if (
    path.startsWith("/api/v1/agents") &&
    !path.includes("/config") &&
    !path.includes("/channels") &&
    !path.includes("/history") &&
    !path.includes("/schedules")
  ) {
    return "Agents";
  }

  // Configuration — providers, packages, domain grants
  if (path.includes("/config")) {
    return "Configuration";
  }

  // Channels — platform bindings
  if (path.includes("/channels")) {
    return "Channels";
  }

  // Schedules — wakeups and reminders
  if (path.includes("/schedules")) {
    return "Schedules";
  }

  // History — session messages and stats
  if (path.includes("/history")) {
    return "History";
  }

  // Auth — API keys, OAuth, device code
  if (path.startsWith("/api/v1/auth/")) {
    return "Auth";
  }

  // Integrations — skills and MCP servers
  if (path.startsWith("/api/v1/integrations")) {
    return "Integrations";
  }

  // Session — agent page bootstrap
  if (path.startsWith("/agent")) {
    return "Session";
  }

  return "Other";
}

/**
 * Human-readable summaries for auto-registered routes.
 * Key format: "method /path" (lowercase method, normalized path).
 */
const ROUTE_SUMMARIES: Record<string, string> = {
  // Session
  "post /agent/session": "Establish agent session",

  // Agents
  "post /api/v1/agents": "Create agent",
  "get /api/v1/agents": "List user agents",
  "patch /api/v1/agents/{agentId}": "Update agent metadata",
  "delete /api/v1/agents/{agentId}": "Delete agent",

  // Configuration
  "get /api/v1/agents/{agentId}/config/packages/search": "Search Nix packages",
  "get /api/v1/agents/{agentId}/config/providers/catalog":
    "List provider catalog",
  "put /api/v1/agents/{agentId}/config/providers/{providerId}":
    "Install or uninstall provider",
  "patch /api/v1/agents/{agentId}/config/providers/reorder":
    "Reorder providers",
  "get /api/v1/agents/{agentId}/config/grants": "List domain grants",
  "post /api/v1/agents/{agentId}/config/grants": "Add domain grant",
  "delete /api/v1/agents/{agentId}/config/grants/{pattern}":
    "Revoke domain grant",

  // History
  "get /api/v1/agents/{agentId}/history/status": "Get agent connection status",
  "get /api/v1/agents/{agentId}/history/session/messages":
    "Get session messages",
  "get /api/v1/agents/{agentId}/history/session/stats": "Get session stats",

  // Channels
  "get /api/v1/agents/{agentId}/channels": "List channel bindings",
  "post /api/v1/agents/{agentId}/channels": "Bind agent to channel",
  "delete /api/v1/agents/{agentId}/channels/{platform}/{channelId}":
    "Unbind agent from channel",

  // Auth
  "post /api/v1/auth/{provider}/save-key": "Save API key",
  "post /api/v1/auth/{provider}/start": "Start device code flow",
  "post /api/v1/auth/{provider}/poll": "Poll device code status",
  "post /api/v1/auth/{provider}/logout": "Disconnect provider",
};

/**
 * Register OpenAPI paths for routes not already defined via app.openapi.
 * Internal routes (worker-facing), webhooks, system probes, and OAuth callbacks
 * are excluded from the public docs.
 */
export function registerAutoOpenApiRoutes(app: OpenAPIHono): void {
  const registered = new Set<string>();
  const definitions = app.openAPIRegistry
    .definitions as unknown as OpenApiDefinition[];

  // Collect all Hono route paths for matching against OpenAPI relative paths
  const honoRoutePaths = new Set<string>();
  for (const route of app.routes) {
    if (route.method.toLowerCase() !== "all") {
      honoRoutePaths.add(normalizePath(route.path));
    }
  }

  for (const def of definitions) {
    if (def.type === "route" && def.route) {
      // Normalize the definition path in-place to fix double-slash artifacts
      def.route.path = normalizePath(def.route.path);
      const method = def.route.method.toLowerCase();
      const defPath = def.route.path;
      registered.add(`${method} ${defPath}`);

      // Sub-routers register OpenAPI defs with relative paths (e.g., "/{provider}/code").
      // Match these against Hono's full mounted paths to prevent duplicate stubs.
      if (!defPath.startsWith("/api/")) {
        for (const fullPath of honoRoutePaths) {
          if (fullPath.endsWith(defPath)) {
            registered.add(`${method} ${fullPath}`);
          }
        }
      }
    }
  }

  for (const route of app.routes) {
    const method = route.method.toLowerCase();
    if (method === "all") {
      continue;
    }

    const path = normalizePath(route.path);
    const key = `${method} ${path}`;

    if (registered.has(key)) {
      continue;
    }

    // Skip internal routes - they shouldn't be in public docs
    if (isInternalRoute(path)) {
      continue;
    }

    // Skip excluded routes (HTML pages, OAuth callbacks, webhooks, probes)
    if (isExcludedRoute(path)) {
      continue;
    }

    const params = extractPathParams(path);
    const paramsSchema =
      params.length > 0
        ? z.object(
            Object.fromEntries(params.map((param) => [param, z.string()]))
          )
        : undefined;

    const routeConfig: RouteConfig = {
      method: method as RouteConfig["method"],
      path,
      tags: [deriveTag(path)],
      summary: ROUTE_SUMMARIES[key] || `${method.toUpperCase()} ${path}`,
      request: paramsSchema ? { params: paramsSchema } : undefined,
      responses: {
        200: { description: "OK" },
      },
    };

    app.openAPIRegistry.registerPath(routeConfig);
    registered.add(key);
  }
}
