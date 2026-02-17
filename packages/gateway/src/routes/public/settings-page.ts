/**
 * Settings Page HTML Templates (Tailwind CSS)
 */

import type { AgentSettings } from "../../auth/settings";
import type { SettingsTokenPayload } from "../../auth/settings/token-service";
import { platformRegistry } from "../../platform";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Format userId for display - handles phone numbers and platform-specific IDs
 */
function formatUserId(userId: string): string {
  // If it looks like a phone number (starts with +), show as-is
  if (userId.startsWith("+")) {
    return userId;
  }
  // If it's a JID-style format (contains @), show a friendlier format
  if (userId.includes("@")) {
    const parts = userId.split("@");
    const id = parts[0] || "";
    const domain = parts[1] || "";
    // Handle linked IDs (very long internal IDs)
    if (domain === "lid") {
      return `ID: ${id.slice(0, 8)}...`;
    }
    // Handle phone number JIDs
    if (domain === "s.whatsapp.net") {
      return `+${id}`;
    }
    return userId;
  }
  return userId;
}

/**
 * Get platform display info from the registry, with fallback for unknown platforms
 */
function getPlatformDisplay(platform: string): { icon: string; name: string } {
  // Try to get display info from the platform adapter
  const adapter = platformRegistry.get(platform);
  if (adapter?.getDisplayInfo) {
    const info = adapter.getDisplayInfo();
    // Wrap the icon SVG with proper sizing class
    const icon = info.icon.includes('class="')
      ? info.icon.replace('class="', 'class="w-4 h-4 inline-block ')
      : info.icon.replace("<svg", '<svg class="w-4 h-4 inline-block"');
    return { icon, name: info.name };
  }

  // Fallback for unknown platforms
  return {
    icon: '<svg class="w-4 h-4 inline-block" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/></svg>',
    name: platform || "API",
  };
}

export interface ProviderMeta {
  id: string;
  name: string;
  iconUrl: string;
  authType: "oauth" | "device-code" | "api-key";
  apiKeyInstructions: string;
  apiKeyPlaceholder: string;
}

export interface GitHubOptions {
  githubAppConfigured: boolean;
  githubAppInstallUrl?: string;
  githubOAuthConfigured?: boolean;
  providers?: ProviderMeta[];
}

export function renderSettingsPage(
  payload: SettingsTokenPayload,
  settings: AgentSettings | null,
  token: string,
  options?: GitHubOptions
): string {
  const s: Partial<AgentSettings> = settings || {};
  const githubAppConfigured = options?.githubAppConfigured ?? false;
  const githubAppInstallUrl = options?.githubAppInstallUrl ?? "";
  const githubOAuthConfigured = options?.githubOAuthConfigured ?? false;
  const providers: ProviderMeta[] = options?.providers ?? [
    {
      id: "claude",
      name: "Claude",
      iconUrl: "https://www.anthropic.com/favicon.ico",
      authType: "oauth",
      apiKeyInstructions: "",
      apiKeyPlaceholder: "",
    },
    {
      id: "chatgpt",
      name: "ChatGPT",
      iconUrl: "https://chatgpt.com/favicon.ico",
      authType: "device-code",
      apiKeyInstructions: "",
      apiKeyPlaceholder: "",
    },
  ];

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Agent Settings - Lobu</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="min-h-screen bg-gradient-to-br from-slate-700 to-slate-900 p-4">
  <div class="max-w-xl mx-auto bg-white rounded-2xl shadow-2xl p-6">
    <div class="text-center mb-5">
      <div class="text-4xl mb-1">🦞</div>
      <h1 class="text-xl font-bold text-slate-900">Agent Settings</h1>
      <p class="text-xs text-gray-500">${getPlatformDisplay(payload.platform).icon} ${escapeHtml(formatUserId(payload.userId))}</p>
    </div>

    <div id="success-msg" class="hidden bg-green-100 text-green-800 px-3 py-2 rounded-lg mb-4 text-center text-sm">
      Settings saved!
    </div>
    <div id="error-msg" class="hidden bg-red-100 text-red-800 px-3 py-2 rounded-lg mb-4 text-center text-sm"></div>
    ${
      payload.message
        ? `<div class="bg-blue-50 border border-blue-200 text-blue-800 px-4 py-3 rounded-lg mb-4 text-sm">
      <div class="flex items-start gap-2">
        <span class="text-lg">💡</span>
        <div>${escapeHtml(payload.message)}</div>
      </div>
    </div>`
        : ""
    }
    ${
      payload.prefillSkills?.length || payload.prefillMcpServers?.length
        ? `<!-- Suggested Additions Section -->
    <div class="bg-slate-50 border border-slate-200 rounded-lg p-4 mb-4">
      <h3 class="text-sm font-medium text-slate-900 mb-3 flex items-center gap-2">
        <span>⚡</span> Quick Setup
      </h3>
      ${
        payload.prefillSkills?.length
          ? `<div class="mb-3">
        <p class="text-xs font-medium text-slate-800 mb-2">Suggested Skills:</p>
        <div id="prefill-skills-list" class="space-y-2">
          ${payload.prefillSkills
            .map(
              (skill, idx) => `
          <div class="flex items-center justify-between bg-white rounded-lg p-2 border border-slate-200" id="prefill-skill-${idx}">
            <div class="flex-1 min-w-0">
              <p class="text-xs font-medium text-gray-800">${escapeHtml(skill.name || skill.repo)}</p>
              ${skill.description ? `<p class="text-xs text-gray-500 truncate">${escapeHtml(skill.description)}</p>` : ""}
              <p class="text-xs text-gray-400 font-mono">${escapeHtml(skill.repo)}</p>
            </div>
            <button type="button" onclick="addPrefillSkill(${idx})" class="ml-2 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-600 text-white hover:bg-slate-700 transition-all flex-shrink-0">
              Add
            </button>
          </div>`
            )
            .join("")}
        </div>
      </div>`
          : ""
      }
      ${
        payload.prefillMcpServers?.length
          ? `<div>
        <p class="text-xs font-medium text-slate-800 mb-2">Suggested External Integrations (MCP):</p>
        <div id="prefill-mcp-list" class="space-y-2">
          ${payload.prefillMcpServers
            .map(
              (mcp, idx) => `
          <div class="flex items-center justify-between bg-white rounded-lg p-2 border border-slate-200" id="prefill-mcp-${idx}">
            <div class="flex-1 min-w-0">
              <p class="text-xs font-medium text-gray-800">${escapeHtml(mcp.name || mcp.id)}</p>
              ${mcp.url ? `<p class="text-xs text-gray-500 truncate">${escapeHtml(mcp.url)}</p>` : ""}
              ${mcp.command ? `<p class="text-xs text-gray-400 font-mono">${escapeHtml(mcp.command)} ${(mcp.args || []).join(" ")}</p>` : ""}
              ${mcp.envVars?.length ? `<p class="text-xs text-slate-600">Requires: ${mcp.envVars.join(", ")}</p>` : ""}
            </div>
            <button type="button" onclick="addPrefillMcp(${idx})" class="ml-2 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-600 text-white hover:bg-slate-700 transition-all flex-shrink-0">
              Add
            </button>
          </div>`
            )
            .join("")}
        </div>
      </div>`
          : ""
      }
    </div>`
        : ""
    }

    <form id="settings-form" class="space-y-3">
      <!-- Model Selection -->
      <div class="bg-gray-50 rounded-lg p-3">
        <h3 class="flex items-center gap-2 text-sm font-medium text-gray-800 cursor-pointer select-none" onclick="toggleSection(this)">
          <span>&#129302;</span>
          Model
          <span class="ml-auto text-xs text-gray-400 transition-transform rotate-[-90deg]" id="model-arrow">&#9660;</span>
        </h3>
        <div id="model-content" class="hidden pt-3">
          ${providers
            .map(
              (p, i) => `
      <div class="${i > 0 ? "mt-3 pt-3 border-t border-gray-200" : ""}">
        <div class="flex items-center justify-between" id="provider-${p.id}">
          <div class="flex items-center gap-3">
            <img src="${escapeHtml(p.iconUrl)}" alt="${escapeHtml(p.name)}" class="w-5 h-5 rounded">
            <div>
              <p class="text-sm font-medium text-gray-800">${escapeHtml(p.name)}</p>
              <p class="text-xs text-gray-500" id="${p.id}-status">Checking...</p>
            </div>
          </div>
          <button type="button" id="${p.id}-auth-btn" class="px-3 py-1.5 text-xs font-medium rounded-lg transition-all bg-slate-100 text-slate-800 hover:bg-slate-200">
            Connect
          </button>
        </div>
        ${
          p.authType === "oauth"
            ? `<!-- Code input (hidden by default) -->
        <div id="${p.id}-code-input" class="hidden mt-3 pt-3 border-t border-gray-200">
          <p class="text-xs text-gray-600 mb-2">Paste the authentication code from ${escapeHtml(p.name)}:</p>
          <div class="flex gap-2">
            <input type="text" id="${p.id}-auth-code" placeholder="CODE#STATE" class="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-xs font-mono focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none">
            <button type="button" id="${p.id}-submit-code" class="px-3 py-2 text-xs font-medium rounded-lg bg-slate-600 text-white hover:bg-slate-700 transition-all">
              Submit
            </button>
          </div>
          <p class="text-xs text-gray-400 mt-1">Format: CODE#STATE (copy the entire code shown after login)</p>
        </div>`
            : ""
        }
        ${
          p.authType === "device-code"
            ? `<!-- Device code flow (hidden by default) -->
        <div id="${p.id}-device-code" class="hidden mt-3 pt-3 border-t border-gray-200">
          <div class="text-center">
            <p class="text-xs text-gray-600 mb-2">Enter this code at the verification page:</p>
            <p class="text-2xl font-mono font-bold text-slate-800 mb-2" id="${p.id}-user-code"></p>
            <a id="${p.id}-verify-link" href="https://auth.openai.com/codex/device" target="_blank" class="inline-block px-4 py-2 text-xs font-medium rounded-lg bg-slate-600 text-white hover:bg-slate-700 transition-all mb-2">
              Open Verification Page
            </a>
            <p class="text-xs text-gray-400" id="${p.id}-poll-status">Waiting for authorization...</p>
          </div>
        </div>`
            : ""
        }
        ${
          p.authType === "api-key"
            ? `<!-- API key input (hidden by default) -->
        <div id="${p.id}-api-key-input" class="hidden mt-3 pt-3 border-t border-gray-200">
          <p class="text-xs text-gray-600 mb-2">${p.apiKeyInstructions}</p>
          <div class="flex gap-2">
            <input type="password" id="${p.id}-api-key" placeholder="${escapeHtml(p.apiKeyPlaceholder)}" class="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-xs font-mono focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none">
            <button type="button" id="${p.id}-save-key" class="px-3 py-2 text-xs font-medium rounded-lg bg-slate-600 text-white hover:bg-slate-700 transition-all">
              Save
            </button>
          </div>
        </div>`
            : ""
        }
      </div>`
            )
            .join("")}
          <label class="block text-xs font-medium text-gray-700 mt-3 pt-3 border-t border-gray-200 mb-1">Model</label>
          <select id="model" name="model" class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none">
            <option value="">Default</option>
            <optgroup label="Claude">
              <option value="claude-sonnet-4" ${s.model === "claude-sonnet-4" ? "selected" : ""}>Claude Sonnet 4</option>
              <option value="claude-sonnet-4-5" ${s.model === "claude-sonnet-4-5" ? "selected" : ""}>Claude Sonnet 4.5</option>
              <option value="claude-opus-4" ${s.model === "claude-opus-4" ? "selected" : ""}>Claude Opus 4</option>
              <option value="claude-haiku-4" ${s.model === "claude-haiku-4" ? "selected" : ""}>Claude Haiku 4</option>
              <option value="claude-haiku-4-5" ${s.model === "claude-haiku-4-5" ? "selected" : ""}>Claude Haiku 4.5</option>
            </optgroup>
            <optgroup label="ChatGPT">
              <option value="openclaw/openai-codex/gpt-5.2-codex" ${s.model === "openclaw/openai-codex/gpt-5.2-codex" ? "selected" : ""}>GPT-5.2 Codex</option>
              <option value="openclaw/openai-codex/gpt-5.1" ${s.model === "openclaw/openai-codex/gpt-5.1" ? "selected" : ""}>GPT-5.1</option>
              <option value="openclaw/openai-codex/gpt-5.1-codex-max" ${s.model === "openclaw/openai-codex/gpt-5.1-codex-max" ? "selected" : ""}>GPT-5.1 Codex Max</option>
              <option value="openclaw/openai-codex/gpt-5.1-codex-mini" ${s.model === "openclaw/openai-codex/gpt-5.1-codex-mini" ? "selected" : ""}>GPT-5.1 Codex Mini</option>
            </optgroup>
          </select>
        </div>
      </div>

      <!-- Workspace Files Section -->
      <div class="bg-gray-50 rounded-lg p-3">
        <h3 class="flex items-center gap-2 text-sm font-medium text-gray-800 cursor-pointer select-none" onclick="toggleSection(this)">
          <span>&#128220;</span>
          Agent Instructions
          <span class="ml-auto text-xs text-gray-400 transition-transform rotate-[-90deg]" id="workspace-arrow">&#9660;</span>
        </h3>
        <div id="workspace-content" class="hidden pt-3 space-y-3">
          <p class="text-xs text-gray-500">Define your agent's identity, behavior rules, and user context. Supports Markdown with optional YAML frontmatter (auto-stripped).</p>
          <div>
            <label class="block text-xs font-medium text-gray-700 mb-1">IDENTITY.md <span class="text-gray-400">- Who the agent is</span></label>
            <textarea id="identityMd" name="identityMd" placeholder="You are a helpful coding assistant named Alex.&#10;You specialize in TypeScript and React development." class="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs font-mono min-h-[60px] resize-y focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none">${escapeHtml(s.identityMd || "")}</textarea>
          </div>
          <div>
            <label class="block text-xs font-medium text-gray-700 mb-1">SOUL.md <span class="text-gray-400">- Behavior rules & instructions</span></label>
            <textarea id="soulMd" name="soulMd" placeholder="Always write tests before implementation.&#10;Prefer functional programming patterns.&#10;Never commit directly to main branch." class="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs font-mono min-h-[80px] resize-y focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none">${escapeHtml(s.soulMd || "")}</textarea>
            <!-- Browse Souls from ClawHub -->
            <div class="mt-2">
              <div class="relative">
                <input type="text" id="soulSearchInput" placeholder="Browse community souls from ClawHub..." class="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none">
                <div id="soulSearchResults" class="hidden absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto"></div>
              </div>
              <p class="text-xs text-gray-400 mt-1">Browse <a href="https://clawhub.ai/souls" target="_blank" class="text-slate-600 hover:underline">ClawHub souls</a> to use as a starting point. Content will be loaded into the textarea above for editing.</p>
            </div>
          </div>
          <div>
            <label class="block text-xs font-medium text-gray-700 mb-1">USER.md <span class="text-gray-400">- User-specific context</span></label>
            <textarea id="userMd" name="userMd" placeholder="The user prefers concise responses.&#10;Their timezone is UTC+3.&#10;They use VS Code as their IDE." class="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs font-mono min-h-[60px] resize-y focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none">${escapeHtml(s.userMd || "")}</textarea>
          </div>
        </div>
      </div>

      <!-- Skills Section -->
      <div class="bg-gray-50 rounded-lg p-3">
        <h3 class="flex items-center gap-2 text-sm font-medium text-gray-800 cursor-pointer select-none" onclick="toggleSection(this)">
          <span>&#128736;</span>
          Skills
          <span id="skills-loading" class="hidden animate-spin text-slate-600">&#8635;</span>
          <span class="ml-auto text-xs text-gray-400 transition-transform rotate-[-90deg]" id="skills-arrow">&#9660;</span>
        </h3>
        <div id="skills-content" class="hidden pt-3 space-y-3">
          <!-- Skills Error -->
          <div id="skills-error" class="hidden bg-red-100 text-red-800 px-3 py-2 rounded-lg text-xs"></div>

          <!-- Enabled Skills List -->
          <div id="skills-list" class="space-y-2">
            <p class="text-xs text-gray-500">No skills configured yet.</p>
          </div>

          <!-- Add Skill Section -->
          <div class="border-t border-gray-200 pt-3">
            <p class="text-xs font-medium text-gray-600 mb-2">Add Skills</p>

            <!-- Search Input -->
            <div class="relative mb-2">
              <input type="text" id="skillSearchInput" placeholder="Search skills from ClawHub..." class="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none">
              <div id="skillSearchResults" class="hidden absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                <!-- Search results will be populated here -->
              </div>
            </div>

            <!-- Quick Add: Curated Skills -->
            <div class="mb-2">
              <p class="text-xs text-gray-500 mb-1">Quick add popular skills:</p>
              <div id="curatedSkillsChips" class="flex flex-wrap gap-1">
                <!-- Curated skill chips will be populated here -->
              </div>
            </div>

            <!-- Manual Entry -->
            <div class="flex gap-2">
              <input type="text" id="customSkillRepo" placeholder="Or enter slug: skill-name" class="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-xs font-mono focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none">
              <button type="button" id="addCustomSkillBtn" class="px-3 py-2 text-xs font-medium rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-all">
                Add
              </button>
            </div>
            <p class="text-xs text-gray-400 mt-1">Skills from <a href="https://clawhub.ai/skills" target="_blank" class="text-slate-600 hover:underline">ClawHub</a> extend your agent's capabilities.</p>
          </div>
        </div>
      </div>

      <!-- External Integrations (MCP) Section -->
      <div class="bg-gray-50 rounded-lg p-3">
        <h3 class="flex items-center gap-2 text-sm font-medium text-gray-800 cursor-pointer select-none" onclick="toggleSection(this)">
          <span>&#128268;</span>
          External Integrations (MCP)
          <span id="mcps-loading" class="hidden animate-spin text-slate-600">&#8635;</span>
          <span class="ml-auto text-xs text-gray-400 transition-transform rotate-[-90deg]" id="mcps-arrow">&#9660;</span>
        </h3>
        <div id="mcps-content" class="hidden pt-3 space-y-3">
          <!-- MCPs Error -->
          <div id="mcps-error" class="hidden bg-red-100 text-red-800 px-3 py-2 rounded-lg text-xs"></div>

          <!-- Enabled MCPs List -->
          <div id="mcps-list" class="space-y-2">
            <p class="text-xs text-gray-500">No MCP servers configured yet.</p>
          </div>

          <!-- Add MCP Section -->
          <div class="border-t border-gray-200 pt-3">
            <p class="text-xs font-medium text-gray-600 mb-2">Add Integrations</p>

            <!-- Search Input -->
            <div class="relative mb-2">
              <input type="text" id="mcpSearchInput" placeholder="Search MCP servers..." class="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none">
              <div id="mcpSearchResults" class="hidden absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
              </div>
            </div>

            <!-- Quick Add: Curated MCPs -->
            <div class="mb-2">
              <p class="text-xs text-gray-500 mb-1">Quick add popular MCPs:</p>
              <div id="curatedMcpChips" class="flex flex-wrap gap-1">
              </div>
            </div>

            <!-- Manual Entry for custom MCPs -->
            <div class="space-y-2">
              <input type="text" id="customMcpId" placeholder="MCP ID (e.g., my-custom-mcp)" class="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs font-mono focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none">
              <input type="text" id="customMcpUrl" placeholder="URL (e.g., https://mcp.example.com/sse)" class="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs font-mono focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none">
              <button type="button" id="addCustomMcpBtn" class="px-3 py-2 text-xs font-medium rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-all">
                Add Custom MCP
              </button>
            </div>
            <p class="text-xs text-gray-400 mt-1">MCP servers extend Claude's capabilities with external tools and data sources.</p>
          </div>
        </div>
      </div>

      <!-- Scheduled Reminders Section (outside form - read-only display) -->
      <div class="bg-gray-50 rounded-lg p-3">
        <h3 class="flex items-center gap-2 text-sm font-medium text-gray-800 cursor-pointer select-none" onclick="toggleSection(this)">
          <span>&#9200;</span>
          Scheduled Reminders
          <span id="schedules-loading" class="hidden animate-spin text-slate-600">&#8635;</span>
          <span class="ml-auto text-xs text-gray-400 transition-transform rotate-[-90deg]" id="schedules-arrow">&#9660;</span>
        </h3>
        <div id="schedules-content" class="hidden pt-3">
          <div id="schedules-error" class="hidden bg-red-100 text-red-800 px-3 py-2 rounded-lg text-xs mb-2"></div>
          <div id="schedules-list">
            <p class="text-xs text-gray-500">Loading scheduled reminders...</p>
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
      </div>

      <!-- Advanced Section -->
      <div class="border border-gray-200 rounded-lg">
        <h3 class="flex items-center gap-2 text-sm font-medium text-gray-800 cursor-pointer select-none p-3" onclick="toggleSection(this)">
          <span>&#9881;</span>
          Advanced
          <span class="ml-auto text-xs text-gray-400 transition-transform rotate-[-90deg]" id="advanced-arrow">&#9660;</span>
        </h3>
        <div id="advanced-content" class="hidden px-3 pb-3 space-y-3">

      <!-- Network Configuration -->
      <div class="bg-gray-50 rounded-lg p-3">
        <h3 class="flex items-center gap-2 text-sm font-medium text-gray-800 cursor-pointer select-none" onclick="toggleSection(this)">
          <span>&#127760;</span>
          Network Access
          <span class="ml-auto text-xs text-gray-400 transition-transform rotate-[-90deg]" id="network-arrow">&#9660;</span>
        </h3>
        <div id="network-content" class="hidden pt-3 space-y-3">
          <div>
            <label for="allowedDomains" class="block text-xs font-medium text-gray-600 mb-1">Allowed Domains</label>
            <textarea id="allowedDomains" name="allowedDomains" placeholder="github.com&#10;*.trusted.com" class="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs font-mono min-h-[60px] resize-y focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none">${escapeHtml((s.networkConfig?.allowedDomains || []).join("\n"))}</textarea>
          </div>
          <div>
            <label for="deniedDomains" class="block text-xs font-medium text-gray-600 mb-1">Denied Domains</label>
            <textarea id="deniedDomains" name="deniedDomains" placeholder="malicious.com" class="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs font-mono min-h-[60px] resize-y focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none">${escapeHtml((s.networkConfig?.deniedDomains || []).join("\n"))}</textarea>
          </div>
        </div>
      </div>

      <!-- Git Configuration (only shown when GitHub App is configured) -->
      ${
        githubAppConfigured
          ? `
      <div class="bg-gray-50 rounded-lg p-3" id="git-section">
        <h3 class="flex items-center gap-2 text-sm font-medium text-gray-800 cursor-pointer select-none" onclick="toggleSection(this)">
          <span>&#128193;</span>
          Git Repository
          <span class="ml-auto text-xs text-gray-400 transition-transform rotate-[-90deg]" id="git-arrow">&#9660;</span>
        </h3>
        <div id="git-content" class="hidden pt-3 space-y-2">
          <!-- GitHub User Connection (required to see repos) -->
          <div id="github-user-section" class="mb-3 pb-3 border-b border-gray-200">
            <div id="github-user-loading" class="text-center py-2">
              <p class="text-xs text-gray-500">Checking GitHub connection...</p>
            </div>
            <div id="github-user-connect" class="hidden text-center py-2">
              <p class="text-xs text-gray-600 mb-2">Connect your GitHub account to see your repositories</p>
              <a id="github-connect-btn" href="#" class="inline-block px-4 py-2 text-xs font-medium rounded-lg bg-gray-900 text-white hover:bg-gray-800 transition-all">
                <svg class="w-4 h-4 inline-block mr-1" viewBox="0 0 98 96" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M48.854 0C21.839 0 0 22 0 49.217c0 21.756 13.993 40.172 33.405 46.69 2.427.49 3.316-1.059 3.316-2.362 0-1.141-.08-5.052-.08-9.127-13.59 2.934-16.42-5.867-16.42-5.867-2.184-5.704-5.42-7.17-5.42-7.17-4.448-3.015.324-3.015.324-3.015 4.934.326 7.523 5.052 7.523 5.052 4.367 7.496 11.404 5.378 14.235 4.074.404-3.178 1.699-5.378 3.074-6.6-10.839-1.141-22.243-5.378-22.243-24.283 0-5.378 1.94-9.778 5.014-13.2-.485-1.222-2.184-6.275.486-13.038 0 0 4.125-1.304 13.426 5.052a46.97 46.97 0 0 1 12.214-1.63c4.125 0 8.33.571 12.213 1.63 9.302-6.356 13.427-5.052 13.427-5.052 2.67 6.763.97 11.816.485 13.038 3.155 3.422 5.015 7.822 5.015 13.2 0 18.905-11.404 23.06-22.324 24.283 1.78 1.548 3.316 4.481 3.316 9.126 0 6.6-.08 11.897-.08 13.526 0 1.304.89 2.853 3.316 2.364 19.412-6.52 33.405-24.935 33.405-46.691C97.707 22 75.788 0 48.854 0z" fill="currentColor"/></svg>
                Connect with GitHub
              </a>
            </div>
            <div id="github-user-connected" class="hidden flex items-center justify-between">
              <div class="flex items-center gap-2">
                <img id="github-user-avatar" src="" alt="" class="w-6 h-6 rounded-full">
                <div>
                  <p class="text-xs font-medium text-gray-800" id="github-user-login"></p>
                  <p class="text-xs text-green-600">Connected</p>
                </div>
              </div>
              <button type="button" onclick="disconnectGitHub()" class="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-100 text-red-700 hover:bg-red-200 transition-all">
                Disconnect
              </button>
            </div>
            <div id="github-oauth-unavailable" class="hidden text-center py-2">
              <p class="text-xs text-gray-400">GitHub authentication not configured</p>
            </div>
          </div>

          <!-- Loading state -->
          <div id="git-loading" class="hidden text-center py-4">
            <p class="text-xs text-gray-500">Loading GitHub installations...</p>
          </div>

          <!-- Install prompt (shown when no installations) -->
          <div id="git-install-prompt" class="hidden text-center py-4 border-2 border-dashed border-gray-200 rounded-lg">
            <p class="text-xs text-gray-600 mb-2">Install the GitHub App to enable repository access</p>
            <div class="flex items-center justify-center gap-2">
              ${
                githubAppInstallUrl
                  ? `<a href="${escapeHtml(githubAppInstallUrl)}" target="_blank" class="inline-block px-4 py-2 text-xs font-medium rounded-lg bg-gray-900 text-white hover:bg-gray-800 transition-all">
                Install on GitHub &rarr;
              </a>`
                  : `<p class="text-xs text-gray-400">Contact administrator to install the GitHub App</p>`
              }
              <button type="button" onclick="refreshGitHub()" class="px-4 py-2 text-xs font-medium rounded-lg bg-slate-100 text-slate-800 hover:bg-slate-200 transition-all">
                &#8635; Refresh
              </button>
            </div>
            <p class="text-xs text-gray-400 mt-2">After installing, click Refresh to see your repositories</p>
          </div>

          <!-- Repo selection (shown when installations exist) -->
          <div id="git-repo-selection" class="hidden space-y-2">
            <div>
              <label for="gitOrg" class="block text-xs font-medium text-gray-600 mb-1">Organization / User</label>
              <select id="gitOrg" name="gitOrg" class="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none">
                <option value="">Select...</option>
              </select>
            </div>
            <div>
              <label for="gitRepo" class="block text-xs font-medium text-gray-600 mb-1">Repository</label>
              <select id="gitRepo" name="gitRepo" class="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none" disabled>
                <option value="">Select organization first...</option>
              </select>
            </div>
            <div>
              <label for="gitBranch" class="block text-xs font-medium text-gray-600 mb-1">Branch</label>
              <select id="gitBranch" name="gitBranch" class="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none" disabled>
                <option value="">Select repository first...</option>
              </select>
            </div>
            <div>
              <label for="sparse" class="block text-xs font-medium text-gray-600 mb-1">Sparse Checkout (optional)</label>
              <textarea id="sparse" name="sparse" placeholder="src/&#10;docs/" class="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs font-mono min-h-[50px] resize-y focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none">${escapeHtml((s.gitConfig?.sparse || []).join("\n"))}</textarea>
              <p class="text-xs text-gray-400 mt-1">Only checkout specific directories (one per line)</p>
            </div>
          </div>

          <!-- Hidden fields for form submission -->
          <input type="hidden" id="repoUrl" name="repoUrl" value="${escapeHtml(s.gitConfig?.repoUrl || "")}">
          <input type="hidden" id="branch" name="branch" value="${escapeHtml(s.gitConfig?.branch || "")}">
          <input type="hidden" id="selectedInstallationId" name="selectedInstallationId" value="">
        </div>
      </div>
      `
          : `
      <div class="bg-gray-50 rounded-lg p-3" id="git-section">
        <h3 class="flex items-center gap-2 text-sm font-medium text-gray-800 cursor-pointer select-none" onclick="toggleSection(this)">
          <span>&#128193;</span>
          Git Repository
          <span class="ml-auto text-xs text-gray-400 transition-transform rotate-[-90deg]" id="git-arrow">&#9660;</span>
        </h3>
        <div id="git-content" class="hidden pt-3 space-y-2">
          <p class="text-xs text-gray-500">GitHub App is not configured. You can still use a manual repository URL.</p>
          <div>
            <label for="repoUrl" class="block text-xs font-medium text-gray-600 mb-1">Repository URL</label>
            <input id="repoUrl" name="repoUrl" type="text" placeholder="https://github.com/owner/repo" value="${escapeHtml(s.gitConfig?.repoUrl || "")}" class="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs font-mono focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none">
          </div>
          <div>
            <label for="branch" class="block text-xs font-medium text-gray-600 mb-1">Branch (optional)</label>
            <input id="branch" name="branch" type="text" placeholder="main" value="${escapeHtml(s.gitConfig?.branch || "")}" class="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs font-mono focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none">
          </div>
          <div>
            <label for="sparse" class="block text-xs font-medium text-gray-600 mb-1">Sparse Checkout (optional)</label>
            <textarea id="sparse" name="sparse" placeholder="src/&#10;docs/" class="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs font-mono min-h-[50px] resize-y focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none">${escapeHtml((s.gitConfig?.sparse || []).join("\n"))}</textarea>
            <p class="text-xs text-gray-400 mt-1">Only checkout specific directories (one per line)</p>
          </div>
        </div>
      </div>
      `
      }

      <!-- System Packages -->
      <div class="bg-gray-50 rounded-lg p-3">
        <h3 class="flex items-center gap-2 text-sm font-medium text-gray-800 cursor-pointer select-none" onclick="toggleSection(this)">
          <span>&#128230;</span>
          System Packages
          <span class="ml-auto text-xs text-gray-400 transition-transform rotate-[-90deg]" id="nix-arrow">&#9660;</span>
        </h3>
        <div id="nix-content" class="hidden pt-3 space-y-3">
          <div>
            <label for="nixPackages" class="block text-xs font-medium text-gray-600 mb-1">Packages (one per line)</label>
            <textarea id="nixPackages" name="nixPackages" placeholder="python311&#10;ffmpeg&#10;jq" class="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs font-mono min-h-[60px] resize-y focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none">${escapeHtml((s.nixConfig?.packages || []).join("\n"))}</textarea>
          </div>
        </div>
      </div>

      <!-- Environment Variables -->
      <div class="bg-gray-50 rounded-lg p-3">
        <h3 class="flex items-center gap-2 text-sm font-medium text-gray-800 cursor-pointer select-none" onclick="toggleSection(this)">
          <span>&#128203;</span>
          Environment Variables
          ${payload.prefillEnvVars?.length ? '<span class="text-xs text-slate-600 font-normal">(action needed)</span>' : ""}
          <span class="ml-auto text-xs text-gray-400 transition-transform ${payload.prefillEnvVars?.length ? "" : "rotate-[-90deg]"}" id="envvars-arrow">&#9660;</span>
        </h3>
        <div id="envvars-content" class="${payload.prefillEnvVars?.length ? "" : "hidden "}pt-3">
          <textarea id="envVars" name="envVars" placeholder="API_KEY=your_key&#10;DEBUG=true" class="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs font-mono min-h-[60px] resize-y focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none">${escapeHtml(
            (() => {
              const existingEnvVars = s.envVars || {};
              const prefillKeys = payload.prefillEnvVars || [];
              // Merge: existing vars first, then prefill keys that don't exist yet
              const allKeys = new Set([
                ...Object.keys(existingEnvVars),
                ...prefillKeys,
              ]);
              return Array.from(allKeys)
                .map((k) => `${k}=${existingEnvVars[k] || ""}`)
                .join("\n");
            })()
          )}</textarea>
          ${
            payload.prefillEnvVars?.length
              ? `<p class="text-xs text-slate-600 mt-1">⬆️ Please fill in the values for the highlighted variables above.</p>`
              : ""
          }
        </div>
      </div>


      <!-- Verbose Logging -->
      <div class="bg-gray-50 rounded-lg p-3">
        <label class="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" id="verboseLogging" name="verboseLogging" ${s.verboseLogging ? "checked" : ""} class="w-4 h-4 text-slate-600 rounded focus:ring-slate-500">
          <span class="text-sm font-medium text-gray-800">Verbose logging</span>
        </label>
        <p class="text-xs text-gray-500 mt-1 ml-6">Show tool calls, reasoning tokens, and detailed output</p>
      </div>

        </div>
      </div>

      <button type="submit" id="save-btn" class="w-full py-3 bg-gradient-to-r from-slate-700 to-slate-800 text-white text-sm font-semibold rounded-lg hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0 transition-all disabled:opacity-60 disabled:cursor-not-allowed disabled:transform-none">
        Save Settings
      </button>
    </form>
  </div>

  <script>
    const token = ${JSON.stringify(token)};
    const agentId = ${JSON.stringify(payload.agentId)};
    const githubOAuthConfigured = ${JSON.stringify(githubOAuthConfigured)};

    function toggleSection(header) {
      const sectionId = header.querySelector('[id$="-arrow"]').id.replace('-arrow', '-content');
      const content = document.getElementById(sectionId);
      const arrow = header.querySelector('[id$="-arrow"]');

      if (content.classList.contains('hidden')) {
        content.classList.remove('hidden');
        arrow.classList.remove('rotate-[-90deg]');
      } else {
        content.classList.add('hidden');
        arrow.classList.add('rotate-[-90deg]');
      }
    }

    function parseLines(text) {
      return text.split('\\n').map(l => l.trim()).filter(l => l);
    }

    // Prevent Enter key from submitting form (only submit via button click)
    document.getElementById('settings-form').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && e.target.type !== 'submit') {
        e.preventDefault();
      }
    });

    document.getElementById('settings-form').addEventListener('submit', async (e) => {
      e.preventDefault();

      const btn = document.getElementById('save-btn');
      const successMsg = document.getElementById('success-msg');
      const errorMsg = document.getElementById('error-msg');

      btn.disabled = true;
      btn.textContent = 'Saving...';
      successMsg.classList.add('hidden');
      errorMsg.classList.add('hidden');

      const settings = {};

      // Model
      const model = document.getElementById('model').value;
      if (model) settings.model = model;

      // Workspace files (IDENTITY.md, SOUL.md, USER.md)
      const identityMd = document.getElementById('identityMd').value;
      const soulMd = document.getElementById('soulMd').value;
      const userMd = document.getElementById('userMd').value;
      settings.identityMd = identityMd;
      settings.soulMd = soulMd;
      settings.userMd = userMd;

      // Network config
      const allowedDomains = parseLines(document.getElementById('allowedDomains').value);
      const deniedDomains = parseLines(document.getElementById('deniedDomains').value);
      if (allowedDomains.length || deniedDomains.length) {
        settings.networkConfig = {};
        if (allowedDomains.length) settings.networkConfig.allowedDomains = allowedDomains;
        if (deniedDomains.length) settings.networkConfig.deniedDomains = deniedDomains;
      }

      // Git config
      const repoUrl = document.getElementById('repoUrl').value.trim();
      const branch = document.getElementById('branch').value.trim();
      const sparse = parseLines(document.getElementById('sparse').value);
      if (repoUrl || branch || sparse.length) {
        if (!repoUrl) {
          errorMsg.textContent = 'Repository URL is required when Git config is set';
          errorMsg.classList.remove('hidden');
          btn.disabled = false;
          btn.textContent = 'Save Settings';
          return;
        }
        settings.gitConfig = {};
        settings.gitConfig.repoUrl = repoUrl;
        if (branch) settings.gitConfig.branch = branch;
        if (sparse.length) settings.gitConfig.sparse = sparse;
      } else {
        settings.gitConfig = null;
      }

      // System packages (Nix)
      const nixPackages = parseLines(document.getElementById('nixPackages').value);
      if (nixPackages.length) {
        settings.nixConfig = { packages: nixPackages };
      } else {
        settings.nixConfig = null;
      }

      // Environment variables
      const envVarsText = document.getElementById('envVars').value;
      const envVarsLines = parseLines(envVarsText);
      if (envVarsLines.length) {
        settings.envVars = {};
        for (const line of envVarsLines) {
          const eqIdx = line.indexOf('=');
          if (eqIdx > 0) {
            const key = line.slice(0, eqIdx).trim();
            const value = line.slice(eqIdx + 1);
            if (key) settings.envVars[key] = value;
          }
        }
      }

      // Verbose logging
      const verboseLogging = document.getElementById('verboseLogging').checked;
      settings.verboseLogging = verboseLogging;

      try {
        const response = await fetch('/api/v1/agents/' + encodeURIComponent(agentId) + '/config?token=' + encodeURIComponent(token), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(settings)
        });

        const result = await response.json();

        if (response.ok) {
          successMsg.classList.remove('hidden');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        } else {
          throw new Error(result.error || 'Failed to save settings');
        }
      } catch (error) {
        errorMsg.textContent = error.message;
        errorMsg.classList.remove('hidden');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } finally {
        btn.disabled = false;
        btn.textContent = 'Save Settings';
      }
    });

    // Provider handling (dynamically rendered from server)
    const PROVIDERS = ${JSON.stringify(
      Object.fromEntries(
        providers.map((p) => [p.id, { name: p.name, authType: p.authType }])
      )
    )};

    async function checkProviders() {
      try {
        const resp = await fetch('/api/v1/agents/' + encodeURIComponent(agentId) + '/config?token=' + encodeURIComponent(token));
        const data = await resp.json();
        for (const [provider, info] of Object.entries(data.providers || {})) {
          updateProviderStatus(provider, info.connected);
        }
      } catch (e) {
        document.getElementById('claude-status').textContent = 'Error checking status';
      }
    }

    function updateProviderStatus(provider, connected) {
      const status = document.getElementById(provider + '-status');
      const btn = document.getElementById(provider + '-auth-btn');
      if (!status || !btn) return;

      if (connected) {
        status.textContent = 'Connected';
        status.className = 'text-xs text-emerald-600';
        btn.textContent = 'Disconnect';
        btn.className = 'px-3 py-1.5 text-xs font-medium rounded-lg bg-red-100 text-red-700 hover:bg-red-200 transition-all';
        btn.onclick = () => disconnectProvider(provider);
      } else {
        status.textContent = 'Not connected';
        status.className = 'text-xs text-gray-500';
        btn.textContent = 'Connect';
        btn.className = 'px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-100 text-slate-800 hover:bg-slate-200 transition-all';
        btn.onclick = () => connectProvider(provider);
      }
    }

    function connectProvider(provider) {
      const info = PROVIDERS[provider];
      if (!info) return;

      if (info.authType === 'device-code') {
        connectChatGPT();
        return;
      }

      if (info.authType === 'api-key') {
        connectApiKey(provider);
        return;
      }

      // OAuth flow: open in new tab so user can complete auth flow
      window.open('/api/v1/oauth/providers/' + provider + '/login?token=' + encodeURIComponent(token), '_blank');

      // Show the code input section
      const codeInput = document.getElementById(provider + '-code-input');
      if (codeInput) {
        codeInput.classList.remove('hidden');
      }

      // Update status
      const status = document.getElementById(provider + '-status');
      if (status) {
        status.textContent = 'Waiting for code...';
        status.className = 'text-xs text-slate-600';
      }

      // Setup submit handler
      const submitBtn = document.getElementById(provider + '-submit-code');
      const codeField = document.getElementById(provider + '-auth-code');

      if (submitBtn && codeField) {
        submitBtn.onclick = async () => {
          const code = codeField.value.trim();
          if (!code) {
            alert('Please enter the authentication code');
            return;
          }

          submitBtn.disabled = true;
          submitBtn.textContent = 'Verifying...';

          try {
            const resp = await fetch('/api/v1/oauth/providers/' + provider + '/code?token=' + encodeURIComponent(token), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ code })
            });

            const result = await resp.json();

            if (resp.ok) {
              codeInput.classList.add('hidden');
              codeField.value = '';
              updateProviderStatus(provider, true);
              document.getElementById('success-msg').textContent = 'Connected to Claude!';
              document.getElementById('success-msg').classList.remove('hidden');
            } else {
              throw new Error(result.error || 'Failed to verify code');
            }
          } catch (e) {
            alert('Error: ' + e.message);
            submitBtn.disabled = false;
            submitBtn.textContent = 'Submit';
          }
        };
      }
    }

    // API key flow
    function connectApiKey(provider) {
      const inputSection = document.getElementById(provider + '-api-key-input');
      if (inputSection) {
        inputSection.classList.remove('hidden');
      }

      const status = document.getElementById(provider + '-status');
      if (status) {
        status.textContent = 'Enter your API key...';
        status.className = 'text-xs text-slate-600';
      }

      const saveBtn = document.getElementById(provider + '-save-key');
      const keyField = document.getElementById(provider + '-api-key');

      if (saveBtn && keyField) {
        saveBtn.onclick = async () => {
          const apiKey = keyField.value.trim();
          if (!apiKey) return;

          saveBtn.disabled = true;
          saveBtn.textContent = 'Saving...';

          try {
            const resp = await fetch('/api/v1/auth/' + provider + '/save-key', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ agentId, apiKey })
            });

            const result = await resp.json();

            if (resp.ok) {
              inputSection.classList.add('hidden');
              keyField.value = '';
              updateProviderStatus(provider, true);
              const name = PROVIDERS[provider]?.name || provider;
              document.getElementById('success-msg').textContent = 'Connected to ' + name + '!';
              document.getElementById('success-msg').classList.remove('hidden');
            } else {
              throw new Error(result.error || 'Failed to save API key');
            }
          } catch (e) {
            alert('Error: ' + e.message);
          } finally {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save';
          }
        };
      }
    }

    // ChatGPT device code flow
    let chatgptPollTimer = null;

    async function connectChatGPT() {
      const status = document.getElementById('chatgpt-status');
      const deviceCodeSection = document.getElementById('chatgpt-device-code');
      const pollStatus = document.getElementById('chatgpt-poll-status');

      try {
        status.textContent = 'Starting...';
        status.className = 'text-xs text-slate-600';

        const resp = await fetch('/api/v1/auth/chatgpt/start', { method: 'POST' });
        const data = await resp.json();

        if (!resp.ok) throw new Error(data.error || 'Failed to start auth');

        // Show device code UI
        document.getElementById('chatgpt-user-code').textContent = data.userCode;
        const verifyLink = document.getElementById('chatgpt-verify-link');
        if (data.verificationUrl) {
          verifyLink.href = data.verificationUrl;
        }
        deviceCodeSection.classList.remove('hidden');
        status.textContent = 'Waiting for authorization...';

        // Start polling
        const interval = Math.max((data.interval || 5) * 1000, 3000);
        chatgptPollTimer = setInterval(() => {
          pollChatGPTToken(data.deviceAuthId, data.userCode);
        }, interval);

      } catch (e) {
        status.textContent = 'Error: ' + e.message;
        status.className = 'text-xs text-red-600';
      }
    }

    async function pollChatGPTToken(deviceAuthId, userCode) {
      try {
        const resp = await fetch('/api/v1/auth/chatgpt/poll', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceAuthId, userCode, agentId })
        });
        const data = await resp.json();

        if (data.status === 'success') {
          clearInterval(chatgptPollTimer);
          chatgptPollTimer = null;
          document.getElementById('chatgpt-device-code').classList.add('hidden');
          updateProviderStatus('chatgpt', true);
          document.getElementById('success-msg').textContent = 'Connected to ChatGPT!';
          document.getElementById('success-msg').classList.remove('hidden');
        } else if (data.error) {
          clearInterval(chatgptPollTimer);
          chatgptPollTimer = null;
          document.getElementById('chatgpt-poll-status').textContent = 'Error: ' + data.error;
        }
        // status === 'pending' means keep polling
      } catch (e) {
        // Network error - keep polling
        console.error('Poll error:', e);
      }
    }

    async function disconnectProvider(provider) {
      const info = PROVIDERS[provider];
      const name = info?.name || provider;
      if (!confirm('Disconnect from ' + name + '? You will need to reconnect to use this provider.')) return;

      if (info?.authType === 'device-code' || info?.authType === 'api-key') {
        // Both device-code and api-key providers have a /logout endpoint under /api/v1/auth/{provider}/
        await fetch('/api/v1/auth/' + provider + '/logout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentId })
        });
      } else {
        // OAuth providers use the oauth route
        await fetch('/api/v1/oauth/providers/' + provider + '/logout?token=' + encodeURIComponent(token), { method: 'POST' });
      }
      checkProviders();
    }

    // Check providers on page load
    checkProviders();

    // ============================================================================
    // GitHub App Integration
    // ============================================================================
    const githubAppConfigured = ${githubAppConfigured};

    // Store for GitHub data
    let githubInstallations = [];
    let githubRepos = {};
    let currentInstallationId = null;
    let currentRepoFullName = null;
    let connectedGitHubUser = null;

    // Check for github_connected query param (after OAuth redirect)
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('github_connected') === 'true') {
      document.getElementById('success-msg').textContent = 'GitHub account connected!';
      document.getElementById('success-msg').classList.remove('hidden');
      // Clean up URL
      const newUrl = window.location.pathname + '?token=' + encodeURIComponent(token);
      window.history.replaceState({}, '', newUrl);
    }

    async function initGitHubUser() {
      if (!githubAppConfigured) return;

      const loadingEl = document.getElementById('github-user-loading');
      const connectEl = document.getElementById('github-user-connect');
      const connectedEl = document.getElementById('github-user-connected');
      const unavailableEl = document.getElementById('github-oauth-unavailable');

      try {
        const resp = await fetch('/api/v1/agents/' + encodeURIComponent(agentId) + '/config?token=' + encodeURIComponent(token));
        const data = await resp.json();

        loadingEl?.classList.add('hidden');

        if (!githubOAuthConfigured) {
          // GitHub OAuth not set up - show unavailable message but still allow app install
          unavailableEl?.classList.remove('hidden');
          initGitHub();
          return;
        }

        const githubUser = data.github?.user;
        if (githubUser) {
          connectedGitHubUser = githubUser;
          document.getElementById('github-user-avatar').src = githubUser.avatarUrl;
          document.getElementById('github-user-login').textContent = githubUser.login;
          connectedEl?.classList.remove('hidden');
          // Now load GitHub repos
          initGitHub();
        } else {
          // Show connect button
          const connectBtn = document.getElementById('github-connect-btn');
          connectBtn.href = '/api/v1/oauth/github/login?token=' + encodeURIComponent(token);
          connectEl?.classList.remove('hidden');
        }
      } catch (e) {
        console.error('Failed to check GitHub user:', e);
        loadingEl?.classList.add('hidden');
        unavailableEl?.classList.remove('hidden');
      }
    }

    async function disconnectGitHub() {
      if (!confirm('Disconnect your GitHub account?')) return;

      try {
        const resp = await fetch('/api/v1/oauth/github/logout?token=' + encodeURIComponent(token), {
          method: 'POST'
        });

        if (resp.ok) {
          connectedGitHubUser = null;
          // Reset UI
          document.getElementById('github-user-connected')?.classList.add('hidden');
          document.getElementById('github-user-connect')?.classList.remove('hidden');
          document.getElementById('git-loading')?.classList.add('hidden');
          document.getElementById('git-install-prompt')?.classList.add('hidden');
          document.getElementById('git-repo-selection')?.classList.add('hidden');
          document.getElementById('success-msg').textContent = 'GitHub disconnected';
          document.getElementById('success-msg').classList.remove('hidden');
        }
      } catch (e) {
        console.error('Failed to disconnect GitHub:', e);
      }
    }

    async function initGitHub() {
      if (!githubAppConfigured) return;

      const loading = document.getElementById('git-loading');
      const installPrompt = document.getElementById('git-install-prompt');
      const repoSelection = document.getElementById('git-repo-selection');

      // Show loading
      loading?.classList.remove('hidden');

      try {
        const resp = await fetch('/api/v1/agents/' + encodeURIComponent(agentId) + '/config?token=' + encodeURIComponent(token));
        const data = await resp.json();

        if (!data.github?.configured) {
          loading?.classList.add('hidden');
          return;
        }

        githubInstallations = data.github?.installations || [];

        if (githubInstallations.length === 0) {
          loading?.classList.add('hidden');
          installPrompt?.classList.remove('hidden');
          return;
        }

        // Populate org dropdown
        const orgSelect = document.getElementById('gitOrg');
        orgSelect.innerHTML = '<option value="">Select...</option>';
        for (const inst of githubInstallations) {
          const opt = document.createElement('option');
          opt.value = inst.id;
          opt.textContent = inst.account + (inst.accountType === 'Organization' ? ' (org)' : '');
          orgSelect.appendChild(opt);
        }

        // Check if there's a saved repo URL and try to pre-select
        const savedRepoUrl = document.getElementById('repoUrl').value;
        if (savedRepoUrl) {
          await preselectFromRepoUrl(savedRepoUrl);
        }

        loading?.classList.add('hidden');
        repoSelection?.classList.remove('hidden');

        // Setup change handlers
        orgSelect.addEventListener('change', onOrgChange);
        document.getElementById('gitRepo').addEventListener('change', onRepoChange);
        document.getElementById('gitBranch').addEventListener('change', onBranchChange);

      } catch (e) {
        console.error('Failed to init GitHub:', e);
        loading?.classList.add('hidden');
      }
    }

    async function preselectFromRepoUrl(repoUrl) {
      // Parse owner from URL (https://github.com/owner/repo)
      const match = repoUrl.match(/github\\.com\\/([^\\/]+)\\/([^\\/]+)/);
      if (!match) return;

      const [, owner, repo] = match;
      const savedBranch = document.getElementById('branch').value;

      // Find matching installation
      const installation = githubInstallations.find(i => i.account.toLowerCase() === owner.toLowerCase());
      if (!installation) return;

      // Select the org
      document.getElementById('gitOrg').value = installation.id;
      await onOrgChange({ target: { value: installation.id } });

      // Select the repo
      const repoSelect = document.getElementById('gitRepo');
      for (const opt of repoSelect.options) {
        if (opt.dataset.fullName?.toLowerCase() === (owner + '/' + repo).toLowerCase()) {
          repoSelect.value = opt.value;
          await onRepoChange({ target: { value: opt.value, selectedOptions: [opt] } });
          break;
        }
      }

      // Select the branch
      if (savedBranch) {
        const branchSelect = document.getElementById('gitBranch');
        branchSelect.value = savedBranch;
      }
    }

    async function onOrgChange(e) {
      const installationId = e.target.value;
      const repoSelect = document.getElementById('gitRepo');
      const branchSelect = document.getElementById('gitBranch');

      // Reset repo and branch
      repoSelect.innerHTML = '<option value="">Loading...</option>';
      repoSelect.disabled = true;
      branchSelect.innerHTML = '<option value="">Select repository first...</option>';
      branchSelect.disabled = true;
      document.getElementById('repoUrl').value = '';
      document.getElementById('branch').value = '';

      if (!installationId) {
        repoSelect.innerHTML = '<option value="">Select organization first...</option>';
        return;
      }

      currentInstallationId = installationId;

      try {
        const resp = await fetch('/api/v1/github/repos?token=' + encodeURIComponent(token) + '&installation_id=' + installationId);
        const data = await resp.json();

        githubRepos[installationId] = data.repos || [];

        repoSelect.innerHTML = '<option value="">Select...</option>';
        for (const repo of data.repos) {
          const opt = document.createElement('option');
          opt.value = repo.name;
          opt.textContent = repo.name + (repo.private ? ' 🔒' : '');
          opt.dataset.fullName = repo.fullName;
          opt.dataset.owner = repo.owner;
          opt.dataset.defaultBranch = repo.defaultBranch;
          repoSelect.appendChild(opt);
        }
        repoSelect.disabled = false;
      } catch (e) {
        console.error('Failed to fetch repos:', e);
        repoSelect.innerHTML = '<option value="">Error loading repos</option>';
      }
    }

    async function onRepoChange(e) {
      const repoName = e.target.value;
      const branchSelect = document.getElementById('gitBranch');
      const selectedOpt = e.target.selectedOptions?.[0];

      branchSelect.innerHTML = '<option value="">Loading...</option>';
      branchSelect.disabled = true;

      if (!repoName || !selectedOpt) {
        branchSelect.innerHTML = '<option value="">Select repository first...</option>';
        document.getElementById('repoUrl').value = '';
        document.getElementById('branch').value = '';
        return;
      }

      const owner = selectedOpt.dataset.owner;
      const fullName = selectedOpt.dataset.fullName;
      const defaultBranch = selectedOpt.dataset.defaultBranch;
      currentRepoFullName = fullName;

      // Update hidden repoUrl field
      document.getElementById('repoUrl').value = 'https://github.com/' + fullName;
      document.getElementById('selectedInstallationId').value = currentInstallationId;

      try {
        const resp = await fetch('/api/v1/github/branches?token=' + encodeURIComponent(token) + '&owner=' + owner + '&repo=' + repoName + '&installation_id=' + currentInstallationId);
        const data = await resp.json();

        branchSelect.innerHTML = '';
        for (const branch of data.branches) {
          const opt = document.createElement('option');
          opt.value = branch.name;
          opt.textContent = branch.name + (branch.protected ? ' 🛡️' : '') + (branch.name === defaultBranch ? ' (default)' : '');
          if (branch.name === defaultBranch) {
            opt.selected = true;
          }
          branchSelect.appendChild(opt);
        }
        branchSelect.disabled = false;

        // Set initial branch value
        document.getElementById('branch').value = branchSelect.value || defaultBranch;
      } catch (e) {
        console.error('Failed to fetch branches:', e);
        branchSelect.innerHTML = '<option value="">Error loading branches</option>';
      }
    }

    function onBranchChange(e) {
      document.getElementById('branch').value = e.target.value;
    }

    async function refreshGitHub() {
      const loading = document.getElementById('git-loading');
      const installPrompt = document.getElementById('git-install-prompt');
      const repoSelection = document.getElementById('git-repo-selection');

      // Show loading, hide others
      loading?.classList.remove('hidden');
      installPrompt?.classList.add('hidden');
      repoSelection?.classList.add('hidden');

      // Re-initialize
      await initGitHub();
    }

    // Initialize GitHub on page load (check user first, then load repos)
    if (githubAppConfigured) {
      initGitHubUser();
    }

    // ============================================================================
    // Skills Management
    // ============================================================================

    let currentSkills = ${JSON.stringify(s.skillsConfig?.skills || [])};
    let searchTimeout = null;

    async function initSkills() {
      // Load curated skills as chips
      try {
        const resp = await fetch('/api/v1/skills/registry?token=' + encodeURIComponent(token));
        const data = await resp.json();

        const chipsContainer = document.getElementById('curatedSkillsChips');
        chipsContainer.innerHTML = data.skills.map(function(skill) {
          // Check if already added
          const alreadyAdded = currentSkills.some(function(s) { return s.repo === skill.repo; });
          const disabledClass = alreadyAdded ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-slate-200';
          return '<button type="button" onclick="addSkillFromChip(\\'' + escapeHtmlJS(skill.repo) + '\\')" ' +
            'class="px-2 py-1 text-xs rounded-full bg-slate-100 text-slate-800 ' + disabledClass + '" ' +
            (alreadyAdded ? 'disabled title="Already added"' : 'title="' + escapeHtmlJS(skill.description) + '"') + '>' +
            escapeHtmlJS(skill.name) +
          '</button>';
        }).join('');
      } catch (e) {
        console.error('Failed to load curated skills:', e);
      }

      // Setup search input
      const searchInput = document.getElementById('skillSearchInput');
      searchInput.addEventListener('input', function(e) {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(function() {
          searchSkills(e.target.value);
        }, 300);
      });

      searchInput.addEventListener('focus', function() {
        if (searchInput.value.trim()) {
          document.getElementById('skillSearchResults').classList.remove('hidden');
        }
      });

      // Hide search results when clicking outside
      document.addEventListener('click', function(e) {
        if (!e.target.closest('#skillSearchInput') && !e.target.closest('#skillSearchResults')) {
          document.getElementById('skillSearchResults').classList.add('hidden');
        }
      });

      // Render current skills
      renderSkillsList();
    }

    async function searchSkills(query) {
      const resultsContainer = document.getElementById('skillSearchResults');

      if (!query.trim()) {
        resultsContainer.classList.add('hidden');
        return;
      }

      resultsContainer.innerHTML = '<div class="p-2 text-xs text-gray-500">Searching...</div>';
      resultsContainer.classList.remove('hidden');

      try {
        const resp = await fetch('/api/v1/skills/registry?token=' + encodeURIComponent(token) + '&q=' + encodeURIComponent(query));
        const data = await resp.json();

        if (data.skills.length === 0) {
          resultsContainer.innerHTML = '<div class="p-2 text-xs text-gray-500">No skills found</div>';
          return;
        }

        resultsContainer.innerHTML = data.skills.map(function(skill) {
          const alreadyAdded = currentSkills.some(function(s) { return s.repo === skill.id; });
          return '<div class="p-2 hover:bg-gray-50 cursor-pointer border-b border-gray-100 last:border-b-0" ' +
            'onclick="addSkillFromSearch(\\'' + escapeHtmlJS(skill.id) + '\\')">' +
            '<div class="flex items-center justify-between">' +
              '<div class="flex-1 min-w-0">' +
                '<p class="text-xs font-medium text-gray-800 truncate">' + escapeHtmlJS(skill.name) + '</p>' +
                '<p class="text-xs text-gray-500 truncate">' + escapeHtmlJS(skill.id) + '</p>' +
              '</div>' +
              '<div class="flex items-center gap-2 ml-2">' +
                '<span class="text-xs text-gray-400">' + formatInstalls(skill.installs) + '</span>' +
                (alreadyAdded ? '<span class="text-xs text-green-600">Added</span>' : '<span class="text-xs text-slate-600">+ Add</span>') +
              '</div>' +
            '</div>' +
          '</div>';
        }).join('');
      } catch (e) {
        resultsContainer.innerHTML = '<div class="p-2 text-xs text-red-500">Search failed</div>';
      }
    }

    function formatInstalls(num) {
      if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
      return num.toString();
    }

    async function addSkillFromChip(repo) {
      if (currentSkills.some(function(s) { return s.repo === repo; })) return;
      await addSkill(repo);
      initSkills(); // Refresh chips to show disabled state
    }

    async function addSkillFromSearch(repo) {
      if (currentSkills.some(function(s) { return s.repo === repo; })) return;
      await addSkill(repo);
      document.getElementById('skillSearchInput').value = '';
      document.getElementById('skillSearchResults').classList.add('hidden');
      initSkills(); // Refresh chips
    }

    function renderSkillsList() {
      const container = document.getElementById('skills-list');

      if (currentSkills.length === 0) {
        container.innerHTML = '<p class="text-xs text-gray-500">No skills configured yet.</p>';
        return;
      }

      container.innerHTML = currentSkills.map(function(skill) {
        const enabledClass = skill.enabled
          ? 'bg-green-100 text-green-800'
          : 'bg-gray-100 text-gray-500';
        const toggleLabel = skill.enabled ? 'Enabled' : 'Disabled';

        return '<div class="flex items-center justify-between p-2 bg-white rounded border border-gray-200">' +
          '<div class="flex-1 min-w-0">' +
            '<p class="text-xs font-medium text-gray-800 truncate">' + escapeHtmlJS(skill.name) + '</p>' +
            '<p class="text-xs text-gray-500 truncate">' + escapeHtmlJS(skill.repo) + '</p>' +
          '</div>' +
          '<div class="flex items-center gap-2 ml-2 flex-shrink-0">' +
            '<button type="button" onclick="toggleSkill(\\'' + escapeHtmlJS(skill.repo) + '\\')" ' +
              'class="px-2 py-1 text-xs rounded ' + enabledClass + '">' + toggleLabel + '</button>' +
            '<button type="button" onclick="removeSkill(\\'' + escapeHtmlJS(skill.repo) + '\\')" ' +
              'class="px-2 py-1 text-xs rounded bg-red-100 text-red-700 hover:bg-red-200">Remove</button>' +
          '</div>' +
        '</div>';
      }).join('');
    }

    function escapeHtmlJS(text) {
      if (!text) return '';
      return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    async function addSkill(repo) {
      if (!repo) return;

      setSkillsLoading(true);

      try {
        // First fetch skill metadata
        const fetchResp = await fetch('/api/v1/skills/fetch?token=' + encodeURIComponent(token), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ repo: repo })
        });

        const fetchResult = await fetchResp.json();
        if (!fetchResp.ok) {
          throw new Error(fetchResult.error || 'Failed to fetch skill');
        }

        // Add to current skills and save via config
        const newSkill = {
          repo: fetchResult.repo,
          name: fetchResult.name,
          description: fetchResult.description,
          enabled: true,
          content: fetchResult.content,
          contentFetchedAt: fetchResult.fetchedAt
        };

        const updatedSkills = [...currentSkills, newSkill];

        const resp = await fetch('/api/v1/agents/' + encodeURIComponent(agentId) + '/config?token=' + encodeURIComponent(token), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ skillsConfig: { skills: updatedSkills } })
        });

        if (resp.ok) {
          currentSkills = updatedSkills;
          renderSkillsList();
          document.getElementById('customSkillRepo').value = '';
        } else {
          const result = await resp.json();
          throw new Error(result.error || 'Failed to add skill');
        }
      } catch (e) {
        showSkillsError(e.message);
      } finally {
        setSkillsLoading(false);
      }
    }

    async function toggleSkill(repo) {
      const skill = currentSkills.find(function(s) { return s.repo === repo; });
      if (!skill) return;

      const newEnabled = !skill.enabled;
      const updatedSkills = currentSkills.map(function(s) {
        if (s.repo === repo) return { ...s, enabled: newEnabled };
        return s;
      });

      try {
        const resp = await fetch('/api/v1/agents/' + encodeURIComponent(agentId) + '/config?token=' + encodeURIComponent(token), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ skillsConfig: { skills: updatedSkills } })
        });

        if (resp.ok) {
          currentSkills = updatedSkills;
          renderSkillsList();
        } else {
          const result = await resp.json();
          throw new Error(result.error || 'Failed to toggle skill');
        }
      } catch (e) {
        showSkillsError(e.message);
      }
    }

    async function removeSkill(repo) {
      if (!confirm('Remove this skill?')) return;

      const updatedSkills = currentSkills.filter(function(s) { return s.repo !== repo; });

      try {
        const resp = await fetch('/api/v1/agents/' + encodeURIComponent(agentId) + '/config?token=' + encodeURIComponent(token), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ skillsConfig: { skills: updatedSkills } })
        });

        if (resp.ok) {
          currentSkills = updatedSkills;
          renderSkillsList();
        } else {
          const result = await resp.json();
          throw new Error(result.error || 'Failed to remove skill');
        }
      } catch (e) {
        showSkillsError(e.message);
      }
    }

    function setSkillsLoading(loading) {
      const spinner = document.getElementById('skills-loading');
      if (loading) {
        spinner.classList.remove('hidden');
        document.getElementById('skills-error').classList.add('hidden');
      } else {
        spinner.classList.add('hidden');
      }
    }

    function showSkillsError(msg) {
      const el = document.getElementById('skills-error');
      el.textContent = msg;
      el.classList.remove('hidden');
      setTimeout(function() { el.classList.add('hidden'); }, 5000);
    }

    // Event listener for custom skill add button
    document.getElementById('addCustomSkillBtn').addEventListener('click', async function() {
      const repo = document.getElementById('customSkillRepo').value.trim();
      if (repo) {
        await addSkill(repo);
        document.getElementById('customSkillRepo').value = '';
        initSkills(); // Refresh chips
      }
    });

    // Initialize skills on page load
    initSkills();

    // ============================================================================
    // Soul Browsing (ClawHub)
    // ============================================================================

    let soulSearchTimeout = null;

    (function initSoulSearch() {
      const searchInput = document.getElementById('soulSearchInput');
      const resultsContainer = document.getElementById('soulSearchResults');

      searchInput.addEventListener('input', function(e) {
        clearTimeout(soulSearchTimeout);
        soulSearchTimeout = setTimeout(function() {
          searchSouls(e.target.value);
        }, 300);
      });

      searchInput.addEventListener('focus', function() {
        if (!searchInput.value.trim()) {
          // Show popular souls on focus
          searchSouls('');
        } else {
          resultsContainer.classList.remove('hidden');
        }
      });

      document.addEventListener('click', function(e) {
        if (!e.target.closest('#soulSearchInput') && !e.target.closest('#soulSearchResults')) {
          resultsContainer.classList.add('hidden');
        }
      });
    })();

    async function searchSouls(query) {
      const resultsContainer = document.getElementById('soulSearchResults');

      resultsContainer.innerHTML = '<div class="p-2 text-xs text-gray-500">Loading...</div>';
      resultsContainer.classList.remove('hidden');

      try {
        const url = query.trim()
          ? 'https://wry-manatee-359.convex.site/api/v1/search?q=' + encodeURIComponent(query) + '&limit=8'
          : 'https://wry-manatee-359.convex.site/api/v1/souls?limit=8';
        const resp = await fetch(url);
        const data = await resp.json();

        const items = query.trim() ? (data.results || []) : (data.items || []);

        if (items.length === 0) {
          resultsContainer.innerHTML = '<div class="p-2 text-xs text-gray-500">No souls found</div>';
          return;
        }

        resultsContainer.innerHTML = items.map(function(item) {
          const slug = item.slug;
          const name = item.displayName || slug;
          const summary = item.summary || '';
          return '<div class="p-2 hover:bg-gray-50 cursor-pointer border-b border-gray-100 last:border-b-0" ' +
            'onclick="loadSoul(\\'' + escapeHtmlJS(slug) + '\\')">' +
            '<div class="flex items-center justify-between">' +
              '<div class="flex-1 min-w-0">' +
                '<p class="text-xs font-medium text-gray-800 truncate">' + escapeHtmlJS(name) + '</p>' +
                '<p class="text-xs text-gray-500 truncate">' + escapeHtmlJS(summary).substring(0, 80) + '</p>' +
              '</div>' +
              '<span class="text-xs text-slate-600 ml-2 shrink-0">Use</span>' +
            '</div>' +
          '</div>';
        }).join('');
      } catch (e) {
        resultsContainer.innerHTML = '<div class="p-2 text-xs text-red-500">Failed to search souls</div>';
      }
    }

    async function loadSoul(slug) {
      const textarea = document.getElementById('soulMd');
      const resultsContainer = document.getElementById('soulSearchResults');
      const searchInput = document.getElementById('soulSearchInput');

      // Show loading state
      searchInput.value = 'Loading ' + slug + '...';
      searchInput.disabled = true;
      resultsContainer.classList.add('hidden');

      try {
        const resp = await fetch('https://wry-manatee-359.convex.site/api/v1/souls/' + encodeURIComponent(slug) + '/file?path=SOUL.md');
        if (!resp.ok) throw new Error('Failed to fetch soul');
        const content = await resp.text();
        textarea.value = content;
        textarea.style.minHeight = '200px';
        searchInput.value = '';
      } catch (e) {
        searchInput.value = '';
        const errorDiv = document.createElement('div');
        errorDiv.className = 'text-xs text-red-500 mt-1';
        errorDiv.textContent = 'Failed to load soul: ' + slug;
        searchInput.parentElement.appendChild(errorDiv);
        setTimeout(function() { errorDiv.remove(); }, 3000);
      } finally {
        searchInput.disabled = false;
      }
    }

    // ============================================================================
    // External Integrations (MCP) Management
    // ============================================================================

    let currentMcpServers = ${JSON.stringify(s.mcpServers || {})};
    let mcpSearchTimeout = null;

    async function initMcps() {
      // Load curated MCPs as chips
      try {
        const resp = await fetch('/api/v1/mcps/registry?token=' + encodeURIComponent(token));
        const data = await resp.json();

        const chipsContainer = document.getElementById('curatedMcpChips');
        chipsContainer.innerHTML = data.mcps.map(function(mcp) {
          const alreadyAdded = currentMcpServers.hasOwnProperty(mcp.id);
          const disabledClass = alreadyAdded ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-slate-200';
          return '<button type="button" onclick="addMcpFromChip(\\'' + escapeHtmlJS(mcp.id) + '\\')" ' +
            'class="px-2 py-1 text-xs rounded-full bg-slate-100 text-slate-800 ' + disabledClass + '" ' +
            (alreadyAdded ? 'disabled title="Already added"' : 'title="' + escapeHtmlJS(mcp.description) + '"') + '>' +
            escapeHtmlJS(mcp.name) +
          '</button>';
        }).join('');
      } catch (e) {
        console.error('Failed to load curated MCPs:', e);
      }

      // Setup search input
      const searchInput = document.getElementById('mcpSearchInput');
      searchInput.addEventListener('input', function(e) {
        clearTimeout(mcpSearchTimeout);
        mcpSearchTimeout = setTimeout(function() {
          searchMcps(e.target.value);
        }, 300);
      });

      searchInput.addEventListener('focus', function() {
        if (searchInput.value.trim()) {
          document.getElementById('mcpSearchResults').classList.remove('hidden');
        }
      });

      // Hide search results when clicking outside
      document.addEventListener('click', function(e) {
        if (!e.target.closest('#mcpSearchInput') && !e.target.closest('#mcpSearchResults')) {
          document.getElementById('mcpSearchResults').classList.add('hidden');
        }
      });

      // Render current MCPs
      renderMcpsList();
    }

    async function searchMcps(query) {
      const resultsContainer = document.getElementById('mcpSearchResults');

      if (!query.trim()) {
        resultsContainer.classList.add('hidden');
        return;
      }

      resultsContainer.innerHTML = '<div class="p-2 text-xs text-gray-500">Searching...</div>';
      resultsContainer.classList.remove('hidden');

      try {
        const resp = await fetch('/api/v1/mcps/registry?token=' + encodeURIComponent(token) + '&q=' + encodeURIComponent(query));
        const data = await resp.json();

        if (data.mcps.length === 0) {
          resultsContainer.innerHTML = '<div class="p-2 text-xs text-gray-500">No MCPs found</div>';
          return;
        }

        resultsContainer.innerHTML = data.mcps.map(function(mcp) {
          const alreadyAdded = currentMcpServers.hasOwnProperty(mcp.id);
          return '<div class="p-2 hover:bg-gray-50 cursor-pointer border-b border-gray-100 last:border-b-0" ' +
            'onclick="addMcpFromSearch(\\'' + escapeHtmlJS(mcp.id) + '\\')">' +
            '<div class="flex items-center justify-between">' +
              '<div class="flex-1 min-w-0">' +
                '<p class="text-xs font-medium text-gray-800 truncate">' + escapeHtmlJS(mcp.name) + '</p>' +
                '<p class="text-xs text-gray-500 truncate">' + escapeHtmlJS(mcp.description) + '</p>' +
              '</div>' +
              '<div class="flex items-center gap-2 ml-2">' +
                '<span class="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">' + escapeHtmlJS(mcp.type) + '</span>' +
                (alreadyAdded ? '<span class="text-xs text-green-600">Added</span>' : '<span class="text-xs text-slate-600">+ Add</span>') +
              '</div>' +
            '</div>' +
          '</div>';
        }).join('');
      } catch (e) {
        resultsContainer.innerHTML = '<div class="p-2 text-xs text-red-500">Search failed</div>';
      }
    }

    function renderMcpsList() {
      const container = document.getElementById('mcps-list');
      const mcpIds = Object.keys(currentMcpServers);

      if (mcpIds.length === 0) {
        container.innerHTML = '<p class="text-xs text-gray-500">No MCP servers configured yet.</p>';
        return;
      }

      container.innerHTML = mcpIds.map(function(mcpId) {
        const config = currentMcpServers[mcpId];
        const enabled = config.enabled !== false;
        const enabledClass = enabled
          ? 'bg-green-100 text-green-800'
          : 'bg-gray-100 text-gray-500';
        const toggleLabel = enabled ? 'Enabled' : 'Disabled';

        // Build description from config
        let description = config.description || '';
        if (!description && config.url) description = config.url;
        if (!description && config.command) description = config.command + ' ' + (config.args || []).join(' ');

        return '<div class="flex items-center justify-between p-2 bg-white rounded border border-gray-200">' +
          '<div class="flex-1 min-w-0">' +
            '<p class="text-xs font-medium text-gray-800 truncate">' + escapeHtmlJS(mcpId) + '</p>' +
            (description ? '<p class="text-xs text-gray-500 truncate">' + escapeHtmlJS(description) + '</p>' : '') +
          '</div>' +
          '<div class="flex items-center gap-2 ml-2 flex-shrink-0">' +
            '<button type="button" onclick="toggleMcp(\\'' + escapeHtmlJS(mcpId) + '\\')" ' +
              'class="px-2 py-1 text-xs rounded ' + enabledClass + '">' + toggleLabel + '</button>' +
            '<button type="button" onclick="removeMcp(\\'' + escapeHtmlJS(mcpId) + '\\')" ' +
              'class="px-2 py-1 text-xs rounded bg-red-100 text-red-700 hover:bg-red-200">Remove</button>' +
          '</div>' +
        '</div>';
      }).join('');
    }

    async function addMcpFromChip(mcpId) {
      if (currentMcpServers.hasOwnProperty(mcpId)) return;
      await addMcp(mcpId, null);
      initMcps(); // Refresh chips
    }

    async function addMcpFromSearch(mcpId) {
      if (currentMcpServers.hasOwnProperty(mcpId)) return;
      await addMcp(mcpId, null);
      document.getElementById('mcpSearchInput').value = '';
      document.getElementById('mcpSearchResults').classList.add('hidden');
      initMcps(); // Refresh chips
    }

    async function addMcp(mcpId, customUrl) {
      setMcpsLoading(true);

      try {
        // Build MCP config
        const mcpConfig = {
          enabled: true,
        };
        if (customUrl) {
          mcpConfig.url = customUrl;
        }

        const updatedMcpServers = {
          ...currentMcpServers,
          [mcpId]: mcpConfig,
        };

        const resp = await fetch('/api/v1/agents/' + encodeURIComponent(agentId) + '/config?token=' + encodeURIComponent(token), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mcpServers: updatedMcpServers })
        });

        if (resp.ok) {
          currentMcpServers = updatedMcpServers;
          renderMcpsList();
          document.getElementById('customMcpId').value = '';
          document.getElementById('customMcpUrl').value = '';
        } else {
          const result = await resp.json();
          throw new Error(result.error || 'Failed to add MCP');
        }
      } catch (e) {
        showMcpsError(e.message);
      } finally {
        setMcpsLoading(false);
      }
    }

    async function toggleMcp(mcpId) {
      const config = currentMcpServers[mcpId];
      if (!config) return;

      const newEnabled = config.enabled === false;
      const updatedMcpServers = {
        ...currentMcpServers,
        [mcpId]: { ...config, enabled: newEnabled },
      };

      try {
        const resp = await fetch('/api/v1/agents/' + encodeURIComponent(agentId) + '/config?token=' + encodeURIComponent(token), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mcpServers: updatedMcpServers })
        });

        if (resp.ok) {
          currentMcpServers = updatedMcpServers;
          renderMcpsList();
        } else {
          const result = await resp.json();
          throw new Error(result.error || 'Failed to toggle MCP');
        }
      } catch (e) {
        showMcpsError(e.message);
      }
    }

    async function removeMcp(mcpId) {
      if (!confirm('Remove this MCP server?')) return;

      const updatedMcpServers = { ...currentMcpServers };
      delete updatedMcpServers[mcpId];

      try {
        const resp = await fetch('/api/v1/agents/' + encodeURIComponent(agentId) + '/config?token=' + encodeURIComponent(token), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mcpServers: updatedMcpServers })
        });

        if (resp.ok) {
          currentMcpServers = updatedMcpServers;
          renderMcpsList();
          initMcps(); // Refresh chips
        } else {
          const result = await resp.json();
          throw new Error(result.error || 'Failed to remove MCP');
        }
      } catch (e) {
        showMcpsError(e.message);
      }
    }

    function setMcpsLoading(loading) {
      const spinner = document.getElementById('mcps-loading');
      if (loading) {
        spinner.classList.remove('hidden');
        document.getElementById('mcps-error').classList.add('hidden');
      } else {
        spinner.classList.add('hidden');
      }
    }

    function showMcpsError(msg) {
      const el = document.getElementById('mcps-error');
      el.textContent = msg;
      el.classList.remove('hidden');
      setTimeout(function() { el.classList.add('hidden'); }, 5000);
    }

    // Event listener for custom MCP add button
    document.getElementById('addCustomMcpBtn').addEventListener('click', async function() {
      const mcpId = document.getElementById('customMcpId').value.trim();
      const mcpUrl = document.getElementById('customMcpUrl').value.trim();
      if (mcpId) {
        await addMcp(mcpId, mcpUrl || null);
        initMcps();
      }
    });

    // Initialize MCPs on page load
    initMcps();

    // ============================================================================
    // Scheduled Reminders Management
    // ============================================================================

    let currentSchedules = [];

    async function initSchedules() {
      const listContainer = document.getElementById('schedules-list');
      const loadingSpinner = document.getElementById('schedules-loading');

      loadingSpinner.classList.remove('hidden');

      try {
        const resp = await fetch('/api/v1/agents/' + encodeURIComponent(agentId) + '/schedules?token=' + encodeURIComponent(token));
        const data = await resp.json();

        if (!resp.ok) {
          throw new Error(data.error || 'Failed to load schedules');
        }

        currentSchedules = data.schedules || [];
        renderSchedulesList();
      } catch (e) {
        console.error('Failed to load schedules:', e);
        listContainer.innerHTML = '<p class="text-xs text-red-500">Failed to load scheduled reminders.</p>';
      } finally {
        loadingSpinner.classList.add('hidden');
      }
    }

    function renderSchedulesList() {
      const container = document.getElementById('schedules-list');

      if (currentSchedules.length === 0) {
        container.innerHTML = '<p class="text-xs text-gray-500">No scheduled reminders.</p>';
        return;
      }

      container.innerHTML = currentSchedules.map(function(schedule) {
        const scheduledFor = new Date(schedule.scheduledFor);
        const now = new Date();
        const minutesRemaining = Math.max(0, Math.round((scheduledFor - now) / (1000 * 60)));

        let timeDisplay;
        if (minutesRemaining === 0) {
          timeDisplay = 'Due now';
        } else if (minutesRemaining < 60) {
          timeDisplay = 'in ' + minutesRemaining + ' min';
        } else {
          const hours = Math.floor(minutesRemaining / 60);
          const mins = minutesRemaining % 60;
          timeDisplay = 'in ' + hours + 'h ' + mins + 'm';
        }

        const statusClass = schedule.status === 'pending'
          ? 'bg-slate-100 text-slate-800'
          : schedule.status === 'triggered'
            ? 'bg-green-100 text-green-800'
            : 'bg-gray-100 text-gray-500';

        // Build recurring info display
        let recurringInfo = '';
        if (schedule.isRecurring && schedule.cron) {
          recurringInfo = '<span class="inline-block px-1.5 py-0.5 rounded text-xs bg-blue-100 text-blue-800 ml-1" title="Cron: ' + escapeHtmlJS(schedule.cron) + '">' +
            '&#128260; ' + schedule.iteration + '/' + schedule.maxIterations +
          '</span>';
        }

        return '<div class="flex items-start justify-between p-2 bg-white rounded border border-gray-200 mb-2">' +
          '<div class="flex-1 min-w-0">' +
            '<p class="text-xs font-medium text-gray-800 truncate" title="' + escapeHtmlJS(schedule.task) + '">' + escapeHtmlJS(truncateText(schedule.task, 60)) + '</p>' +
            '<p class="text-xs text-gray-500">' +
              '<span class="inline-block px-1.5 py-0.5 rounded text-xs ' + statusClass + '">' + schedule.status + '</span> ' +
              recurringInfo +
              '<span title="' + scheduledFor.toLocaleString() + '" class="ml-1">' + timeDisplay + '</span>' +
              (schedule.isRecurring && schedule.cron ? '<span class="text-gray-400 ml-1">(' + escapeHtmlJS(schedule.cron) + ')</span>' : '') +
            '</p>' +
          '</div>' +
          (schedule.status === 'pending' ?
            '<button type="button" onclick="cancelSchedule(\\'' + escapeHtmlJS(schedule.scheduleId) + '\\')" ' +
              'class="ml-2 px-2 py-1 text-xs rounded bg-red-100 text-red-700 hover:bg-red-200 flex-shrink-0">Cancel</button>'
            : '') +
        '</div>';
      }).join('');
    }

    function truncateText(text, maxLength) {
      if (!text) return '';
      if (text.length <= maxLength) return text;
      return text.slice(0, maxLength - 3) + '...';
    }

    async function cancelSchedule(scheduleId) {
      if (!confirm('Cancel this scheduled reminder?')) return;

      const loadingSpinner = document.getElementById('schedules-loading');
      loadingSpinner.classList.remove('hidden');

      try {
        const resp = await fetch('/api/v1/agents/' + encodeURIComponent(agentId) + '/schedules/' + encodeURIComponent(scheduleId) + '?token=' + encodeURIComponent(token), {
          method: 'DELETE'
        });

        const result = await resp.json();

        if (resp.ok) {
          currentSchedules = currentSchedules.filter(function(s) { return s.scheduleId !== scheduleId; });
          renderSchedulesList();
          document.getElementById('success-msg').textContent = 'Reminder cancelled!';
          document.getElementById('success-msg').classList.remove('hidden');
        } else {
          throw new Error(result.error || 'Failed to cancel reminder');
        }
      } catch (e) {
        showSchedulesError(e.message);
      } finally {
        loadingSpinner.classList.add('hidden');
      }
    }

    function showSchedulesError(msg) {
      const el = document.getElementById('schedules-error');
      el.textContent = msg;
      el.classList.remove('hidden');
      setTimeout(function() { el.classList.add('hidden'); }, 5000);
    }

    // Initialize schedules on page load
    initSchedules();

    // ============================================================================
    // Prefill Skills and External Integrations (MCP) (from settings link)
    // ============================================================================

    const prefillSkills = ${JSON.stringify(payload.prefillSkills || [])};
    const prefillMcpServers = ${JSON.stringify(payload.prefillMcpServers || [])};

    async function addPrefillSkill(index) {
      const skill = prefillSkills[index];
      if (!skill) return;

      const btn = document.querySelector('#prefill-skill-' + index + ' button');
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Adding...';
      }

      try {
        // Fetch skill content from GitHub
        const fetchResp = await fetch('/api/v1/skills/fetch?token=' + encodeURIComponent(token), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ repo: skill.repo })
        });

        const fetchResult = await fetchResp.json();
        if (!fetchResp.ok) {
          throw new Error(fetchResult.error || 'Failed to fetch skill');
        }

        // Add to current skills
        const newSkill = {
          repo: fetchResult.repo,
          name: fetchResult.name || skill.name,
          description: fetchResult.description || skill.description,
          enabled: true,
          content: fetchResult.content,
          contentFetchedAt: fetchResult.fetchedAt
        };

        const updatedSkills = [...currentSkills, newSkill];

        const resp = await fetch('/api/v1/agents/' + encodeURIComponent(agentId) + '/config?token=' + encodeURIComponent(token), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ skillsConfig: { skills: updatedSkills } })
        });

        if (resp.ok) {
          currentSkills = updatedSkills;
          renderSkillsList();

          // Update button to show added
          if (btn) {
            btn.textContent = 'Added ✓';
            btn.className = btn.className.replace('bg-slate-600 hover:bg-slate-700', 'bg-green-600');
          }

          document.getElementById('success-msg').textContent = 'Skill "' + (skill.name || skill.repo) + '" added!';
          document.getElementById('success-msg').classList.remove('hidden');
        } else {
          const result = await resp.json();
          throw new Error(result.error || 'Failed to add skill');
        }
      } catch (e) {
        alert('Error: ' + e.message);
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Add';
        }
      }
    }

    async function addPrefillMcp(index) {
      const mcp = prefillMcpServers[index];
      if (!mcp) return;

      const btn = document.querySelector('#prefill-mcp-' + index + ' button');
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Adding...';
      }

      try {
        // Get current settings to merge MCP servers
        const getResp = await fetch('/api/v1/agents/' + encodeURIComponent(agentId) + '/config?token=' + encodeURIComponent(token));
        const currentConfig = await getResp.json();
        const currentMcpServers = currentConfig.settings?.mcpServers || {};

        // Build MCP server config
        const mcpConfig = {};
        if (mcp.url) mcpConfig.url = mcp.url;
        if (mcp.type) mcpConfig.type = mcp.type;
        if (mcp.command) mcpConfig.command = mcp.command;
        if (mcp.args) mcpConfig.args = mcp.args;
        if (mcp.name) mcpConfig.description = mcp.name;

        // Add to current MCP servers
        const updatedMcpServers = {
          ...currentMcpServers,
          [mcp.id]: mcpConfig
        };

        // If MCP requires env vars, add them to prefill
        if (mcp.envVars && mcp.envVars.length > 0) {
          // Get current env vars
          const currentEnvVars = currentConfig.settings?.envVars || {};
          const envVarsTextarea = document.getElementById('envVars');
          const currentText = envVarsTextarea.value;

          // Add missing env var keys
          let newText = currentText;
          for (const envVar of mcp.envVars) {
            if (!currentEnvVars[envVar] && !currentText.includes(envVar + '=')) {
              newText = newText.trim() + (newText.trim() ? '\\n' : '') + envVar + '=';
            }
          }
          envVarsTextarea.value = newText;

          // Expand env vars section
          const envContent = document.getElementById('envvars-content');
          const envArrow = document.getElementById('envvars-arrow');
          if (envContent && envContent.classList.contains('hidden')) {
            envContent.classList.remove('hidden');
            envArrow.classList.remove('rotate-[-90deg]');
          }
        }

        const resp = await fetch('/api/v1/agents/' + encodeURIComponent(agentId) + '/config?token=' + encodeURIComponent(token), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mcpServers: updatedMcpServers })
        });

        if (resp.ok) {
          // Update button to show added
          if (btn) {
            btn.textContent = 'Added ✓';
            btn.className = btn.className.replace('bg-slate-600 hover:bg-slate-700', 'bg-green-600');
          }

          const mcpName = mcp.name || mcp.id;
          let successMsg = 'MCP server "' + mcpName + '" added!';
          if (mcp.envVars && mcp.envVars.length > 0) {
            successMsg += ' Please fill in the required environment variables below.';
          }
          document.getElementById('success-msg').textContent = successMsg;
          document.getElementById('success-msg').classList.remove('hidden');
        } else {
          const result = await resp.json();
          throw new Error(result.error || 'Failed to add MCP server');
        }
      } catch (e) {
        alert('Error: ' + e.message);
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Add';
        }
      }
    }
  </script>
</body>
</html>`;
}

export function renderErrorPage(message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Settings Error - Lobu</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="min-h-screen bg-gradient-to-br from-red-500 to-red-700 flex items-center justify-center p-5">
  <div class="bg-white rounded-2xl shadow-2xl p-10 max-w-md w-full text-center">
    <div class="text-6xl mb-5">&#10060;</div>
    <h1 class="text-2xl font-bold text-red-600 mb-4">Settings Error</h1>
    <p class="text-gray-600 mb-5">Unable to load settings page.</p>
    <div class="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">
      ${escapeHtml(message)}
    </div>
  </div>
</body>
</html>`;
}
