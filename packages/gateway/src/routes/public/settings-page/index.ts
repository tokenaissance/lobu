/**
 * Settings Page HTML Templates (Preact + Pre-compiled Tailwind CSS)
 */

import type { AgentMetadata } from "../../../auth/agent-metadata-store";
import type { AgentSettings } from "../../../auth/settings";
import {
	SETTINGS_TOKEN_HASH_PARAM,
	type SettingsTokenPayload,
} from "../../../auth/settings/token-service";
import type { ModelOption } from "../../../modules/module-system";
import { settingsPageCSS } from "../settings-page-styles";
import { escapeHtml, formatUserId, getPlatformDisplay } from "./utils";

let settingsPageJS = "";
try {
	const bundle = require("../settings-page-bundle");
	settingsPageJS = bundle.settingsPageJS;
} catch {
	settingsPageJS =
		'document.getElementById("app").textContent = "Bundle not built. Run: bun run scripts/build-settings.ts";';
}

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
	showSwitcher?: boolean;
	agents?: (AgentMetadata & { channelCount: number })[];
	agentName?: string;
	agentDescription?: string;
	hasChannelId?: boolean;
	systemSkills?: import("@lobu/core").SkillConfig[];
	integrationStatus?: Record<
		string,
		{
			connected: boolean;
			accounts: { accountId: string; grantedScopes: string[] }[];
			availableScopes: string[];
		}
	>;
}

export function renderSettingsPage(
	payload: SettingsTokenPayload,
	settings: AgentSettings | null,
	options?: SettingsPageOptions,
): string {
	const s: Partial<AgentSettings> = settings || {};
	const providers: ProviderMeta[] = options?.providers ?? [];
	const catalogProviders: ProviderMeta[] = options?.catalogProviders ?? [];
	const providerModelOptions: Record<string, ModelOption[]> =
		options?.providerModelOptions || {};
	const providerOrder = providers.map((p) => p.id);

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
					.filter(Boolean),
			),
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
			]),
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
		initialSkills: [
			...(options?.systemSkills || []),
			...(s.skillsConfig?.skills || []),
		],
		initialMcpServers: s.mcpServers || {},
		prefillSkills: payload.prefillSkills || [],
		prefillMcpServers: payload.prefillMcpServers || [],
		prefillGrants: payload.prefillGrants || [],
		prefillNixPackages: payload.prefillNixPackages || [],
		prefillEnvVars: payload.prefillEnvVars || [],
		initialNixPackages,
		agentName,
		agentDescription,
		hasChannelId,
		verboseLogging: !!s.verboseLogging,
		identityMd: s.identityMd || "",
		soulMd: s.soulMd || "",
		userMd: s.userMd || "",
		// Additional fields for Preact client
		platform: payload.platform,
		userId: payload.userId,
		channelId: payload.channelId,
		teamId: payload.teamId,
		message: payload.message,
		showSwitcher,
		agents: agents.map((a) => ({
			agentId: a.agentId,
			name: a.name,
			isWorkspaceAgent: a.isWorkspaceAgent,
			channelCount: a.channelCount,
			description: a.description,
		})),
		hasNoProviders: providers.length === 0,
		providerIconUrls: Object.fromEntries(
			providers.map((p) => [p.id, p.iconUrl]),
		),
		integrationStatus: options?.integrationStatus ?? {},
	};

	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="referrer" content="no-referrer">
  <title>Agent Settings - Lobu</title>
  <style>${settingsPageCSS}</style>
  ${payload.platform === "telegram" ? '<script src="https://telegram.org/js/telegram-web-app.js"></script>' : ""}
</head>
<body class="min-h-screen bg-gradient-to-br from-slate-700 to-slate-900 p-4">
  <div class="max-w-xl mx-auto bg-white rounded-2xl shadow-2xl p-6">
    <div id="app"></div>
  </div>
  <script>window.__SETTINGS_STATE__ = ${JSON.stringify(initialState)};</script>
  <script type="module">${settingsPageJS}</script>
</body>
</html>`;
}

// ─── Picker Page ────────────────────────────────────────────────────────────

export function renderPickerPage(
	payload: SettingsTokenPayload,
	agents: (AgentMetadata & { channelCount: number })[],
): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="referrer" content="no-referrer">
  <title>Configure Agent - Lobu</title>
  <style>${settingsPageCSS}</style>
  ${payload.platform === "telegram" ? '<script src="https://telegram.org/js/telegram-web-app.js"></script>' : ""}
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
        </div>`,
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

    var __platform = ${JSON.stringify(payload.platform)};
    var __channelId = ${JSON.stringify(payload.channelId || "")};
    var __teamId = ${JSON.stringify(payload.teamId || "")};

    async function selectAgent(agentId) {
      hideMessages();
      try {
        var body = { platform: __platform, channelId: __channelId };
        if (__teamId) body.teamId = __teamId;
        var resp = await fetch('/api/v1/agents/' + encodeURIComponent(agentId) + '/channels', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
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
        var createBody = { agentId: agentId, name: name };
        if (__channelId) createBody.channelId = __channelId;
        var resp = await fetch('/api/v1/manage/agents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(createBody)
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
      var errorEl = document.getElementById('error');
      var statusEl = document.getElementById('status');
      var spinnerEl = document.getElementById('spinner');

      function showError(message) {
        statusEl.textContent = 'Unable to open settings.';
        errorEl.textContent = message;
        errorEl.style.display = 'block';
        spinnerEl.style.display = 'none';
      }

      function redirectToSettings() {
        var url = new URL(window.location.href);
        url.hash = '';
        url.search = '';
        window.history.replaceState({}, '', url.pathname);
        window.location.replace('/settings');
      }

      // Path A: Telegram WebApp initData (stable URLs, no token needed)
      var qp = new URLSearchParams(window.location.search);
      var chatId = qp.get('chat');
      var isTelegramUrl = qp.get('platform') === 'telegram' && chatId;

      if (isTelegramUrl) {
        // Telegram injects initData as #tgWebAppData=<url-encoded-initData>&...
        var hashStr = window.location.hash ? window.location.hash.slice(1) : '';
        var hashParams = new URLSearchParams(hashStr);
        var initData = hashParams.get('tgWebAppData') || '';

        if (!initData) {
          showError('Could not authenticate with Telegram. Please open this link using the button in Telegram, not as a regular URL.');
          return;
        }

        try {
          var resp = await fetch('/settings/session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ initData: initData, chatId: chatId })
          });
          if (resp.ok) {
            redirectToSettings();
            return;
          }
          var result = await resp.json().catch(function () { return {}; });
          showError(result.error || 'Telegram authentication failed.');
          return;
        } catch (e) {
          showError('Network error while authenticating.');
          return;
        }
      }

      // Path B: Session-based authentication (opaque session ID in URL hash)
      var hash = window.location.hash ? window.location.hash.slice(1) : '';
      var params = new URLSearchParams(hash);
      var sessionId = params.get('s') || params.get('${SETTINGS_TOKEN_HASH_PARAM}') || params.get('token');

      if (!sessionId) {
        showError('Missing settings link. Request a new link with /configure.');
        return;
      }

      try {
        var resp = await fetch('/settings/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: sessionId })
        });

        if (!resp.ok) {
          var result = await resp.json().catch(function () { return {}; });
          showError(result.error || 'Invalid or expired settings link.');
          return;
        }

        redirectToSettings();
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
