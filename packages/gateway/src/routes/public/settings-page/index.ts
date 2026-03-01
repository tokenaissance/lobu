/**
 * Settings Page HTML Templates (Alpine.js + Pre-compiled Tailwind CSS)
 */

import type { AgentMetadata } from "../../../auth/agent-metadata-store";
import type { AgentSettings } from "../../../auth/settings";
import {
  SETTINGS_TOKEN_HASH_PARAM,
  type SettingsTokenPayload,
} from "../../../auth/settings/token-service";
import type { ModelOption } from "../../../modules/module-system";
import { settingsPageCSS } from "../settings-page-styles";
import { renderAlpineApp } from "./alpine-app";
import {
  escapeHtml,
  formatUserId,
  getPlatformDisplay,
  renderHeaderSection,
  renderInstructionsSection,
  renderIntegrationsSection,
  renderMessageBanner,
  renderNixPackagesSection,
  renderPermissionsSection,
  renderPrefillBanner,
  renderProviderSection,
  renderRemindersSection,
  renderSecretsSection,
  renderSubmitButton,
  renderVerboseLoggingSection,
} from "./sections";

export interface ProviderMeta {
  id: string;
  name: string;
  iconUrl: string;
  authType: "oauth" | "device-code" | "api-key";
  supportedAuthTypes: ("oauth" | "device-code" | "api-key")[];
  apiKeyInstructions: string;
  apiKeyPlaceholder: string;
  catalogDescription?: string;
}

export interface SettingsPageOptions {
  providers?: ProviderMeta[];
  catalogProviders?: ProviderMeta[];
  providerModelOptions?: Record<string, ModelOption[]>;
  /** Show agent switcher in settings page (channel-based tokens) */
  showSwitcher?: boolean;
  /** User's agents for the switcher */
  agents?: (AgentMetadata & { channelCount: number })[];
  /** Agent name from metadata */
  agentName?: string;
  /** Agent description from metadata */
  agentDescription?: string;
  /** Whether the token has a channelId (for post-delete behavior) */
  hasChannelId?: boolean;
}

export function renderSettingsPage(
  payload: SettingsTokenPayload,
  settings: AgentSettings | null,
  options?: SettingsPageOptions
): string {
  const s: Partial<AgentSettings> = settings || {};
  // Installed providers (already resolved in order by settings.ts)
  const providers: ProviderMeta[] = options?.providers ?? [];

  // Catalog providers (available but not installed)
  const catalogProviders: ProviderMeta[] = options?.catalogProviders ?? [];

  const providerModelOptions: Record<string, ModelOption[]> =
    options?.providerModelOptions || {};

  const providerOrder = providers.map((p) => p.id);

  const initialSecrets = (() => {
    const existingEnvVars = s.envVars || {};
    const prefillKeys = payload.prefillEnvVars || [];
    const seen = new Set<string>();
    const rows: Array<{ key: string; value: string }> = [];

    for (const [rawKey, rawValue] of Object.entries(existingEnvVars)) {
      const key = rawKey.trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      rows.push({
        key,
        value:
          typeof rawValue === "string"
            ? rawValue
            : rawValue == null
              ? ""
              : String(rawValue),
      });
    }

    for (const rawKey of prefillKeys) {
      const key = (rawKey || "").trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      rows.push({ key, value: "" });
    }

    return rows;
  })();

  const showSwitcher = options?.showSwitcher ?? false;
  const agents = options?.agents ?? [];
  const agentName = options?.agentName ?? "";
  const agentDescription = options?.agentDescription ?? "";
  const hasChannelId = options?.hasChannelId ?? false;
  const initialNixPackages = (() => {
    const existing = s.nixConfig?.packages || [];
    const prefill = payload.prefillNixPackages || [];
    return Array.from(
      new Set(
        [...existing, ...prefill]
          .map((pkg) => (typeof pkg === "string" ? pkg.trim() : ""))
          .filter(Boolean)
      )
    );
  })();

  const initialState = {
    agentId: payload.agentId,
    PROVIDERS: Object.fromEntries(
      providers.map((p) => [
        p.id,
        {
          name: p.name,
          authType: p.authType,
          supportedAuthTypes: p.supportedAuthTypes,
          apiKeyInstructions: p.apiKeyInstructions,
          apiKeyPlaceholder: p.apiKeyPlaceholder,
        },
      ])
    ),
    providerOrder,
    providerModels: providerModelOptions,
    catalogProviders: catalogProviders.map((p) => ({
      id: p.id,
      name: p.name,
      iconUrl: p.iconUrl,
      authType: p.authType,
      supportedAuthTypes: p.supportedAuthTypes,
      apiKeyInstructions: p.apiKeyInstructions,
      apiKeyPlaceholder: p.apiKeyPlaceholder,
    })),
    initialSkills: s.skillsConfig?.skills || [],
    initialMcpServers: s.mcpServers || {},
    prefillSkills: payload.prefillSkills || [],
    prefillMcpServers: payload.prefillMcpServers || [],
    prefillGrants: payload.prefillGrants || [],
    prefillNixPackages: payload.prefillNixPackages || [],
    prefillEnvVars: payload.prefillEnvVars || [],
    initialSecrets,
    initialNixPackages,
    agentName,
    agentDescription,
    hasChannelId,
    verboseLogging: !!s.verboseLogging,
    identityMd: s.identityMd || "",
    soulMd: s.soulMd || "",
    userMd: s.userMd || "",
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="referrer" content="no-referrer">
  <title>Agent Settings - Lobu</title>
  <style>${settingsPageCSS}</style>
  <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.14.9/dist/cdn.min.js"></script>
</head>
<body class="min-h-screen bg-gradient-to-br from-slate-700 to-slate-900 p-4" x-data="settingsApp()" x-cloak>
  <div class="max-w-xl mx-auto bg-white rounded-2xl shadow-2xl p-6">
${renderHeaderSection(payload, showSwitcher, agents)}

    <div x-show="successMsg" x-transition class="bg-green-100 text-green-800 px-3 py-2 rounded-lg mb-4 text-center text-sm" x-text="successMsg"></div>
    <div x-show="errorMsg" x-transition class="bg-red-100 text-red-800 px-3 py-2 rounded-lg mb-4 text-center text-sm" x-text="errorMsg"></div>
    ${renderMessageBanner(payload)}
${renderPrefillBanner()}

    <form @submit.prevent="saveSettings()" @keydown.enter="if ($event.target.tagName !== 'TEXTAREA' && $event.target.type !== 'submit') $event.preventDefault()" class="space-y-3">
${renderProviderSection(providers)}

${renderInstructionsSection()}

${renderIntegrationsSection()}

${renderRemindersSection()}

${renderPermissionsSection()}

${renderNixPackagesSection()}

${renderSecretsSection()}

${renderVerboseLoggingSection()}

${renderSubmitButton()}
    </form>
  </div>
${renderAlpineApp(JSON.stringify(initialState), providers.length === 0)}
</body>
</html>`;
}

// ─── Picker Page ────────────────────────────────────────────────────────────

/**
 * Render the agent picker / creation page.
 * Shown when a channel-based token has no agent bound.
 */
export function renderPickerPage(
  payload: SettingsTokenPayload,
  agents: (AgentMetadata & { channelCount: number })[]
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="referrer" content="no-referrer">
  <title>Configure Agent - Lobu</title>
  <style>${settingsPageCSS}</style>
</head>
<body class="min-h-screen bg-gradient-to-br from-slate-700 to-slate-900 p-4">
  <div class="max-w-xl mx-auto bg-white rounded-2xl shadow-2xl p-6">
    <div class="text-center mb-5">
      <div class="text-4xl mb-1">&#129438;</div>
      <h1 class="text-xl font-bold text-slate-900">Configure Agent</h1>
      <p class="text-xs text-gray-500">${getPlatformDisplay(payload.platform).icon} ${escapeHtml(formatUserId(payload.userId))}</p>
      ${payload.channelId ? `<p class="text-xs text-gray-400 mt-1">Channel: ${escapeHtml(payload.channelId)}</p>` : ""}
    </div>

    <div id="success-msg" class="hidden bg-green-100 text-green-800 px-3 py-2 rounded-lg mb-4 text-center text-sm"></div>
    <div id="error-msg" class="hidden bg-red-100 text-red-800 px-3 py-2 rounded-lg mb-4 text-center text-sm"></div>

    ${
      agents.length > 0
        ? `<!-- Existing Agents -->
    <div class="mb-4">
      <h2 class="text-sm font-medium text-gray-800 mb-2">Your Agents</h2>
      <div class="space-y-2" id="agents-list">
${agents
  .map(
    (agent) => `
        <div class="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200">
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium text-gray-800">${escapeHtml(agent.name)}${agent.isWorkspaceAgent ? ' <span class="text-xs text-slate-600">(workspace)</span>' : ""}</p>
            <p class="text-xs text-gray-500">${escapeHtml(agent.agentId)} &middot; ${agent.channelCount} channel${agent.channelCount !== 1 ? "s" : ""}</p>
            ${agent.description ? `<p class="text-xs text-gray-400 truncate">${escapeHtml(agent.description)}</p>` : ""}
          </div>
          <button type="button" onclick="selectAgent('${escapeHtml(agent.agentId)}')"
            class="ml-2 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-600 text-white hover:bg-slate-700 transition-all flex-shrink-0">
            Select
          </button>
        </div>`
  )
  .join("")}
      </div>
    </div>`
        : `<div class="mb-4">
      <p class="text-sm text-gray-500 p-3 bg-gray-50 rounded-lg text-center">No agents yet. Create one below to get started.</p>
    </div>`
    }

    <!-- Create New Agent -->
    <div class="border-t border-gray-200 pt-4">
      <h2 class="text-sm font-medium text-gray-800 mb-3">Create New Agent</h2>
      <div class="space-y-2">
        <div>
          <label for="agentName" class="block text-xs font-medium text-gray-600 mb-1">Name</label>
          <input type="text" id="agentName" placeholder="My Agent" maxlength="100"
            oninput="autoGenerateId()"
            class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none">
        </div>
        <div>
          <label for="agentId" class="block text-xs font-medium text-gray-600 mb-1">Agent ID</label>
          <input type="text" id="agentId" placeholder="my-agent" pattern="[a-z][a-z0-9-]*" minlength="3" maxlength="40"
            class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none">
          <p class="text-xs text-gray-400 mt-1">Auto-generated from name. Lowercase letters, numbers, hyphens.</p>
        </div>
        <button type="button" id="create-btn" onclick="createAgent()"
          class="w-full py-2.5 bg-gradient-to-r from-slate-700 to-slate-800 text-white text-sm font-semibold rounded-lg hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0 transition-all">
          Create Agent
        </button>
      </div>
    </div>
  </div>

  <script>
    var idManuallyEdited = false;
    document.getElementById('agentId').addEventListener('input', function() {
      idManuallyEdited = true;
    });

    function autoGenerateId() {
      if (idManuallyEdited) return;
      var name = document.getElementById('agentName').value;
      var slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      if (slug.length > 40) slug = slug.substring(0, 40);
      document.getElementById('agentId').value = slug;
    }

    async function selectAgent(agentId) {
      hideMessages();
      try {
        var resp = await fetch('/settings/switch-agent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentId: agentId })
        });
        var result = await resp.json();
        if (resp.ok) {
          showSuccess('Agent selected! Loading settings...');
          setTimeout(function() { window.location.reload(); }, 500);
        } else {
          showError(result.error || 'Failed to select agent');
        }
      } catch (e) {
        showError('Network error: ' + e.message);
      }
    }

    async function createAgent() {
      var agentId = document.getElementById('agentId').value.trim();
      var name = document.getElementById('agentName').value.trim();

      if (!name) {
        showError('Agent name is required.');
        return;
      }
      if (!agentId) {
        showError('Agent ID is required.');
        return;
      }

      var btn = document.getElementById('create-btn');
      btn.disabled = true;
      btn.textContent = 'Creating...';
      hideMessages();

      try {
        var resp = await fetch('/settings/create-agent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentId: agentId, name: name })
        });
        var result = await resp.json();
        if (resp.ok) {
          showSuccess('Agent created! Loading settings...');
          setTimeout(function() { window.location.reload(); }, 500);
        } else {
          showError(result.error || 'Failed to create agent');
        }
      } catch (e) {
        showError('Network error: ' + e.message);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Create Agent';
      }
    }

    function showSuccess(msg) {
      var el = document.getElementById('success-msg');
      el.textContent = msg;
      el.classList.remove('hidden');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    function showError(msg) {
      var el = document.getElementById('error-msg');
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

// ─── Session Bootstrap Page ─────────────────────────────────────────────────

export function renderSessionBootstrapPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="referrer" content="no-referrer">
  <title>Loading Settings - Lobu</title>
  <style>
    body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 1.25rem; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: linear-gradient(to bottom right, #334155, #0f172a); color: #e2e8f0; }
    .card { background: #0f172a; border: 1px solid #334155; border-radius: 1rem; box-shadow: 0 20px 25px -5px rgb(0 0 0 / 0.35); padding: 1.5rem; max-width: 28rem; width: 100%; text-align: center; }
    .spinner { width: 1.25rem; height: 1.25rem; border: 2px solid #475569; border-top-color: #cbd5e1; border-radius: 9999px; margin: 0 auto 0.75rem; animation: spin 0.8s linear infinite; }
    .error { display: none; margin-top: 0.75rem; font-size: 0.875rem; color: #fca5a5; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="card">
    <div id="spinner" class="spinner"></div>
    <p id="status">Securing your settings session...</p>
    <p id="error" class="error"></p>
  </div>
  <script>
    (async function () {
      var hash = window.location.hash ? window.location.hash.slice(1) : '';
      var params = new URLSearchParams(hash);
      var token = params.get('${SETTINGS_TOKEN_HASH_PARAM}') || params.get('token');
      var errorEl = document.getElementById('error');
      var statusEl = document.getElementById('status');
      var spinnerEl = document.getElementById('spinner');

      function showError(message) {
        statusEl.textContent = 'Unable to open settings.';
        errorEl.textContent = message;
        errorEl.style.display = 'block';
        spinnerEl.style.display = 'none';
      }

      if (!token) {
        showError('Missing settings link token. Request a new link with /configure.');
        return;
      }

      try {
        var resp = await fetch('/settings/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: token })
        });

        if (!resp.ok) {
          var result = await resp.json().catch(function () { return {}; });
          showError(result.error || 'Invalid or expired settings link.');
          return;
        }

        var url = new URL(window.location.href);
        url.hash = '';
        url.search = '';
        window.history.replaceState({}, '', url.pathname);
        window.location.replace('/settings');
      } catch (error) {
        showError('Network error while securing session.');
      }
    })();
  </script>
</body>
</html>`;
}

// ─── Error Page ─────────────────────────────────────────────────────────────

export function renderErrorPage(message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Settings Error - Lobu</title>
  <style>
    body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 1.25rem; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: linear-gradient(to bottom right, #ef4444, #b91c1c); }
    .card { background: #fff; border-radius: 1rem; box-shadow: 0 25px 50px -12px rgb(0 0 0 / 0.25); padding: 2.5rem; max-width: 28rem; width: 100%; text-align: center; }
    .icon { font-size: 3.75rem; margin-bottom: 1.25rem; }
    h1 { font-size: 1.5rem; font-weight: 700; color: #dc2626; margin: 0 0 1rem 0; }
    p { color: #4b5563; margin: 0 0 1.25rem 0; }
    .error-box { background: #fef2f2; border: 1px solid #fecaca; border-radius: 0.5rem; padding: 1rem; color: #b91c1c; font-size: 0.875rem; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">&#10060;</div>
    <h1>Settings Error</h1>
    <p>Unable to load settings page.</p>
    <div class="error-box">
      ${escapeHtml(message)}
    </div>
  </div>
</body>
</html>`;
}
