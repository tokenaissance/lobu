/**
 * Agent Selector Page - Web UI for choosing which agent handles a channel
 *
 * Routes:
 * - GET /agent-selector?token={token} - Show agent selector page
 * - POST /agent-selector/select - Bind channel to agent
 * - POST /agent-selector/create - Create new agent and bind
 */

import { createLogger, decrypt, encrypt } from "@lobu/core";
import { Hono } from "hono";
import type {
  AgentMetadata,
  AgentMetadataStore,
} from "../../auth/agent-metadata-store";
import type { AgentSettingsStore } from "../../auth/settings";
import {
  buildSettingsUrl,
  generateSettingsToken,
} from "../../auth/settings/token-service";
import type { UserAgentsStore } from "../../auth/user-agents-store";
import type { ChannelBindingService } from "../../channels";

const logger = createLogger("agent-selector-page");

/**
 * Token payload for agent selector (different from settings token)
 */
interface AgentSelectorTokenPayload {
  userId: string;
  platform: string;
  channelId: string;
  teamId?: string;
  purpose: "channel_config";
  exp: number;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Generate encrypted token for agent selector
 */
export function generateAgentSelectorToken(
  userId: string,
  platform: string,
  channelId: string,
  teamId?: string
): string {
  const payload: AgentSelectorTokenPayload = {
    userId,
    platform,
    channelId,
    teamId,
    purpose: "channel_config",
    exp: Date.now() + 60 * 60 * 1000, // 1 hour
  };
  return encrypt(JSON.stringify(payload));
}

/**
 * Verify and decode agent selector token
 */
function verifyAgentSelectorToken(
  token: string
): AgentSelectorTokenPayload | null {
  try {
    const decrypted = decrypt(token);
    const payload = JSON.parse(decrypted) as AgentSelectorTokenPayload;

    if (payload.purpose !== "channel_config") return null;
    if (!payload.userId || !payload.platform || !payload.channelId) return null;
    if (Date.now() > payload.exp) return null;

    return payload;
  } catch {
    return null;
  }
}

export interface AgentSelectorRoutesConfig {
  userAgentsStore: UserAgentsStore;
  agentMetadataStore: AgentMetadataStore;
  agentSettingsStore: AgentSettingsStore;
  channelBindingService: ChannelBindingService;
}

export function createAgentSelectorRoutes(
  config: AgentSelectorRoutesConfig
): Hono {
  const router = new Hono();

  // GET /agent-selector - Show agent selector page
  router.get("/agent-selector", async (c) => {
    const token = c.req.query("token");
    if (!token) {
      return c.html(renderErrorPage("Missing configuration token."));
    }

    const payload = verifyAgentSelectorToken(token);
    if (!payload) {
      return c.html(renderErrorPage("Invalid or expired configuration link."));
    }

    try {
      // Get user's agents
      const agentIds = await config.userAgentsStore.listAgents(
        payload.platform,
        payload.userId
      );

      const agents: (AgentMetadata & { channelCount: number })[] = [];
      for (const agentId of agentIds) {
        const metadata = await config.agentMetadataStore.getMetadata(agentId);
        if (metadata) {
          const bindings =
            await config.channelBindingService.listBindings(agentId);
          agents.push({ ...metadata, channelCount: bindings.length });
        }
      }

      // Check for existing binding
      const existingBinding = await config.channelBindingService.getBinding(
        payload.platform,
        payload.channelId,
        payload.teamId
      );

      return c.html(
        renderSelectorPage(payload, agents, existingBinding?.agentId, token)
      );
    } catch (error) {
      logger.error("Failed to render agent selector", { error });
      return c.html(renderErrorPage("Failed to load agent selector."));
    }
  });

  // POST /agent-selector/select - Bind channel to existing agent
  router.post("/agent-selector/select", async (c) => {
    const token = c.req.query("token");
    if (!token) return c.json({ error: "Missing token" }, 401);

    const payload = verifyAgentSelectorToken(token);
    if (!payload) return c.json({ error: "Invalid or expired token" }, 401);

    try {
      const body = await c.req.json<{ agentId: string }>();
      if (!body.agentId) return c.json({ error: "Missing agentId" }, 400);

      // Verify user owns the agent
      const owns = await config.userAgentsStore.ownsAgent(
        payload.platform,
        payload.userId,
        body.agentId
      );
      if (!owns) {
        // Check if it's a workspace agent they can use
        const metadata = await config.agentMetadataStore.getMetadata(
          body.agentId
        );
        if (!metadata?.isWorkspaceAgent) {
          return c.json({ error: "Agent not found or not owned by you" }, 404);
        }
      }

      // Check channel-per-agent limit
      const maxChannels = parseInt(
        process.env.MAX_CHANNELS_PER_AGENT || "0",
        10
      );
      if (maxChannels > 0) {
        const bindings = await config.channelBindingService.listBindings(
          body.agentId
        );
        if (bindings.length >= maxChannels) {
          return c.json(
            { error: `Channel limit reached (${maxChannels}) for this agent.` },
            429
          );
        }
      }

      // Create binding
      await config.channelBindingService.createBinding(
        body.agentId,
        payload.platform,
        payload.channelId,
        payload.teamId,
        { configuredBy: payload.userId }
      );

      // Update lastUsedAt
      await config.agentMetadataStore.updateMetadata(body.agentId, {
        lastUsedAt: Date.now(),
      });

      logger.info(
        `Bound ${payload.platform}/${payload.channelId} to agent ${body.agentId}`
      );

      return c.json({ success: true, agentId: body.agentId });
    } catch (error) {
      logger.error("Failed to select agent", { error });
      return c.json({ error: "Failed to select agent" }, 500);
    }
  });

  // POST /agent-selector/create - Create new agent and bind to channel
  router.post("/agent-selector/create", async (c) => {
    const token = c.req.query("token");
    if (!token) return c.json({ error: "Missing token" }, 401);

    const payload = verifyAgentSelectorToken(token);
    if (!payload) return c.json({ error: "Invalid or expired token" }, 401);

    try {
      const body = await c.req.json<{
        agentId: string;
        name: string;
        description?: string;
      }>();

      if (!body.agentId || !body.name) {
        return c.json({ error: "agentId and name are required" }, 400);
      }

      // Sanitize agentId
      const agentId = body.agentId.toLowerCase().replace(/[^a-z0-9-]/g, "-");
      if (
        agentId.length < 3 ||
        agentId.length > 40 ||
        !/^[a-z]/.test(agentId)
      ) {
        return c.json({ error: "Invalid agent ID format" }, 400);
      }

      // Check if exists
      const exists = await config.agentMetadataStore.hasAgent(agentId);
      if (exists) {
        return c.json({ error: "Agent ID already taken" }, 409);
      }

      // Check per-user limit
      const maxAgents = parseInt(process.env.MAX_AGENTS_PER_USER || "0", 10);
      if (maxAgents > 0) {
        const userAgents = await config.userAgentsStore.listAgents(
          payload.platform,
          payload.userId
        );
        if (userAgents.length >= maxAgents) {
          return c.json({ error: `Agent limit reached (${maxAgents})` }, 429);
        }
      }

      // Create agent
      await config.agentMetadataStore.createAgent(
        agentId,
        body.name,
        payload.platform,
        payload.userId,
        { description: body.description }
      );
      await config.agentSettingsStore.saveSettings(agentId, {});
      await config.userAgentsStore.addAgent(
        payload.platform,
        payload.userId,
        agentId
      );

      // Bind to channel
      await config.channelBindingService.createBinding(
        agentId,
        payload.platform,
        payload.channelId,
        payload.teamId,
        { configuredBy: payload.userId }
      );

      // Generate settings URL for the new agent
      const settingsToken = generateSettingsToken(
        agentId,
        payload.userId,
        payload.platform
      );
      const settingsUrl = buildSettingsUrl(settingsToken);

      logger.info(
        `Created and bound agent ${agentId} to ${payload.platform}/${payload.channelId}`
      );

      return c.json({ success: true, agentId, settingsUrl });
    } catch (error) {
      logger.error("Failed to create agent", { error });
      return c.json({ error: "Failed to create agent" }, 500);
    }
  });

  logger.info("Agent selector routes registered");
  return router;
}

function renderSelectorPage(
  payload: AgentSelectorTokenPayload,
  agents: (AgentMetadata & { channelCount: number })[],
  currentAgentId: string | undefined,
  token: string
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Configure Agent - Lobu</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="min-h-screen bg-gradient-to-br from-amber-700 to-amber-900 p-4">
  <div class="max-w-xl mx-auto bg-white rounded-2xl shadow-2xl p-6">
    <div class="text-center mb-5">
      <div class="text-4xl mb-1">&#129417;</div>
      <h1 class="text-xl font-bold text-amber-900">Configure Agent</h1>
      <p class="text-xs text-gray-500">Choose an agent for this channel</p>
      <p class="text-xs text-gray-400 mt-1">${escapeHtml(payload.platform)} / ${escapeHtml(payload.channelId)}</p>
    </div>

    <div id="success-msg" class="hidden bg-green-100 text-green-800 px-3 py-2 rounded-lg mb-4 text-center text-sm"></div>
    <div id="error-msg" class="hidden bg-red-100 text-red-800 px-3 py-2 rounded-lg mb-4 text-center text-sm"></div>

    ${
      currentAgentId
        ? `<div class="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
      <p class="text-xs text-blue-800">Currently using agent: <strong>${escapeHtml(currentAgentId)}</strong></p>
      <p class="text-xs text-blue-600 mt-1">Select a different agent below to switch.</p>
    </div>`
        : ""
    }

    <!-- Existing Agents -->
    <div class="mb-4">
      <h2 class="text-sm font-medium text-gray-800 mb-2">Your Agents</h2>
      ${
        agents.length > 0
          ? `<div class="space-y-2" id="agents-list">
        ${agents
          .map(
            (agent) => `
        <div class="flex items-center justify-between p-3 bg-gray-50 rounded-lg border ${
          agent.agentId === currentAgentId
            ? "border-amber-400 bg-amber-50"
            : "border-gray-200"
        }">
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium text-gray-800">${escapeHtml(agent.name)}${agent.isWorkspaceAgent ? ' <span class="text-xs text-amber-600">(workspace)</span>' : ""}</p>
            <p class="text-xs text-gray-500">${escapeHtml(agent.agentId)} &middot; ${agent.channelCount} channel${agent.channelCount !== 1 ? "s" : ""}</p>
            ${agent.description ? `<p class="text-xs text-gray-400 truncate">${escapeHtml(agent.description)}</p>` : ""}
          </div>
          <button type="button" onclick="selectAgent('${escapeHtml(agent.agentId)}')"
            class="ml-2 px-3 py-1.5 text-xs font-medium rounded-lg ${
              agent.agentId === currentAgentId
                ? "bg-amber-200 text-amber-800"
                : "bg-amber-600 text-white hover:bg-amber-700"
            } transition-all flex-shrink-0">
            ${agent.agentId === currentAgentId ? "Current" : "Select"}
          </button>
        </div>`
          )
          .join("")}
      </div>`
          : `<p class="text-xs text-gray-500 p-3 bg-gray-50 rounded-lg">No agents yet. Create one below.</p>`
      }
    </div>

    <!-- Create New Agent -->
    <div class="border-t border-gray-200 pt-4">
      <h2 class="text-sm font-medium text-gray-800 mb-3">Create New Agent</h2>
      <div class="space-y-2">
        <div>
          <label for="agentId" class="block text-xs font-medium text-gray-600 mb-1">Agent ID</label>
          <input type="text" id="agentId" placeholder="my-work-agent" pattern="[a-z][a-z0-9-]*" minlength="3" maxlength="40"
            class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono focus:border-amber-600 focus:ring-1 focus:ring-amber-200 outline-none">
          <p class="text-xs text-gray-400 mt-1">Lowercase letters, numbers, hyphens. 3-40 chars.</p>
        </div>
        <div>
          <label for="agentName" class="block text-xs font-medium text-gray-600 mb-1">Display Name</label>
          <input type="text" id="agentName" placeholder="Work Agent" maxlength="100"
            class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-amber-600 focus:ring-1 focus:ring-amber-200 outline-none">
        </div>
        <div>
          <label for="agentDesc" class="block text-xs font-medium text-gray-600 mb-1">Description (optional)</label>
          <input type="text" id="agentDesc" placeholder="Agent for work-related tasks" maxlength="200"
            class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-amber-600 focus:ring-1 focus:ring-amber-200 outline-none">
        </div>
        <button type="button" id="create-btn" onclick="createAgent()"
          class="w-full py-2.5 bg-gradient-to-r from-amber-700 to-amber-800 text-white text-sm font-semibold rounded-lg hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0 transition-all">
          Create &amp; Use This Agent
        </button>
      </div>
    </div>
  </div>

  <script>
    const token = ${JSON.stringify(token)};

    async function selectAgent(agentId) {
      hideMessages();
      try {
        const resp = await fetch('/agent-selector/select?token=' + encodeURIComponent(token), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentId })
        });
        const result = await resp.json();
        if (resp.ok) {
          showSuccess('Agent selected! You can now send messages in the channel. This page will close shortly.');
          setTimeout(function() { window.close(); }, 2000);
        } else {
          showError(result.error || 'Failed to select agent');
        }
      } catch (e) {
        showError('Network error: ' + e.message);
      }
    }

    async function createAgent() {
      const agentId = document.getElementById('agentId').value.trim();
      const name = document.getElementById('agentName').value.trim();
      const description = document.getElementById('agentDesc').value.trim();

      if (!agentId || !name) {
        showError('Agent ID and Display Name are required.');
        return;
      }

      const btn = document.getElementById('create-btn');
      btn.disabled = true;
      btn.textContent = 'Creating...';
      hideMessages();

      try {
        const resp = await fetch('/agent-selector/create?token=' + encodeURIComponent(token), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentId, name, description: description || undefined })
        });
        const result = await resp.json();
        if (resp.ok) {
          showSuccess('Agent created and assigned! Redirecting to settings...');
          if (result.settingsUrl) {
            setTimeout(function() { window.location.href = result.settingsUrl; }, 1500);
          }
        } else {
          showError(result.error || 'Failed to create agent');
        }
      } catch (e) {
        showError('Network error: ' + e.message);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Create & Use This Agent';
      }
    }

    function showSuccess(msg) {
      const el = document.getElementById('success-msg');
      el.textContent = msg;
      el.classList.remove('hidden');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function showError(msg) {
      const el = document.getElementById('error-msg');
      el.textContent = msg;
      el.classList.remove('hidden');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function hideMessages() {
      document.getElementById('success-msg').classList.add('hidden');
      document.getElementById('error-msg').classList.add('hidden');
    }
  </script>
</body>
</html>`;
}

function renderErrorPage(message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Configuration Error - Lobu</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="min-h-screen bg-gradient-to-br from-red-500 to-red-700 flex items-center justify-center p-5">
  <div class="bg-white rounded-2xl shadow-2xl p-10 max-w-md w-full text-center">
    <div class="text-6xl mb-5">&#10060;</div>
    <h1 class="text-2xl font-bold text-red-600 mb-4">Configuration Error</h1>
    <p class="text-gray-600 mb-5">${escapeHtml(message)}</p>
  </div>
</body>
</html>`;
}
