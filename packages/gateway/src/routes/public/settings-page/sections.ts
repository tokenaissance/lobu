/**
 * Settings Page HTML Section Generators
 */

import type { SettingsTokenPayload } from "../../../auth/settings/token-service";
import { platformRegistry } from "../../../platform";
import type { ProviderMeta } from "./index";

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function formatUserId(userId: string): string {
  if (userId.startsWith("+")) return userId;
  if (userId.includes("@")) {
    const parts = userId.split("@");
    const id = parts[0] || "";
    const domain = parts[1] || "";
    if (domain === "lid") return `ID: ${id.slice(0, 8)}...`;
    if (domain === "s.whatsapp.net") return `+${id}`;
    return userId;
  }
  return userId;
}

export function getPlatformDisplay(platform: string): {
  icon: string;
  name: string;
} {
  const adapter = platformRegistry.get(platform);
  if (adapter?.getDisplayInfo) {
    const info = adapter.getDisplayInfo();
    const icon = info.icon.includes('class="')
      ? info.icon.replace('class="', 'class="w-4 h-4 inline-block ')
      : info.icon.replace("<svg", '<svg class="w-4 h-4 inline-block"');
    return { icon, name: info.name };
  }
  return {
    icon: '<svg class="w-4 h-4 inline-block" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/></svg>',
    name: platform || "API",
  };
}

// ─── Header / Agent Identity ────────────────────────────────────────────────

export function renderHeaderSection(
  payload: SettingsTokenPayload,
  showSwitcher: boolean,
  agents: { agentId: string; name: string; isWorkspaceAgent?: boolean }[]
): string {
  const switcherContent = showSwitcher
    ? `          <button type="button" @click="switcherOpen = !switcherOpen" class="inline-flex items-center gap-1.5 text-xl font-bold text-slate-900 hover:text-slate-700 transition-colors" title="${escapeHtml(payload.agentId || "")}">
            <span x-text="agentName || 'Agent Settings'"></span>
            <svg class="w-4 h-4 text-slate-400" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clip-rule="evenodd"/></svg>
          </button>
          <div x-show="switcherOpen" @click.away="switcherOpen = false" class="absolute left-1/2 -translate-x-1/2 mt-2 w-72 bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden z-20">
            <div class="max-h-48 overflow-y-auto">
${agents
  .map(
    (agent) => `
              <div class="w-full flex items-center justify-between px-3 py-2 text-left ${agent.agentId !== payload.agentId ? "hover:bg-slate-50 cursor-pointer" : "bg-slate-50"} transition-colors border-b border-slate-100 last:border-b-0"${agent.agentId !== payload.agentId ? ` @click="switching = true; switchAgent('${escapeHtml(agent.agentId)}')"` : ""}>
                <div class="min-w-0">
                  <p class="text-sm font-medium text-gray-800" title="${escapeHtml(agent.agentId)}">${escapeHtml(agent.name)}${agent.isWorkspaceAgent ? ' <span class="text-xs text-slate-500">(workspace)</span>' : ""}</p>
                </div>
                ${
                  agent.agentId === payload.agentId
                    ? `<div class="flex items-center gap-1 flex-shrink-0 ml-2">
                  <span class="text-xs text-slate-600">Current</span>
                  <button type="button" @click.stop="switcherOpen = false; editingIdentity = true" class="p-1 text-slate-400 hover:text-slate-600 transition-colors" title="Edit">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg>
                  </button>
                  <button type="button" @click.stop="switcherOpen = false; showDeleteConfirm = true" class="p-1 text-slate-400 hover:text-red-500 transition-colors" title="Delete">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                  </button>
                </div>`
                    : ""
                }
              </div>`
  )
  .join("")}
            </div>
            <!-- Create New Agent -->
            <div class="border-t border-slate-200">
              <template x-if="!creatingInSwitcher">
                <button type="button" @click.stop="creatingInSwitcher = true"
                  class="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-slate-50 transition-colors text-slate-600">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"/></svg>
                  <span class="text-sm font-medium">Create new agent</span>
                </button>
              </template>
              <template x-if="creatingInSwitcher">
                <div class="px-3 py-2 space-y-2" @click.stop>
                  <input type="text" x-model="switcherNewName" placeholder="Agent name" maxlength="100"
                    class="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none"
                    @keydown.enter.prevent="if (switcherNewName.trim()) createAgentFromSwitcher(switcherNewName)">
                  <div class="flex gap-2">
                    <button type="button" @click="creatingInSwitcher = false; switcherNewName = ''"
                      class="flex-1 px-2 py-1.5 text-xs font-medium rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition-all">Cancel</button>
                    <button type="button" @click="createAgentFromSwitcher(switcherNewName)" :disabled="!switcherNewName.trim() || switching"
                      class="flex-1 px-2 py-1.5 text-xs font-medium rounded-lg bg-slate-600 text-white hover:bg-slate-700 transition-all disabled:opacity-60"
                      x-text="switching ? 'Creating...' : 'Create'"></button>
                  </div>
                </div>
              </template>
            </div>
          </div>`
    : `          <div class="inline-flex items-center gap-2">
            <h1 class="text-xl font-bold text-slate-900" x-text="agentName || 'Agent Settings'" title="${escapeHtml(payload.agentId || "")}"></h1>
            <button type="button" @click="editingIdentity = true" class="p-1 text-slate-400 hover:text-slate-600 transition-colors" title="Edit">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg>
            </button>
            <button type="button" @click="showDeleteConfirm = true" class="p-1 text-slate-400 hover:text-red-500 transition-colors" title="Delete">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
            </button>
          </div>`;

  return `
    <div class="mb-5" x-data="{ ${showSwitcher ? "switcherOpen: false, switching: false, creatingInSwitcher: false, switcherNewName: '', " : ""}editingIdentity: false, showDeleteConfirm: false, deleteConfirmText: '', deleting: false }">
      <div class="text-center mb-3">
        <div class="text-4xl mb-1">&#129438;</div>
        <div class="relative inline-block" x-show="!editingIdentity">
${switcherContent}
        </div>
        <p x-show="!editingIdentity && agentDescription" class="text-xs text-gray-500 mt-0.5" x-text="agentDescription"></p>
        <p class="text-xs text-gray-500 mt-1">${getPlatformDisplay(payload.platform).icon} ${escapeHtml(formatUserId(payload.userId))}</p>
      </div>

      <!-- Inline identity edit -->
      <div x-show="editingIdentity" x-transition class="space-y-2 mb-3">
        <input type="text" x-model="agentName" maxlength="100" placeholder="Agent name"
          class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none">
        <input type="text" x-model="agentDescription" maxlength="200" placeholder="Short description"
          class="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none">
        <div class="flex gap-2 justify-center">
          <button type="button" @click="editingIdentity = false; agentName = _initialAgentName; agentDescription = _initialAgentDescription"
            class="px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition-all">Cancel</button>
          <button type="button" @click="await saveIdentity(); editingIdentity = false"
            :disabled="savingIdentity || (agentName === _initialAgentName && agentDescription === _initialAgentDescription)"
            class="px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-600 text-white hover:bg-slate-700 transition-all disabled:opacity-60"
            x-text="savingIdentity ? 'Saving...' : 'Save'"></button>
        </div>
      </div>

      <!-- Delete confirmation -->
      <div x-show="showDeleteConfirm" x-transition class="mt-2 space-y-2">
        <p class="text-xs text-gray-600 text-center">Type <strong class="font-mono">${escapeHtml(payload.agentId || "")}</strong> to confirm deletion:</p>
        <input type="text" x-model="deleteConfirmText" placeholder="${escapeHtml(payload.agentId || "")}"
          class="w-full px-3 py-2 border border-red-200 rounded-lg text-xs font-mono focus:border-red-400 focus:ring-1 focus:ring-red-200 outline-none"
          @keydown.enter.prevent="if (deleteConfirmText === '${escapeHtml(payload.agentId || "")}') deleteAgent()">
        <div class="flex gap-2">
          <button type="button" @click="showDeleteConfirm = false; deleteConfirmText = ''"
            class="flex-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition-all">Cancel</button>
          <button type="button" @click="deleteAgent()" :disabled="deleteConfirmText !== '${escapeHtml(payload.agentId || "")}' || deleting"
            class="flex-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 transition-all disabled:opacity-60"
            x-text="deleting ? 'Deleting...' : 'Delete'"></button>
        </div>
      </div>
    </div>`;
}

// ─── Messages & Prefill Banner ──────────────────────────────────────────────

export function renderMessageBanner(payload: SettingsTokenPayload): string {
  return payload.message
    ? `<div class="bg-blue-50 border border-blue-200 text-blue-800 px-4 py-3 rounded-lg mb-4 text-sm">
      <div class="flex items-start gap-2">
        <span class="text-lg">&#128161;</span>
        <div>${escapeHtml(payload.message)}</div>
      </div>
    </div>`
    : "";
}

export function renderPrefillBanner(): string {
  return `<!-- Prefill Confirmation Banner -->
    <div x-show="hasPrefills && !prefillBannerDismissed" x-transition class="bg-amber-50 border border-amber-300 rounded-lg p-4 mb-4">
      <div class="flex items-start gap-2 mb-3">
        <span class="text-lg">&#9888;&#65039;</span>
        <div>
          <h3 class="text-sm font-semibold text-amber-900">Pending changes from your agent</h3>
          <p class="text-xs text-amber-700 mt-0.5">Review and approve the requested configuration changes.</p>
        </div>
      </div>
      <div class="space-y-2 mb-3">
        <template x-if="prefillGrants.length > 0">
          <div>
            <p class="text-xs font-medium text-amber-800 mb-1">&#127760; Network Access Domains</p>
            <div class="flex flex-wrap gap-1">
              <template x-for="d in prefillGrants" :key="d">
                <span class="inline-block px-1.5 py-0.5 bg-white border border-amber-200 rounded text-xs font-mono text-amber-900" x-text="d"></span>
              </template>
            </div>
          </div>
        </template>
        <template x-if="prefillNixPackages.length > 0">
          <div>
            <p class="text-xs font-medium text-amber-800 mb-1">&#128230; System Packages</p>
            <div class="flex flex-wrap gap-1">
              <template x-for="p in prefillNixPackages" :key="p">
                <span class="inline-block px-1.5 py-0.5 bg-white border border-amber-200 rounded text-xs font-mono text-amber-900" x-text="p"></span>
              </template>
            </div>
          </div>
        </template>
        <template x-if="prefillEnvVars.length > 0">
          <div>
            <p class="text-xs font-medium text-amber-800 mb-1">&#128203; Secrets</p>
            <div class="flex flex-wrap gap-1">
              <template x-for="v in prefillEnvVars" :key="v">
                <span class="inline-block px-1.5 py-0.5 bg-white border border-amber-200 rounded text-xs font-mono text-amber-900" x-text="v"></span>
              </template>
            </div>
            <p class="text-xs text-amber-700 mt-1">You'll need to fill in values after approving.</p>
          </div>
        </template>
        <template x-if="prefillSkills.length > 0">
          <div>
            <p class="text-xs font-medium text-amber-800 mb-1">&#9889; Skills</p>
            <div class="space-y-1">
              <template x-for="s in prefillSkills" :key="s.repo">
                <div class="flex items-center gap-2">
                  <span class="text-xs font-medium text-amber-900" x-text="s.name || s.repo"></span>
                  <span class="text-xs text-amber-600 font-mono" x-text="s.repo"></span>
                </div>
              </template>
            </div>
          </div>
        </template>
        <template x-if="prefillMcpServers.length > 0">
          <div>
            <p class="text-xs font-medium text-amber-800 mb-1">&#128268; MCP Servers</p>
            <div class="space-y-1">
              <template x-for="m in prefillMcpServers" :key="m.id">
                <div class="flex items-center gap-2">
                  <span class="text-xs font-medium text-amber-900" x-text="m.name || m.id"></span>
                  <span class="text-xs text-amber-600 font-mono" x-text="m.url || ''"></span>
                </div>
              </template>
            </div>
          </div>
        </template>
      </div>
      <div class="flex gap-2">
        <button type="button" @click="approveAllPrefills()" :disabled="approvingPrefills"
          class="px-4 py-2 text-xs font-semibold rounded-lg bg-amber-600 text-white hover:bg-amber-700 transition-all disabled:opacity-60"
          x-text="approvingPrefills ? 'Approving...' : 'Approve All'">
        </button>
        <button type="button" @click="prefillBannerDismissed = true; var u = new URL(window.location.href); u.searchParams.set('dismissed','1'); window.history.replaceState({}, '', u.toString())"
          class="px-4 py-2 text-xs font-medium rounded-lg border border-amber-300 text-amber-800 hover:bg-amber-100 transition-all">
          Dismiss
        </button>
      </div>
    </div>`;
}

// ─── Model Selection / Providers Section ────────────────────────────────────

export function renderProviderSection(providers: ProviderMeta[]): string {
  const emptyState =
    providers.length === 0
      ? `<div class="text-center py-6 text-gray-500">
              <p class="text-sm font-medium text-gray-700 mb-1">No model providers configured</p>
              <p class="text-xs">Add a provider below to get started.</p>
            </div>`
      : "";

  const providerCards = providers
    .map(
      (p, i) => `
      <div id="provider-card-${escapeHtml(p.id)}"
        class="${i > 0 ? "mt-3 pt-3 border-t border-gray-200" : ""}">
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-3 min-w-0">
            <label class="inline-flex items-center cursor-pointer" title="Set as primary provider">
              <input type="radio" name="primaryProvider" value="${escapeHtml(p.id)}" x-model="primaryProvider"
                class="w-4 h-4 accent-slate-600 cursor-pointer">
            </label>
            <img src="${escapeHtml(p.iconUrl)}" alt="${escapeHtml(p.name)}" class="w-5 h-5 rounded">
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <p class="text-sm font-medium text-gray-800">${escapeHtml(p.name)}</p>
              </div>
              <p class="text-xs"
                :class="providerState['${p.id}']?.connected ? (providerState['${p.id}']?.userConnected ? 'text-emerald-600' : 'text-amber-600') : 'text-gray-500'"
                x-text="providerState['${p.id}']?.status || 'Checking...'"></p>
            </div>
          </div>
          <div class="flex items-center gap-2 flex-shrink-0">
            <div x-show="providerState['${p.id}']?.connected" x-transition class="sm:flex-none relative"
              @click.outside="providerState['${p.id}'].showModelDropdown = false">
              <input type="text"
                x-model="providerState['${p.id}'].modelQuery"
                @focus="providerState['${p.id}'].showModelDropdown = true"
                @input="providerState['${p.id}'].showModelDropdown = true; providerState['${p.id}'].selectedModel = $event.target.value"
                @keydown.escape="providerState['${p.id}'].showModelDropdown = false"
                @keydown.enter.prevent="providerState['${p.id}'].showModelDropdown = false"
                :placeholder="providerState['${p.id}'].selectedModel || 'Auto model'"
                aria-label="${escapeHtml(p.name)} model"
                class="w-36 sm:w-44 px-3 py-1.5 border border-gray-200 rounded-lg text-xs focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none bg-white placeholder-gray-500">
              <div x-show="providerState['${p.id}'].showModelDropdown" x-transition
                class="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                <button type="button"
                  @click="providerState['${p.id}'].selectedModel = ''; providerState['${p.id}'].modelQuery = ''; providerState['${p.id}'].showModelDropdown = false"
                  class="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100 text-gray-500">
                  Auto model
                </button>
                <template x-for="opt in (providerModels['${p.id}'] || []).filter(o => !providerState['${p.id}'].modelQuery || o.label.toLowerCase().includes(providerState['${p.id}'].modelQuery.toLowerCase()) || o.value.toLowerCase().includes(providerState['${p.id}'].modelQuery.toLowerCase()))" :key="opt.value">
                  <button type="button"
                    @click="providerState['${p.id}'].selectedModel = opt.value; providerState['${p.id}'].modelQuery = opt.label; providerState['${p.id}'].showModelDropdown = false"
                    class="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100 text-gray-800"
                    x-text="opt.label">
                  </button>
                </template>
              </div>
            </div>
            <template x-if="!providerState['${p.id}']?.authMethods?.length">
              <button type="button" @click="providerState['${p.id}']?.userConnected ? disconnectProvider('${p.id}') : connectProvider('${p.id}')"
                class="px-3 py-1.5 text-xs font-medium rounded-lg transition-all"
                :class="providerState['${p.id}']?.userConnected ? 'bg-red-100 text-red-700 hover:bg-red-200' : 'bg-slate-100 text-slate-800 hover:bg-slate-200'"
                x-text="providerState['${p.id}']?.userConnected ? 'Disconnect' : 'Connect'">
              </button>
            </template>
            <button type="button" @click="uninstallProvider('${p.id}')"
              title="Remove ${escapeHtml(p.name)}"
              class="p-1.5 text-xs rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-all">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
            </button>
          </div>
        </div>
        ${renderProviderAuthFlow(p)}
      </div>`
    )
    .join("");

  return `
      <!-- Model Selection -->
      <div class="bg-gray-50 rounded-lg p-3">
        <h3 class="flex items-center gap-2 text-sm font-medium text-gray-800 cursor-pointer select-none" @click="toggleSection('model')">
          <span>&#129302;</span>
          Models
          <span class="ml-auto text-xs text-gray-400 transition-transform" :class="openSections.model ? '' : 'rotate-[-90deg]'">&#9660;</span>
        </h3>
        <div x-show="openSections.model" x-transition class="pt-3">
          <div id="provider-list">
          ${emptyState}
          ${providerCards}
          </div>

          ${renderProviderCatalog()}

          ${renderPendingProviderAuth()}
        </div>
      </div>`;
}

function renderProviderAuthFlow(p: ProviderMeta): string {
  const authTypes = p.supportedAuthTypes || [p.authType];
  const hasMultiAuth = authTypes.length > 1;
  const hasApiKey = authTypes.includes("api-key");
  const hasOAuth = authTypes.includes("oauth");
  const hasDeviceCode = authTypes.includes("device-code");

  let html = `<!-- Auth flow (${authTypes.join(", ")}) -->
        <div x-show="providerState['${p.id}']?.showAuthFlow" x-transition class="mt-3 pt-3 border-t border-gray-200">`;

  if (hasMultiAuth) {
    html += `
          <div class="flex gap-1 mb-3 border-b border-gray-200">`;
    for (const at of authTypes) {
      const label =
        at === "api-key"
          ? "API Key"
          : at === "device-code"
            ? "Device Auth"
            : "OAuth";
      html += `
            <button type="button" @click="providerState['${p.id}'].activeAuthTab = '${at}'"
              class="px-3 py-1.5 text-xs font-medium rounded-t-lg transition-all border-b-2 -mb-px"
              :class="providerState['${p.id}']?.activeAuthTab === '${at}' ? 'border-slate-600 text-slate-800 bg-white' : 'border-transparent text-gray-500 hover:text-gray-700'">${label}</button>`;
    }
    html += `
          </div>`;
  }

  if (hasOAuth) {
    const showCond = hasMultiAuth
      ? `providerState['${p.id}']?.activeAuthTab === 'oauth' && providerState['${p.id}']?.showCodeInput`
      : `providerState['${p.id}']?.showCodeInput`;
    html += `
						          <div x-show="${showCond}" x-transition>
						            <div class="mb-3 text-center">
						              <a :href="'/api/v1/oauth/providers/${p.id}/login'" target="_blank" class="inline-block px-4 py-2 text-xs font-medium rounded-lg bg-slate-600 text-white hover:bg-slate-700 transition-all">
						                Login with ${escapeHtml(p.name)}
						              </a>
						            </div>
						            <p class="text-xs text-gray-600 mb-2">Paste the authentication code from ${escapeHtml(p.name)}:</p>
						            <div class="flex gap-2">
						              <input type="text" x-model="providerState['${p.id}'].code" placeholder="CODE#STATE" class="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-xs font-mono focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none">
						              <button type="button" @click="submitOAuthCode('${p.id}')" class="px-3 py-2 text-xs font-medium rounded-lg bg-slate-600 text-white hover:bg-slate-700 transition-all">
						                Submit
						              </button>
						            </div>
						            <p class="text-xs text-gray-400 mt-1">Format: CODE#STATE (copy the entire code shown after login)</p>
						          </div>`;
  }

  if (hasDeviceCode) {
    const showCond = hasMultiAuth
      ? `providerState['${p.id}']?.activeAuthTab === 'device-code' && providerState['${p.id}']?.showDeviceCode`
      : `providerState['${p.id}']?.showDeviceCode`;
    html += `
          <div x-show="${showCond}" x-transition>
            <div class="text-center">
              <p class="text-xs text-gray-600 mb-2">Enter this code at the verification page:</p>
              <p class="text-2xl font-mono font-bold text-slate-800 mb-2" x-text="providerState['${p.id}']?.userCode || ''"></p>
              <a :href="providerState['${p.id}']?.verificationUrl || 'https://auth.openai.com/codex/device'" target="_blank" class="inline-block px-4 py-2 text-xs font-medium rounded-lg bg-slate-600 text-white hover:bg-slate-700 transition-all mb-2">
                Login
              </a>
              <p class="text-xs text-gray-400" x-text="providerState['${p.id}']?.pollStatus || 'Waiting for authorization...'"></p>
            </div>
          </div>`;
  }

  if (hasApiKey) {
    const showCond = hasMultiAuth
      ? `providerState['${p.id}']?.activeAuthTab === 'api-key'`
      : `providerState['${p.id}']?.showApiKeyInput`;
    html += `
          <div x-show="${showCond}" x-transition>
            <p class="text-xs text-gray-600 mb-2">${p.apiKeyInstructions}</p>
            <div class="flex gap-2">
              <input type="password" x-model="providerState['${p.id}'].apiKey" placeholder="${escapeHtml(p.apiKeyPlaceholder)}" class="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-xs font-mono focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none">
              <button type="button" @click="submitApiKey('${p.id}')" class="px-3 py-2 text-xs font-medium rounded-lg bg-slate-600 text-white hover:bg-slate-700 transition-all">
                Save
              </button>
            </div>
          </div>`;
  }

  html += `
        </div>`;
  return html;
}

function renderProviderCatalog(): string {
  return `
          <!-- Add Provider Catalog -->
          <div class="mt-3 pt-3 border-t border-gray-200" x-show="catalogProviders.length > 0">
            <div class="relative">
              <button type="button" @click="showCatalog = !showCatalog"
                class="w-full px-3 py-2 text-xs font-medium rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 transition-all flex items-center justify-center gap-2">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"/></svg>
                Add Provider
              </button>
              <div x-show="showCatalog" @click.away="showCatalog = false" x-transition
                class="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                <template x-for="cp in catalogProviders" :key="cp.id">
                  <div class="p-2 hover:bg-gray-50 cursor-pointer border-b border-gray-100 last:border-b-0"
                    @click="addProvider(cp.id)">
                    <div class="flex items-center gap-2">
                      <img :src="cp.iconUrl" :alt="cp.name" class="w-4 h-4 rounded">
                      <div class="flex-1 min-w-0">
                        <p class="text-xs font-medium text-gray-800" x-text="cp.name"></p>
                      </div>
                      <div class="flex flex-wrap gap-1 justify-end">
                        <template x-for="at in (cp.supportedAuthTypes || [cp.authType])" :key="at">
                          <span class="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded bg-gray-100 text-gray-400 border border-gray-100"
                            x-text="at"></span>
                        </template>
                      </div>
                    </div>
                  </div>
                </template>
              </div>
            </div>
          </div>`;
}

function renderPendingProviderAuth(): string {
  return `
          <!-- Pending Provider Auth (shown during add flow) -->
          <div x-show="pendingProvider" x-transition class="mt-3 pt-3 border-t border-gray-200">
            <div class="bg-white border border-slate-200 rounded-lg p-3">
              <div class="flex items-center justify-between mb-3">
                <div class="flex items-center gap-2">
                  <img :src="pendingProvider?.iconUrl || ''" :alt="pendingProvider?.name || ''" class="w-5 h-5 rounded">
                  <p class="text-sm font-medium text-gray-800" x-text="'Connect ' + (pendingProvider?.name || '')"></p>
                </div>
                <button type="button" @click="cancelPendingProvider()"
                  class="px-2 py-1 text-xs font-medium rounded-lg text-gray-500 hover:text-red-600 hover:bg-red-50 transition-all">
                  Cancel
                </button>
              </div>

              <!-- Tab bar for multi-auth pending providers -->
              <template x-if="pendingProvider && !pendingProvider.success && (pendingProvider.supportedAuthTypes || [pendingProvider.authType]).length > 1">
                <div class="flex gap-1 mb-3 border-b border-gray-200">
                  <template x-for="at in (pendingProvider.supportedAuthTypes || [pendingProvider.authType])" :key="at">
                    <button type="button" @click="providerState[pendingProvider.id].activeAuthTab = at; if (at !== 'api-key') connectProvider(pendingProvider.id)"
                      class="px-3 py-1.5 text-xs font-medium rounded-t-lg transition-all border-b-2 -mb-px"
                      :class="providerState[pendingProvider.id]?.activeAuthTab === at ? 'border-slate-600 text-slate-800 bg-white' : 'border-transparent text-gray-500 hover:text-gray-700'"
                      x-text="at">
                    </button>
                  </template>
                </div>
              </template>

              <!-- API Key input for pending provider -->
              <template x-if="pendingProvider && !pendingProvider.success && (providerState[pendingProvider.id]?.activeAuthTab === 'api-key' || ((pendingProvider.supportedAuthTypes || [pendingProvider.authType]).length === 1 && pendingProvider.authType === 'api-key'))">
                <div>
                  <p class="text-xs text-gray-600 mb-2" x-html="pendingProvider.apiKeyInstructions || 'Enter your API key:'"></p>
                  <div class="flex gap-2">
                    <input type="password" x-model="providerState[pendingProvider.id].apiKey" :placeholder="pendingProvider.apiKeyPlaceholder || 'API key'" class="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-xs font-mono focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none">
                    <button type="button" @click="submitApiKey(pendingProvider.id)" class="px-3 py-2 text-xs font-medium rounded-lg bg-slate-600 text-white hover:bg-slate-700 transition-all">
                      Save
                    </button>
                  </div>
                </div>
              </template>

              <!-- OAuth code input for pending provider -->
              <template x-if="pendingProvider && !pendingProvider.success && providerState[pendingProvider.id]?.activeAuthTab !== 'api-key' && (providerState[pendingProvider.id]?.showCodeInput || ((pendingProvider.supportedAuthTypes || [pendingProvider.authType]).length === 1 && pendingProvider.authType === 'oauth'))">
                <div>
                  <div class="mb-3 text-center">
                    <a :href="'/api/v1/oauth/providers/' + pendingProvider.id + '/login'" target="_blank" class="inline-block px-4 py-2 text-xs font-medium rounded-lg bg-slate-600 text-white hover:bg-slate-700 transition-all" x-text="'Login with ' + pendingProvider.name">
                    </a>
                  </div>
                  <p class="text-xs text-gray-600 mb-2" x-text="'Paste the authentication code from ' + pendingProvider.name + ':'"></p>
                  <div class="flex gap-2">
                    <input type="text" x-model="providerState[pendingProvider.id].code" placeholder="CODE#STATE" class="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-xs font-mono focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none">
                    <button type="button" @click="submitOAuthCode(pendingProvider.id)" class="px-3 py-2 text-xs font-medium rounded-lg bg-slate-600 text-white hover:bg-slate-700 transition-all">
                      Submit
                    </button>
                  </div>
                  <p class="text-xs text-gray-400 mt-1">Format: CODE#STATE (copy the entire code shown after login)</p>
                </div>
              </template>

              <!-- Device code flow for pending provider -->
              <template x-if="pendingProvider && !pendingProvider.success && providerState[pendingProvider.id]?.activeAuthTab !== 'api-key' && (providerState[pendingProvider.id]?.showDeviceCode || ((pendingProvider.supportedAuthTypes || [pendingProvider.authType]).length === 1 && pendingProvider.authType === 'device-code'))">
                <div class="text-center">
                  <p class="text-xs text-gray-600 mb-2">Enter this code at the verification page:</p>
                  <p class="text-2xl font-mono font-bold text-slate-800 mb-2" x-text="providerState[pendingProvider.id].userCode || ''"></p>
                  <a :href="providerState[pendingProvider.id].verificationUrl || '#'" target="_blank" class="inline-block px-4 py-2 text-xs font-medium rounded-lg bg-slate-600 text-white hover:bg-slate-700 transition-all mb-2">
                    Login
                  </a>
                  <p class="text-xs text-gray-400" x-text="providerState[pendingProvider.id].pollStatus || 'Waiting for authorization...'"></p>
                </div>
              </template>

              <!-- Success state for pending provider -->
              <template x-if="pendingProvider?.success">
                <div class="text-center py-4">
                  <svg class="w-8 h-8 mx-auto text-emerald-500 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
                  </svg>
                  <p class="text-sm font-medium text-emerald-700">Connected!</p>
                </div>
              </template>
            </div>
          </div>`;
}

// ─── Instructions Section ───────────────────────────────────────────────────

export function renderInstructionsSection(): string {
  return `
      <!-- Instructions -->
      <div class="bg-gray-50 rounded-lg p-3">
        <h3 class="flex items-center gap-2 text-sm font-medium text-gray-800 cursor-pointer select-none" @click="toggleSection('instructions')">
          <span>&#128220;</span>
          Instructions
          <span class="ml-auto text-xs text-gray-400 transition-transform" :class="openSections.instructions ? '' : 'rotate-[-90deg]'">&#9660;</span>
        </h3>
        <div x-show="openSections.instructions" x-transition class="pt-3 space-y-3">
          <div>
            <label class="block text-xs font-medium text-gray-700 mb-1">IDENTITY.md <span class="text-gray-400">- Who the agent is</span></label>
            <textarea id="identityMd" name="identityMd" x-model="identityMd" placeholder="You are a helpful coding assistant named Alex.&#10;You specialize in TypeScript and React development." class="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs font-mono min-h-[60px] resize-y focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none"></textarea>
          </div>
          <div>
            <label class="block text-xs font-medium text-gray-700 mb-1">SOUL.md <span class="text-gray-400">- Behavior rules &amp; instructions</span></label>
            <textarea id="soulMd" name="soulMd" x-model="soulMd" placeholder="Always write tests before implementation.&#10;Prefer functional programming patterns.&#10;Never commit directly to main branch." class="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs font-mono min-h-[80px] resize-y focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none"></textarea>
          </div>
          <div>
            <label class="block text-xs font-medium text-gray-700 mb-1">USER.md <span class="text-gray-400">- User-specific context</span></label>
            <textarea id="userMd" name="userMd" x-model="userMd" placeholder="The user prefers concise responses.&#10;Their timezone is UTC+3.&#10;They use VS Code as their IDE." class="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs font-mono min-h-[60px] resize-y focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none"></textarea>
          </div>
        </div>
      </div>`;
}

// ─── Skills and MCP Section ─────────────────────────────────────────────────

export function renderIntegrationsSection(): string {
  return `
      <!-- Skills and MCP Section -->
      <div class="bg-gray-50 rounded-lg p-3">
        <h3 class="flex items-center gap-2 text-sm font-medium text-gray-800 cursor-pointer select-none" @click="toggleSection('integrations')">
          <span>&#128268;</span>
          Skills and MCP
          <span x-show="skillsLoading || mcpsLoading" class="animate-spin text-slate-600">&#8635;</span>
          <span x-show="skills.length + mcpServerIds.length > 0" class="text-xs text-gray-400" x-text="'(' + (skills.length + mcpServerIds.length) + ')'"></span>
          <span class="ml-auto text-xs text-gray-400 transition-transform" :class="openSections.integrations ? '' : 'rotate-[-90deg]'">&#9660;</span>
        </h3>
        <div x-show="openSections.integrations" x-transition class="pt-3 space-y-3">

          <!-- Errors -->
          <div x-show="skillsError" x-transition class="bg-red-100 text-red-800 px-3 py-2 rounded-lg text-xs" x-text="skillsError"></div>
          <div x-show="mcpsError" x-transition class="bg-red-100 text-red-800 px-3 py-2 rounded-lg text-xs" x-text="mcpsError"></div>

          <!-- Installed Skills and MCP List -->
          <div class="space-y-2">
            <template x-if="skills.length === 0 && mcpServerIds.length === 0">
              <p class="text-xs text-gray-500">No skills or MCP servers configured yet.</p>
            </template>
            <template x-for="skill in skills" :key="'skill-' + skill.repo">
              <div class="flex items-center justify-between p-2 bg-white rounded border border-gray-100">
                <div class="flex items-center gap-2 flex-1 min-w-0">
                  <span class="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 shrink-0">skill</span>
                  <div class="min-w-0">
                    <a :href="'https://clawhub.ai/skills/' + encodeURIComponent(skill.repo)" target="_blank" class="text-xs font-medium text-slate-700 hover:text-slate-900 hover:underline truncate block" x-text="skill.name"></a>
                    <p x-show="skill.description" class="text-xs text-gray-500 truncate" x-text="skill.description"></p>
                  </div>
                </div>
                <div class="flex items-center gap-2 ml-2 flex-shrink-0">
                  <button type="button" @click="toggleSkill(skill.repo)"
                    class="px-2 py-1 text-xs rounded"
                    :class="skill.enabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'"
                    x-text="skill.enabled ? 'Enabled' : 'Disabled'"></button>
                  <button type="button" @click="removeSkill(skill.repo)" class="px-2 py-1 text-xs rounded bg-red-100 text-red-700 hover:bg-red-200">Remove</button>
                </div>
              </div>
            </template>
            <template x-for="mcpId in mcpServerIds" :key="'mcp-' + mcpId">
              <div class="flex items-center justify-between p-2 bg-white rounded border border-gray-100">
                <div class="flex items-center gap-2 flex-1 min-w-0">
                  <span class="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 shrink-0">mcp</span>
                  <div class="min-w-0">
                    <p class="text-xs font-medium text-gray-800 truncate" x-text="mcpId"></p>
                    <p x-show="getMcpDescription(mcpId)" class="text-xs text-gray-500 truncate" x-text="getMcpDescription(mcpId)"></p>
                  </div>
                </div>
                <div class="flex items-center gap-2 ml-2 flex-shrink-0">
                  <button type="button" @click="toggleMcp(mcpId)"
                    class="px-2 py-1 text-xs rounded"
                    :class="mcpServers[mcpId]?.enabled !== false ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'"
                    x-text="mcpServers[mcpId]?.enabled !== false ? 'Enabled' : 'Disabled'"></button>
                  <button type="button" @click="removeMcp(mcpId)" class="px-2 py-1 text-xs rounded bg-red-100 text-red-700 hover:bg-red-200">Remove</button>
                </div>
              </div>
            </template>
          </div>

          <!-- Unified Search -->
          <div class="border-t border-gray-100 pt-2">
            <div class="relative mb-2">
              <input type="text" x-model="integrationSearch" @input.debounce.300ms="searchIntegrations()" @focus="if (integrationSearch.trim() && !integrationSearch.trim().startsWith('http') && !integrationSearch.trim().includes('://')) integrationSearchVisible = true" placeholder="Search skills/MCP or paste MCP URL..." class="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none">
              <div x-show="integrationSearchVisible" @click.away="integrationSearchVisible = false" class="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                <template x-for="result in integrationSearchResults" :key="result.type + '-' + result.id">
                  <div class="p-2 hover:bg-gray-50 cursor-pointer border-b border-gray-100 last:border-b-0" @click="addIntegrationFromSearch(result)">
                    <div class="flex items-center justify-between">
                      <div class="flex items-center gap-2 flex-1 min-w-0">
                        <span class="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded shrink-0" :class="result.type === 'skill' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'" x-text="result.type"></span>
                        <div class="min-w-0">
                          <p class="text-xs font-medium text-gray-800 truncate" x-text="result.name"></p>
                          <p x-show="result.description" class="text-xs text-gray-500 truncate" x-text="result.description"></p>
                        </div>
                      </div>
                      <div class="flex items-center gap-2 ml-2">
                        <span x-show="result.type === 'skill' && result.installs" class="text-xs text-gray-400" x-text="formatInstalls(result.installs)"></span>
                        <span class="text-xs" :class="isIntegrationAdded(result) ? 'text-green-600' : 'text-slate-600'" x-text="isIntegrationAdded(result) ? 'Added' : '+ Add'"></span>
                      </div>
                    </div>
                  </div>
                </template>
                <template x-if="integrationSearchResults.length === 0 && integrationSearchVisible">
                  <div class="p-2 text-xs text-gray-500">No skills or MCP servers found</div>
                </template>
              </div>
            </div>

            <!-- Curated Chips (only when no integrations exist) -->
            <div class="mb-2" x-show="skills.length === 0 && mcpServerIds.length === 0">
              <div class="flex flex-wrap gap-1">
                <template x-for="cs in curatedSkills" :key="'cs-' + cs.repo">
                  <button type="button" @click="addSkillFromChip(cs.repo)"
                    class="px-2 py-1 text-xs rounded-full bg-purple-50 text-slate-800 border border-purple-200"
                    :class="skills.some(function(sk) { return sk.repo === cs.repo }) ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-purple-100'"
                    :disabled="skills.some(function(sk) { return sk.repo === cs.repo })"
                    :title="skills.some(function(sk) { return sk.repo === cs.repo }) ? 'Already added' : cs.description"
                    x-text="cs.name"></button>
                </template>
                <template x-for="cm in curatedMcps" :key="'cm-' + cm.id">
                  <button type="button" @click="addMcpFromChip(cm.id)"
                    class="px-2 py-1 text-xs rounded-full bg-blue-50 text-slate-800 border border-blue-200"
                    :class="mcpServers.hasOwnProperty(cm.id) ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-blue-100'"
                    :disabled="mcpServers.hasOwnProperty(cm.id)"
                    :title="mcpServers.hasOwnProperty(cm.id) ? 'Already added' : cm.description"
                    x-text="cm.name"></button>
                </template>
              </div>
            </div>

            <p class="text-xs text-gray-400 mt-1">Extend your agent with <a href="https://clawhub.ai/skills" target="_blank" class="text-blue-600 hover:underline">skills from ClawHub</a> and MCP servers.</p>
          </div>

        </div>
      </div>`;
}

// ─── Scheduled Reminders Section ────────────────────────────────────────────

export function renderRemindersSection(): string {
  return `
      <!-- Scheduled Reminders Section -->
      <div class="bg-gray-50 rounded-lg p-3">
        <h3 class="flex items-center gap-2 text-sm font-medium text-gray-800 cursor-pointer select-none" @click="toggleSection('reminders')">
          <span>&#9200;</span>
          Scheduled Reminders
          <span x-show="schedulesLoading" class="animate-spin text-slate-600">&#8635;</span>
          <span class="ml-auto text-xs text-gray-400 transition-transform" :class="openSections.reminders ? '' : 'rotate-[-90deg]'">&#9660;</span>
        </h3>
        <div x-show="openSections.reminders" x-transition class="pt-3">
          <div x-show="schedulesError" x-transition class="bg-red-100 text-red-800 px-3 py-2 rounded-lg text-xs mb-2" x-text="schedulesError"></div>
          <div class="space-y-2">
            <template x-if="schedules.length === 0">
              <p class="text-xs text-gray-500">No scheduled reminders.</p>
            </template>
            <template x-for="schedule in schedules" :key="schedule.scheduleId">
              <div class="flex items-start justify-between p-2 bg-white rounded border border-gray-200">
                <div class="flex-1 min-w-0">
                  <p class="text-xs font-medium text-gray-800 truncate" :title="schedule.task" x-text="truncateText(schedule.task, 60)"></p>
                  <p class="text-xs text-gray-500">
                    <span class="inline-block px-1.5 py-0.5 rounded text-xs"
                      :class="schedule.status === 'pending' ? 'bg-slate-100 text-slate-800' : schedule.status === 'triggered' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'"
                      x-text="schedule.status"></span>
                    <template x-if="schedule.isRecurring && schedule.cron">
                      <span class="inline-block px-1.5 py-0.5 rounded text-xs bg-blue-100 text-blue-800 ml-1" :title="'Cron: ' + schedule.cron" x-text="'&#128260; ' + schedule.iteration + '/' + schedule.maxIterations"></span>
                    </template>
                    <span :title="new Date(schedule.scheduledFor).toLocaleString()" class="ml-1" x-text="formatTimeRemaining(schedule.scheduledFor)"></span>
                    <template x-if="schedule.isRecurring && schedule.cron">
                      <span class="text-gray-400 ml-1" x-text="'(' + schedule.cron + ')'"></span>
                    </template>
                  </p>
                </div>
                <template x-if="schedule.status === 'pending'">
                  <button type="button" @click="cancelSchedule(schedule.scheduleId)" class="ml-2 px-2 py-1 text-xs rounded bg-red-100 text-red-700 hover:bg-red-200 flex-shrink-0">Cancel</button>
                </template>
              </div>
            </template>
          </div>
          <div class="mt-3 pt-3 border-t border-gray-200">
            <p class="text-xs font-medium text-gray-600 mb-1">Example prompts:</p>
            <p class="text-xs text-gray-500 mb-1 font-medium">One-time:</p>
            <ul class="text-xs text-gray-500 space-y-1 mb-2">
              <li>&bull; "Remind me in 30 minutes to check the build status"</li>
              <li>&bull; "Set a reminder for 2 hours from now to review the PR"</li>
            </ul>
            <p class="text-xs text-gray-500 mb-1 font-medium">Recurring:</p>
            <ul class="text-xs text-gray-500 space-y-1">
              <li>&bull; "Check the API status every 30 minutes for the next 2 hours"</li>
              <li>&bull; "Poll the deployment health every hour until it succeeds (max 12 checks)"</li>
              <li>&bull; "Send me a morning standup reminder at 9am on weekdays"</li>
            </ul>
            <p class="text-xs text-gray-400 mt-2">One-time: max 24 hours. Recurring: min 5 min interval, max 100 iterations.</p>
          </div>
        </div>
      </div>`;
}

// ─── Permissions Section ────────────────────────────────────────────────────

export function renderPermissionsSection(): string {
  return `
      <!-- Permissions (unified domains + MCP tool grants) -->
      <div class="bg-gray-50 rounded-lg p-3" x-data="permissionsSection()">
        <h3 class="flex items-center gap-2 text-sm font-medium text-gray-800 cursor-pointer select-none" @click="toggleSection('permissions')">
          <span>&#128274;</span>
          Permissions
          <span class="ml-auto text-xs text-gray-400 transition-transform" :class="openSections.permissions ? '' : 'rotate-[-90deg]'">&#9660;</span>
        </h3>
        <div x-show="openSections.permissions" x-transition class="pt-3 space-y-2">
          <!-- Permission list -->
          <template x-if="permissionItems.length === 0 && !permissionsLoading">
            <p class="text-xs text-gray-500">No permissions configured yet. The agent will ask for confirmation before using browser tools, accessing online data, or running destructive MCP actions.</p>
          </template>
          <template x-if="permissionsLoading">
            <p class="text-xs text-gray-400">Loading...</p>
          </template>
          <template x-for="(item, idx) in permissionItems" :key="item.pattern + item.type">
            <div class="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-1.5">
              <span class="flex-1 text-xs font-mono text-gray-800 truncate" :title="item.pattern" x-text="item.pattern"></span>
              <span class="text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap"
                :class="badgeClass(item)"
                x-text="badgeText(item)"></span>
              <button type="button" @click="removePermission(item)" class="text-gray-400 hover:text-red-500 transition-colors" title="Remove">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
              </button>
            </div>
          </template>

          <!-- Add permission form -->
          <div class="mt-2 border border-dashed border-gray-300 rounded-lg p-2 space-y-2" x-show="showAddForm">
            <div>
              <input type="text" x-model="newPattern" placeholder="e.g. api.openai.com, /mcp/gmail/tools/*" class="w-full px-2 py-1.5 border border-gray-200 rounded text-xs font-mono focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none">
            </div>
            <div class="flex items-center gap-3 text-xs">
              <label class="flex items-center gap-1 cursor-pointer"><input type="radio" x-model="newAccess" value="always" class="accent-slate-700"> Always</label>
              <label class="flex items-center gap-1 cursor-pointer"><input type="radio" x-model="newAccess" value="1h" class="accent-slate-700"> 1 hour</label>
              <label class="flex items-center gap-1 cursor-pointer"><input type="radio" x-model="newAccess" value="session" class="accent-slate-700"> Session</label>
              <label class="flex items-center gap-1 cursor-pointer"><input type="radio" x-model="newAccess" value="denied" class="accent-slate-700"> Denied</label>
            </div>
            <div class="flex gap-2">
              <button type="button" @click="addPermission()" :disabled="!newPattern.trim()" class="px-3 py-1 text-xs font-medium rounded bg-slate-700 text-white hover:bg-slate-800 disabled:opacity-40 transition-all">Add</button>
              <button type="button" @click="showAddForm = false" class="px-3 py-1 text-xs font-medium rounded border border-gray-300 text-gray-600 hover:bg-gray-100 transition-all">Cancel</button>
            </div>
          </div>
          <button type="button" x-show="!showAddForm" @click="showAddForm = true; newAccess = '1h'" class="text-xs text-slate-600 hover:text-slate-800 font-medium">+ Add permission</button>
        </div>
      </div>`;
}

// ─── Nix Packages Section ───────────────────────────────────────────────────

export function renderNixPackagesSection(): string {
  return `
      <!-- System Packages -->
      <div class="bg-gray-50 rounded-lg p-3">
        <h3 class="flex items-center gap-2 text-sm font-medium text-gray-800 cursor-pointer select-none" @click="toggleSection('packages')">
          <span>&#128230;</span>
          System Packages
          <span class="ml-auto text-xs text-gray-400 transition-transform" :class="openSections.packages ? '' : 'rotate-[-90deg]'">&#9660;</span>
        </h3>
        <div x-show="openSections.packages" x-transition class="pt-3 space-y-3">
          <template x-if="nixPackages.length === 0">
            <p class="text-xs text-gray-400 italic">No packages added.</p>
          </template>
          <template x-for="pkg in nixPackages" :key="pkg">
            <div class="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-1.5">
              <span class="flex-1 text-xs font-mono text-gray-800 break-all" x-text="pkg"></span>
              <button type="button" @click="removeNixPackage(pkg)" class="text-xs font-medium text-red-600 hover:text-red-700 transition-colors" title="Uninstall package">
                Uninstall
              </button>
            </div>
          </template>

          <div class="relative">
            <input
              id="nixPackageSearch"
              type="text"
              x-model="nixPackageQuery"
              @input.debounce.300ms="searchNixPackages()"
              @focus="if (nixPackageQuery.trim()) nixPackageSuggestionsVisible = true"
              @keydown.enter.prevent="addNixPackageFromQuery()"
              placeholder="Search Nix packages (e.g. python311)"
              class="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs font-mono focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none"
            >

            <div x-show="nixPackageSuggestionsVisible" @click.away="nixPackageSuggestionsVisible = false" class="absolute z-10 left-2 right-2 mt-0.5 bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
              <template x-if="nixPackageSearchLoading">
                <div class="px-3 py-2 text-xs text-gray-500">Searching packages...</div>
              </template>
              <template x-for="suggestion in nixPackageSuggestions" :key="suggestion.name">
                <button type="button" @click="addNixPackage(suggestion.name)" class="w-full text-left px-3 py-2 border-b border-gray-100 last:border-b-0 hover:bg-slate-50 transition-colors">
                  <div class="text-xs font-mono text-gray-800" x-text="suggestion.name"></div>
                  <div class="text-[11px] text-gray-500 truncate" x-text="suggestion.description || suggestion.pname || ''"></div>
                </button>
              </template>
              <template x-if="!nixPackageSearchLoading && nixPackageQuery.trim() && nixPackageSuggestions.length === 0">
                <div class="px-3 py-2 text-xs text-gray-500">No matching packages.</div>
              </template>
            </div>
          </div>
          <p class="text-xs text-gray-400 mt-1">Install system tools from <a href="https://search.nixos.org/packages" target="_blank" class="text-blue-600 hover:underline">Nix Packages</a> to make them available in your workspace.</p>
        </div>
      </div>`;
}

// ─── Secrets Section ────────────────────────────────────────────────────────

export function renderSecretsSection(): string {
  return `
      <!-- Secrets -->
      <div class="bg-gray-50 rounded-lg p-3">
        <h3 class="flex items-center gap-2 text-sm font-medium text-gray-800 cursor-pointer select-none" @click="toggleSection('envvars')">
          <span>&#128203;</span>
          Secrets
          <span class="ml-auto text-xs text-gray-400 transition-transform" :class="openSections.envvars ? '' : 'rotate-[-90deg]'">&#9660;</span>
        </h3>
        <div x-show="openSections.envvars" x-transition class="pt-3 space-y-2">
          <template x-if="secrets.length === 0">
            <p class="text-xs text-gray-400 italic">No secrets configured.</p>
          </template>
          <template x-for="(secret, idx) in secrets" :key="secret.id">
            <div class="bg-white border border-gray-200 rounded-lg p-2">
              <div class="flex items-center gap-2">
                <input
                  type="text"
                  x-model="secret.key"
                  placeholder="API_KEY"
                  class="w-40 px-2 py-1.5 border border-gray-200 rounded text-xs font-mono focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none"
                >
                <span class="text-xs font-mono text-gray-500 select-none">=</span>
                <input
                  :type="secret.reveal ? 'text' : 'password'"
                  @focus="secret.reveal = true"
                  @blur="secret.reveal = false"
                  x-model="secret.value"
                  placeholder="secret value"
                  class="flex-1 px-2 py-1.5 border border-gray-200 rounded text-xs font-mono focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none"
                  autocomplete="new-password"
                >
                <button
                  type="button"
                  @click="removeSecret(secret.id)"
                  class="px-2.5 py-1.5 text-xs font-medium bg-transparent border-0 text-red-700 hover:text-red-800 transition-colors"
                >
                  Remove
                </button>
              </div>
            </div>
          </template>
          <button
            type="button"
            @click="addSecret('', '')"
            class="text-xs text-slate-600 hover:text-slate-800 font-medium"
          >
            + Add secret
          </button>
        </div>
      </div>`;
}

// ─── Verbose Logging Section ────────────────────────────────────────────────

export function renderVerboseLoggingSection(): string {
  return `
      <!-- Verbose Logging -->
      <div class="bg-gray-50 rounded-lg p-3">
        <label class="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" id="verboseLogging" name="verboseLogging" x-model="verboseLogging" class="w-4 h-4 text-slate-600 rounded focus:ring-slate-500">
          <span class="text-sm font-medium text-gray-800">Verbose logging</span>
        </label>
        <p class="text-xs text-gray-500 mt-1 ml-6">Show tool calls, reasoning tokens, and detailed output</p>
      </div>`;
}

// ─── Submit Button ──────────────────────────────────────────────────────────

export function renderSubmitButton(): string {
  return `
      <button type="submit" :disabled="saving || !hasPendingSettingsChanges()"
        class="w-full py-3 bg-gradient-to-r from-slate-700 to-slate-800 text-white text-sm font-semibold rounded-lg hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0 transition-all disabled:opacity-60 disabled:cursor-not-allowed disabled:transform-none"
        x-text="saving ? 'Saving...' : (hasPendingSettingsChanges() ? 'Save Settings' : 'No Changes')">
      </button>`;
}
