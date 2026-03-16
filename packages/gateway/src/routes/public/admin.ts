/**
 * Admin Page — system skills registry + connections management.
 * Preact SPA with server-injected state.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { OpenAPIHono } from "@hono/zod-openapi";
import { createLogger } from "@lobu/core";
import type { Context } from "hono";
import type { AgentMetadataStore } from "../../auth/agent-metadata-store";
import type { SettingsTokenPayload } from "../../auth/settings/token-service";
import type { SystemEnvStore } from "../../auth/system-env-store";
import type { UserAgentsStore } from "../../auth/user-agents-store";
import type { ChatInstanceManager } from "../../connections/chat-instance-manager";
import { getModelProviderModules } from "../../modules/module-system";
import type { SystemSkillsService } from "../../services/system-skills-service";
import {
  setSettingsSessionCookie,
  verifySettingsSession,
} from "./settings-auth";
import { settingsPageCSS } from "./settings-page-styles";

const logger = createLogger("admin-routes");

const _adminBundlePath = path.resolve(__dirname, "admin-page-bundle.raw.js");
function getAdminPageJS(): string {
  try {
    const content = fs.readFileSync(_adminBundlePath, "utf-8");
    return `/* ADMIN_BUNDLE_LOADED_AT_${Date.now()} */ ${content}`;
  } catch (e) {
    return `document.getElementById("app").textContent = "Bundle error: ${String(e).replace(/"/g, "'")}";`;
  }
}

function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─── Env Var Helpers ──────────────────────────────────────────────────────────

const ENV_REF_REGEX = /\$\{(?:env:)?([A-Z_][A-Z0-9_]*)\}/g;

/** Extract all ${env:KEY} references from an object tree */
function extractEnvRefs(obj: unknown): string[] {
  const refs = new Set<string>();
  const str = JSON.stringify(obj);
  for (const match of str.matchAll(ENV_REF_REGEX)) {
    if (match[1]) refs.add(match[1]);
  }
  return [...refs];
}

interface EnvVarEntry {
  key: string;
  /** Section this var belongs to: provider:<id>, integration:<id>, mcp:<name>, gateway */
  section: string;
  label: string;
  isSet: boolean;
  maskedValue: string | null;
}

function maskValue(value: string): string {
  if (value.length <= 4) return "****";
  return `${"*".repeat(4)}${value.slice(-4)}`;
}

/**
 * Build the env var catalog dynamically from registered providers,
 * system-skills integrations, MCP servers, and static gateway/connection vars.
 */
function buildEnvCatalog(
  skills: any[],
  redisOverrides: Record<string, string>
): { vars: EnvVarEntry[]; allowedKeys: Set<string> } {
  const vars: EnvVarEntry[] = [];
  const seen = new Set<string>();

  function addVar(key: string, section: string, label: string) {
    if (seen.has(key)) return;
    seen.add(key);
    const redisVal = redisOverrides[key];
    const processVal = process.env[key];
    const value = redisVal ?? processVal;
    vars.push({
      key,
      section,
      label,
      isSet: !!value,
      maskedValue: value ? maskValue(value) : null,
    });
  }

  // 1. LLM Providers — from module registry
  for (const mod of getModelProviderModules()) {
    if (mod.catalogVisible === false) continue;
    const envVars = mod.getSecretEnvVarNames?.() || [];
    for (const key of envVars) {
      addVar(key, `provider:${mod.providerId}`, mod.providerDisplayName);
    }
  }

  // 2. Integrations — extract ${env:*} from OAuth configs
  for (const skill of skills) {
    const raw = skill as any;
    if (!raw.integrations) continue;
    for (const ig of raw.integrations) {
      if (!ig.oauth) continue;
      const refs = extractEnvRefs(ig.oauth);
      for (const key of refs) {
        addVar(key, `integration:${ig.id}`, ig.label || ig.id);
      }
    }
  }

  // 3. MCP Servers — extract ${env:*} from server configs
  for (const skill of skills) {
    const raw = skill as any;
    if (!raw.mcpServers) continue;
    for (const srv of raw.mcpServers) {
      const refs = extractEnvRefs(srv);
      for (const key of refs) {
        addVar(key, `mcp:${srv.name || srv.id}`, srv.name || srv.id);
      }
    }
  }

  return { vars, allowedKeys: seen };
}

interface AdminPageConfig {
  systemSkillsService: SystemSkillsService;
  userAgentsStore: UserAgentsStore;
  agentMetadataStore: AgentMetadataStore;
  chatInstanceManager?: ChatInstanceManager;
  systemEnvStore?: SystemEnvStore;
  adminPassword: string;
  version?: string;
  githubUrl?: string;
}

function requireAdmin(c: Context): SettingsTokenPayload | null {
  const session = verifySettingsSession(c);
  if (!session || !session.isAdmin) return null;
  return session;
}

function verifyPassword(input: string, expected: string): boolean {
  const a = Buffer.from(input);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function createAdminPageRoutes(config: AdminPageConfig) {
  const app = new OpenAPIHono();

  // ─── Admin Login ───────────────────────────────────────────────────────────

  app.get("/agents/login", (c) => {
    const session = verifySettingsSession(c);
    if (session?.isAdmin) return c.redirect("/agents");
    const error = c.req.query("error");
    return c.html(renderAdminLoginPage(error || undefined));
  });

  app.post("/agents/login", async (c) => {
    const body = await c.req.parseBody();
    const password = typeof body.password === "string" ? body.password : "";

    if (!verifyPassword(password, config.adminPassword)) {
      return c.redirect("/agents/login?error=Invalid+password");
    }

    // Create or upgrade session with isAdmin
    let session = verifySettingsSession(c);
    if (session) {
      session = { ...session, isAdmin: true };
    } else {
      session = {
        userId: "admin",
        platform: "admin",
        exp: Date.now() + 24 * 60 * 60 * 1000,
        isAdmin: true,
      };
    }
    setSettingsSessionCookie(c, session);
    return c.redirect("/agents");
  });

  // ─── Admin State Builder ─────────────────────────────────────────────────

  async function buildAdminState() {
    const rawSkills =
      (await config.systemSkillsService.getSystemSkills()) || [];
    const providerConfigs =
      await config.systemSkillsService.getProviderConfigs();

    const systemSkillProviderIds = new Set<string>();
    const adminSkills: {
      id: string;
      name: string;
      description?: string;
      source: string;
      integrations: {
        id: string;
        label: string;
        authType: string;
        apiDomains: string[];
      }[];
      mcpServers: { name: string; type: string; url: string }[];
      providers: {
        providerId: string;
        displayName: string;
        defaultModel: string;
        sdkCompat: string;
      }[];
    }[] = [];

    for (const skill of rawSkills) {
      const raw = skill as any;
      const skillId = skill.repo.replace("system/", "");

      const skillIntegrations: (typeof adminSkills)[0]["integrations"] = [];
      if (raw.integrations) {
        for (const ig of raw.integrations) {
          skillIntegrations.push({
            id: ig.id,
            label: ig.label || ig.id,
            authType: ig.authType || "oauth",
            apiDomains: ig.apiDomains || [],
          });
        }
      }

      const skillMcpServers: (typeof adminSkills)[0]["mcpServers"] = [];
      const servers = raw.mcpServers || [];
      for (const srv of servers) {
        skillMcpServers.push({
          name: srv.name || srv.id,
          type: srv.type || "sse",
          url: srv.url || srv.command || "-",
        });
      }

      const skillProviders: (typeof adminSkills)[0]["providers"] = [];
      const providerEntry = providerConfigs[skillId];
      if (providerEntry) {
        systemSkillProviderIds.add(skillId);
        skillProviders.push({
          providerId: skillId,
          displayName: providerEntry.displayName,
          defaultModel: providerEntry.defaultModel || "-",
          sdkCompat: providerEntry.sdkCompat || "-",
        });
      }

      adminSkills.push({
        id: skillId,
        name: skill.name,
        description: raw.description,
        source: "lobu",
        integrations: skillIntegrations,
        mcpServers: skillMcpServers,
        providers: skillProviders,
      });
    }

    const builtInProviders: (typeof adminSkills)[0]["providers"] = [];
    for (const mod of getModelProviderModules()) {
      if (mod.catalogVisible === false) continue;
      if (systemSkillProviderIds.has(mod.providerId)) continue;
      builtInProviders.push({
        providerId: mod.providerId,
        displayName: mod.providerDisplayName,
        defaultModel: "-",
        sdkCompat: mod.authType || "-",
      });
    }
    if (builtInProviders.length > 0) {
      adminSkills.push({
        id: "__built-in__",
        name: "Built-in",
        source: "built-in",
        integrations: [],
        mcpServers: [],
        providers: builtInProviders,
      });
    }

    const allAgents = await config.agentMetadataStore.listAllAgents();

    // Enrich agents with connection counts and platforms
    const allConnections = config.chatInstanceManager
      ? await config.chatInstanceManager.listConnections()
      : [];
    const connectionsByAgent = new Map<
      string,
      { count: number; platforms: string[] }
    >();
    for (const conn of allConnections) {
      const agentId = (conn as any).templateAgentId;
      if (!agentId) continue;
      const entry = connectionsByAgent.get(agentId) || {
        count: 0,
        platforms: [],
      };
      entry.count++;
      if (!entry.platforms.includes(conn.platform)) {
        entry.platforms.push(conn.platform);
      }
      connectionsByAgent.set(agentId, entry);
    }

    const agents = allAgents.map((a) => {
      const connInfo = connectionsByAgent.get(a.agentId);
      return {
        agentId: a.agentId,
        name: a.name,
        description: a.description || "",
        owner: a.owner,
        parentConnectionId: a.parentConnectionId || null,
        createdAt: a.createdAt,
        lastUsedAt: a.lastUsedAt ?? null,
        connectionCount: connInfo?.count ?? 0,
        platforms: connInfo?.platforms ?? [],
      };
    });

    const plugins = [
      {
        source: "@lobu/owletto-openclaw",
        name: "Owletto Memory",
        slot: "memory",
        enabled: true,
        configured: !!process.env.OWLETTO_MCP_URL,
        settingsUrl: "/settings#skills",
      },
    ];

    return {
      version: config.version || process.env.npm_package_version || "unknown",
      githubUrl: config.githubUrl || "",
      deploymentMode: process.env.DEPLOYMENT_MODE || "docker",
      uptime: Math.floor(process.uptime()),
      skills: adminSkills,
      agents,
      plugins,
    };
  }

  // ─── Admin Pages ──────────────────────────────────────────────────────────

  async function handleAdminPage(c: Context) {
    const session = requireAdmin(c);
    if (!session) return c.redirect("/agents/login");
    try {
      const adminState = await buildAdminState();
      return c.html(renderAdminPage(adminState));
    } catch (error) {
      logger.error("Failed to render admin page", { error });
      return c.html(renderAdminErrorPage("Failed to load system skills."), 500);
    }
  }

  app.get("/agents", handleAdminPage);

  // ─── Agents API ──────────────────────────────────────────────────────────

  app.get("/api/v1/admin/agents", async (c) => {
    if (!requireAdmin(c)) return c.json({ error: "Unauthorized" }, 401);
    try {
      const agents = await config.agentMetadataStore.listAllAgents();
      return c.json({
        agents: agents.map((a) => ({
          agentId: a.agentId,
          name: a.name,
          description: a.description || "",
          owner: a.owner,
          parentConnectionId: a.parentConnectionId || null,
          createdAt: a.createdAt,
          lastUsedAt: a.lastUsedAt ?? null,
        })),
      });
    } catch (error) {
      logger.error("Failed to list agents", { error });
      return c.json({ error: "Failed to list agents" }, 500);
    }
  });

  // ─── System Env API ────────────────────────────────────────────────────────

  if (config.systemEnvStore) {
    const envStore = config.systemEnvStore;

    /** Build catalog and allowlist from current state */
    async function getCatalog() {
      const skills =
        (await config.systemSkillsService.getRawSystemSkills()) || [];
      const redisOverrides = await envStore.listAll();
      return buildEnvCatalog(skills, redisOverrides);
    }

    app.get("/api/v1/admin/env", async (c) => {
      if (!requireAdmin(c)) return c.json({ error: "Unauthorized" }, 401);

      try {
        const { vars } = await getCatalog();
        return c.json({ vars });
      } catch (error) {
        logger.error("Failed to list env vars", { error });
        return c.json({ error: "Failed to list env vars" }, 500);
      }
    });

    app.put("/api/v1/admin/env/:key", async (c) => {
      if (!requireAdmin(c)) return c.json({ error: "Unauthorized" }, 401);

      const key = c.req.param("key");
      const { allowedKeys } = await getCatalog();
      if (!allowedKeys.has(key)) {
        return c.json({ error: "Key not in allowed catalog" }, 400);
      }

      try {
        const body = await c.req.json();
        const value = body?.value;
        if (typeof value !== "string" || value.length === 0) {
          return c.json({ error: "Missing or empty value" }, 400);
        }

        await envStore.set(key, value);
        return c.json({ success: true, maskedValue: maskValue(value) });
      } catch (error) {
        logger.error("Failed to set env var", { key, error });
        return c.json({ error: "Failed to set env var" }, 500);
      }
    });

    app.delete("/api/v1/admin/env/:key", async (c) => {
      if (!requireAdmin(c)) return c.json({ error: "Unauthorized" }, 401);

      const key = c.req.param("key");
      const { allowedKeys } = await getCatalog();
      if (!allowedKeys.has(key)) {
        return c.json({ error: "Key not in allowed catalog" }, 400);
      }

      try {
        await envStore.delete(key);
        const processVal = process.env[key];
        return c.json({
          success: true,
          isSet: !!processVal,
          maskedValue: processVal ? maskValue(processVal) : null,
        });
      } catch (error) {
        logger.error("Failed to delete env var", { key, error });
        return c.json({ error: "Failed to delete env var" }, 500);
      }
    });
  }

  return app;
}

// ─── HTML Renderers ──────────────────────────────────────────────────────────

function renderAdminPage(adminState: Record<string, unknown>): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="referrer" content="no-referrer">
  <title>Admin</title>
  <style>${settingsPageCSS}</style>
</head>
<body class="min-h-screen bg-gradient-to-br from-slate-700 to-slate-900 p-4">
  <div class="max-w-xl mx-auto bg-white rounded-2xl shadow-2xl overflow-hidden">
    <div id="app"></div>
  </div>
  <script>window.__ADMIN_STATE__ = ${JSON.stringify(adminState)};</script>
  <script type="module">${getAdminPageJS()}</script>
</body>
</html>`;
}

function renderAdminLoginPage(error?: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="referrer" content="no-referrer">
  <title>Admin Login</title>
  <style>
    body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 1.25rem; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: linear-gradient(to bottom right, #334155, #0f172a); color: #e2e8f0; }
    .card { background: #0f172a; border: 1px solid #334155; border-radius: 1rem; box-shadow: 0 20px 25px -5px rgb(0 0 0 / 0.35); padding: 2rem; max-width: 24rem; width: 100%; }
    h1 { font-size: 1.25rem; font-weight: 700; margin: 0 0 1.25rem; text-align: center; }
    label { display: block; font-size: 0.875rem; font-weight: 500; margin-bottom: 0.5rem; color: #94a3b8; }
    input[type="password"] { width: 100%; padding: 0.625rem 0.75rem; border: 1px solid #334155; border-radius: 0.5rem; background: #1e293b; color: #e2e8f0; font-size: 0.875rem; outline: none; box-sizing: border-box; }
    input[type="password"]:focus { border-color: #64748b; box-shadow: 0 0 0 2px rgba(100,116,139,0.3); }
    button { width: 100%; margin-top: 1rem; padding: 0.625rem; border: none; border-radius: 0.5rem; background: linear-gradient(to right, #334155, #475569); color: #fff; font-weight: 600; font-size: 0.875rem; cursor: pointer; }
    button:hover { background: linear-gradient(to right, #475569, #64748b); }
    .error { margin-bottom: 1rem; padding: 0.625rem; border-radius: 0.5rem; background: rgba(239,68,68,0.15); border: 1px solid rgba(239,68,68,0.3); color: #fca5a5; font-size: 0.875rem; text-align: center; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Admin Login</h1>
    ${error ? `<div class="error">${esc(error)}</div>` : ""}
    <form method="POST" action="/agents/login">
      <label for="password">Password</label>
      <input type="password" id="password" name="password" autofocus required />
      <button type="submit">Log In</button>
    </form>
  </div>
</body>
</html>`;
}

function renderAdminErrorPage(message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Admin Error</title>
  <style>
    body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 1.25rem; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: linear-gradient(to bottom right, #ef4444, #b91c1c); }
    .card { background: #fff; border-radius: 1rem; box-shadow: 0 25px 50px -12px rgb(0 0 0 / 0.25); padding: 2.5rem; max-width: 28rem; width: 100%; text-align: center; }
    h1 { font-size: 1.5rem; font-weight: 700; color: #dc2626; margin: 0 0 1rem 0; }
    p { color: #4b5563; margin: 0 0 1.25rem 0; }
    .error-box { background: #fef2f2; border: 1px solid #fecaca; border-radius: 0.5rem; padding: 1rem; color: #b91c1c; font-size: 0.875rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Admin Error</h1>
    <p>Unable to load admin page.</p>
    <div class="error-box">${esc(message)}</div>
  </div>
</body>
</html>`;
}
