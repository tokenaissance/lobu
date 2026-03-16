import { useSignal } from "@preact/signals";
import { render } from "preact";
import type { EnvVarEntry } from "../settings-page/api";
import * as api from "../settings-page/api";
import { EnvVarRow } from "./EnvVarRow";

declare global {
  interface Window {
    __ADMIN_STATE__: AdminState;
  }
}

interface AdminAgent {
  agentId: string;
  name: string;
  description: string;
  owner: { platform: string; userId: string };
  parentConnectionId: string | null;
  createdAt: number;
  lastUsedAt: number | null;
  connectionCount: number;
  platforms: string[];
}

interface AdminPlugin {
  source: string;
  name: string;
  slot: string;
  enabled: boolean;
  configured: boolean;
  settingsUrl?: string;
}

interface AdminState {
  version: string;
  githubUrl: string;
  deploymentMode: string;
  uptime: number;
  agents: AdminAgent[];
  plugins: AdminPlugin[];
}

const PLATFORM_LABELS: Record<string, string> = {
  telegram: "Telegram",
  slack: "Slack",
  discord: "Discord",
  whatsapp: "WhatsApp",
  teams: "Teams",
};

const PLATFORM_DOMAINS: Record<string, string> = {
  telegram: "telegram.org",
  slack: "slack.com",
  discord: "discord.com",
  whatsapp: "whatsapp.com",
  teams: "teams.microsoft.com",
};

// ─── Top Bar ────────────────────────────────────────────────────────────────

function TopBar({ githubUrl }: { githubUrl: string }) {
  return (
    <div class="sticky top-0 z-10 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between shadow-sm">
      <div class="flex items-center gap-2">
        <span class="w-2 h-2 rounded-full bg-green-400 flex-shrink-0" />
        <span class="font-medium text-sm text-gray-700">Agents</span>
      </div>
      <div class="flex items-center gap-3 text-xs text-gray-400 flex-shrink-0">
        <a
          href="/api/docs"
          target="_blank"
          class="hover:text-gray-600 transition-colors"
          rel="noopener"
        >
          API Docs
        </a>
        {githubUrl && (
          <a
            href={githubUrl}
            target="_blank"
            rel="noreferrer"
            class="hover:text-gray-600 transition-colors"
          >
            GitHub
          </a>
        )}
        <a href="/settings/logout" class="hover:text-red-500 transition-colors">
          Logout
        </a>
      </div>
    </div>
  );
}

// ─── Agent List ─────────────────────────────────────────────────────────────

function AgentRow({ agent }: { agent: AdminAgent }) {
  const settingsUrl = `/settings?agent=${encodeURIComponent(agent.agentId)}`;

  return (
    <a
      href={settingsUrl}
      class="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors border-b border-gray-100 last:border-b-0 group"
    >
      {/* Platform favicons */}
      <div class="flex items-center gap-1 flex-shrink-0 w-8">
        {agent.platforms.length > 0 ? (
          agent.platforms.slice(0, 2).map((p) => {
            const domain = PLATFORM_DOMAINS[p];
            return domain ? (
              <img
                key={p}
                src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`}
                width="16"
                height="16"
                alt={PLATFORM_LABELS[p] || p}
                class="shrink-0"
                title={PLATFORM_LABELS[p] || p}
              />
            ) : null;
          })
        ) : (
          <span class="w-4 h-4 rounded bg-gray-200 flex-shrink-0" />
        )}
      </div>

      {/* Name + description */}
      <div class="min-w-0 flex-1">
        <p class="text-sm font-medium text-gray-800 truncate group-hover:text-gray-900">
          {agent.name}
        </p>
        <p class="text-xs text-gray-400 truncate">
          {agent.description || "No description"}
        </p>
      </div>

      {/* Connection count badge */}
      {agent.connectionCount > 0 && (
        <span class="inline-flex items-center justify-center bg-slate-200 text-slate-600 text-[10px] font-semibold rounded-full min-w-[1.25rem] h-5 px-1.5 flex-shrink-0">
          {agent.connectionCount}
        </span>
      )}

      {/* Arrow */}
      <svg
        class="w-4 h-4 text-gray-300 group-hover:text-gray-500 transition-colors flex-shrink-0"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M9 5l7 7-7 7"
        />
      </svg>
    </a>
  );
}

function AgentList({ initialAgents }: { initialAgents: AdminAgent[] }) {
  const agents = useSignal<AdminAgent[]>(initialAgents);
  const showNewForm = useSignal(false);
  const successMsg = useSignal("");
  const errorMsg = useSignal("");

  // Filter: top-level agents exclude sandboxes
  const topLevelAgents = agents.value.filter((a) => !a.parentConnectionId);

  function flashSuccess(msg: string) {
    successMsg.value = msg;
    setTimeout(() => {
      successMsg.value = "";
    }, 3000);
  }

  function handleAgentCreated(agent: AdminAgent) {
    agents.value = [...agents.value, agent];
    showNewForm.value = false;
    flashSuccess("Agent created!");
  }

  return (
    <div>
      {successMsg.value && (
        <div class="bg-green-100 text-green-800 px-4 py-2 text-xs">
          {successMsg.value}
        </div>
      )}
      {errorMsg.value && (
        <div class="bg-red-100 text-red-800 px-4 py-2 text-xs">
          {errorMsg.value}
        </div>
      )}

      {topLevelAgents.length === 0 && (
        <p class="text-xs text-gray-500 text-center py-8">
          No agents yet. Create one to get started.
        </p>
      )}

      {topLevelAgents.map((agent) => (
        <AgentRow key={agent.agentId} agent={agent} />
      ))}

      {/* Create agent */}
      <div class="px-4 py-3">
        {showNewForm.value ? (
          <NewAgentForm
            onCreated={handleAgentCreated}
            onCancel={() => {
              showNewForm.value = false;
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              showNewForm.value = true;
            }}
            class="w-full py-2 text-xs font-medium rounded-lg border border-dashed border-gray-300 text-gray-500 hover:border-slate-400 hover:text-slate-600 transition-colors"
          >
            + Create Agent
          </button>
        )}
      </div>
    </div>
  );
}

// ─── New Agent Form ─────────────────────────────────────────────────────────

function NewAgentForm({
  onCreated,
  onCancel,
}: {
  onCreated: (agent: AdminAgent) => void;
  onCancel: () => void;
}) {
  const agentId = useSignal("");
  const name = useSignal("");
  const description = useSignal("");
  const formError = useSignal("");
  const formLoading = useSignal(false);

  async function handleSubmit() {
    formError.value = "";
    if (!name.value.trim()) {
      formError.value = "Name is required";
      return;
    }
    if (!agentId.value.trim()) {
      formError.value = "Agent ID is required";
      return;
    }
    formLoading.value = true;
    try {
      await api.createAgent(agentId.value.trim(), name.value.trim());
      onCreated({
        agentId: agentId.value.trim(),
        name: name.value.trim(),
        description: description.value.trim(),
        owner: { platform: "admin", userId: "admin" },
        parentConnectionId: null,
        createdAt: Date.now(),
        lastUsedAt: null,
        connectionCount: 0,
        platforms: [],
      });
    } catch (e: unknown) {
      formError.value =
        e instanceof Error ? e.message : "Failed to create agent";
    } finally {
      formLoading.value = false;
    }
  }

  return (
    <div class="bg-gray-50 rounded-lg p-3 space-y-2">
      <div>
        <label class="block text-xs font-medium text-gray-700 mb-1">
          Agent ID <span class="text-red-500">*</span>
          <input
            type="text"
            value={agentId.value}
            placeholder="my-agent"
            onInput={(e) => {
              agentId.value = (e.target as HTMLInputElement).value;
            }}
            class="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg text-xs font-mono focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none"
          />
        </label>
        <p class="text-[10px] text-gray-400 mt-0.5">
          Lowercase, 3-60 chars, starts with a letter
        </p>
      </div>
      <div>
        <label class="block text-xs font-medium text-gray-700 mb-1">
          Name <span class="text-red-500">*</span>
          <input
            type="text"
            value={name.value}
            placeholder="My Agent"
            onInput={(e) => {
              name.value = (e.target as HTMLInputElement).value;
            }}
            class="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none"
          />
        </label>
      </div>
      <div>
        <label class="block text-xs font-medium text-gray-700 mb-1">
          Description
          <input
            type="text"
            value={description.value}
            placeholder="Optional description"
            onInput={(e) => {
              description.value = (e.target as HTMLInputElement).value;
            }}
            class="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg text-xs focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none"
          />
        </label>
      </div>

      {formError.value && (
        <div class="bg-red-100 text-red-800 px-3 py-2 rounded-lg text-xs">
          {formError.value}
        </div>
      )}

      <div class="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          class="px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition-all"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={formLoading.value}
          onClick={handleSubmit}
          class="px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-600 text-white hover:bg-slate-700 transition-all disabled:opacity-60"
        >
          {formLoading.value ? "Creating..." : "Create Agent"}
        </button>
      </div>
    </div>
  );
}

// ─── Plugins Section ─────────────────────────────────────────────────────────

const SLOT_COLORS: Record<string, string> = {
  memory: "bg-purple-100 text-purple-700",
  tool: "bg-blue-100 text-blue-700",
  provider: "bg-amber-100 text-amber-700",
};

function PluginsSection({ plugins }: { plugins: AdminPlugin[] }) {
  if (plugins.length === 0) return null;
  return (
    <div class="bg-gray-50 rounded-lg p-3">
      <div class="flex items-center gap-2 text-sm font-medium text-gray-800 mb-3">
        Plugins
        <span class="inline-flex items-center justify-center bg-slate-200 text-slate-600 text-[10px] font-semibold rounded-full min-w-[1.25rem] h-5 px-1.5">
          {plugins.length}
        </span>
      </div>
      <div class="bg-white rounded border border-gray-100 divide-y divide-gray-100">
        {plugins.map((p) => (
          <div key={p.source} class="flex items-center gap-3 px-4 py-2.5">
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium text-gray-800">{p.name}</p>
              <p class="text-[10px] text-gray-400 font-mono">{p.source}</p>
            </div>
            <span
              class={`text-[10px] font-semibold rounded-full px-2 py-0.5 ${SLOT_COLORS[p.slot] || "bg-gray-100 text-gray-600"}`}
            >
              {p.slot}
            </span>
            {p.configured && p.enabled ? (
              <span class="inline-flex items-center gap-1 text-[10px] font-semibold text-green-700 bg-green-100 rounded-full px-2 py-0.5">
                <span class="w-1.5 h-1.5 rounded-full bg-green-500" />
                Active
              </span>
            ) : (
              <span class="inline-flex items-center gap-1 text-[10px] font-semibold text-yellow-700 bg-yellow-100 rounded-full px-2 py-0.5">
                <span class="w-1.5 h-1.5 rounded-full bg-yellow-500" />
                Not Configured
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Gateway Section ────────────────────────────────────────────────────────

function GatewaySection({
  envVars,
  onRefreshEnv,
}: {
  envVars: EnvVarEntry[];
  onRefreshEnv: () => void;
}) {
  const isOpen = useSignal(false);
  if (envVars.length === 0) return null;
  return (
    <div class="bg-gray-50 rounded-lg p-3">
      <button
        type="button"
        class="flex w-full items-center gap-2 text-sm font-medium text-gray-800 cursor-pointer select-none bg-transparent border-0 p-0"
        onClick={() => {
          isOpen.value = !isOpen.value;
        }}
      >
        Gateway
        <span class="inline-flex items-center justify-center bg-slate-200 text-slate-600 text-[10px] font-semibold rounded-full min-w-[1.25rem] h-5 px-1.5">
          {envVars.length}
        </span>
        <span
          class={`ml-auto text-xs text-gray-400 transition-transform ${isOpen.value ? "" : "rotate-[-90deg]"}`}
        >
          &#9660;
        </span>
      </button>
      {isOpen.value && (
        <div class="pt-3">
          <div class="bg-white rounded border border-gray-100">
            {envVars.map((entry) => (
              <EnvVarRow
                key={entry.key}
                entry={entry}
                onRefresh={onRefreshEnv}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Env Var Data Hook ──────────────────────────────────────────────────────

function useEnvVars() {
  const vars = useSignal<EnvVarEntry[]>([]);
  const loading = useSignal(true);
  const initialized = useSignal(false);

  const loadVars = () => {
    loading.value = true;
    api
      .listEnvVars()
      .then((data) => {
        vars.value = data;
      })
      .catch(() => {
        // Silently ignore env var load failures
      })
      .finally(() => {
        loading.value = false;
      });
  };

  if (!initialized.value) {
    initialized.value = true;
    loadVars();
  }

  const gateway = vars.value.filter((v) => v.section === "gateway");

  return { gateway, loadVars, loading };
}

// ─── App ────────────────────────────────────────────────────────────────────

function App() {
  const state = window.__ADMIN_STATE__;
  const env = useEnvVars();

  return (
    <div>
      <TopBar githubUrl={state.githubUrl} />
      <div class="p-6 space-y-3">
        <AgentList initialAgents={state.agents} />
        <PluginsSection plugins={state.plugins} />
        <GatewaySection envVars={env.gateway} onRefreshEnv={env.loadVars} />
      </div>
    </div>
  );
}

render(<App />, document.getElementById("app")!);
