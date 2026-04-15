import providersConfig from "@providers-config";

function PanelShell({
  title,
  children,
}: {
  title: string;
  children: preact.ComponentChildren;
}) {
  return (
    <div
      class="rounded-xl overflow-hidden"
      style={{ border: "1px solid rgba(255,255,255,0.08)" }}
    >
      <div
        class="flex items-center justify-between px-4 py-2.5"
        style={{
          backgroundColor: "var(--color-page-bg-elevated)",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <div class="flex items-center gap-2">
          <div
            class="w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-bold"
            style={{
              backgroundColor: "var(--color-tg-accent)",
            }}
          >
            L
          </div>
          <span class="text-xs font-semibold text-white/80">{title}</span>
        </div>
        <div class="flex gap-1.5">
          <span
            class="w-2.5 h-2.5 rounded-full"
            style={{ backgroundColor: "rgba(255,255,255,0.12)" }}
          />
          <span
            class="w-2.5 h-2.5 rounded-full"
            style={{ backgroundColor: "rgba(255,255,255,0.12)" }}
          />
          <span
            class="w-2.5 h-2.5 rounded-full"
            style={{ backgroundColor: "rgba(255,255,255,0.12)" }}
          />
        </div>
      </div>
      <div class="bg-white p-3">{children}</div>
    </div>
  );
}

function SectionHeader({ emoji, label }: { emoji: string; label: string }) {
  return (
    <div class="flex items-center gap-2 text-sm font-medium text-gray-800 mb-2">
      <span>{emoji}</span>
      <span>{label}</span>
    </div>
  );
}

// --- Connections: Platform connections ---

export function ConnectionsPanel() {
  const connections = [
    {
      platform: "telegram",
      faviconDomain: "telegram.org",
      botName: "Support",
      online: true,
      chats: [
        { name: "Alice Chen", id: "8291045832" },
        { name: "Infra Team", id: "-100204817" },
      ],
    },
    {
      platform: "discord",
      faviconDomain: "discord.com",
      botName: "Internal Marketing",
      online: true,
      chats: [{ name: "#campaigns", id: "109284710" }],
    },
  ];

  return (
    <PanelShell title="Connections">
      <SectionHeader emoji="🔗" label="Connections" />
      <div class="space-y-2">
        {connections.map((c) => (
          <div
            key={c.platform}
            class="p-2.5 bg-white rounded-lg border border-gray-200"
          >
            {/* Connection header */}
            <div class="flex items-center gap-2.5">
              <img
                src={`https://www.google.com/s2/favicons?domain=${c.faviconDomain}&sz=32`}
                alt={c.platform}
                width={20}
                height={20}
                class="w-5 h-5 rounded"
                loading="lazy"
              />
              <span class="text-xs font-semibold text-gray-800">
                {c.botName}
              </span>
              <span
                class={`w-2 h-2 rounded-full ${c.online ? "bg-green-500" : "bg-gray-300"}`}
              />
            </div>
            {/* Nested chats */}
            {c.chats.length > 0 && (
              <div class="ml-4 mt-2 space-y-1 border-l border-gray-200 pl-3">
                {c.chats.map((chat) => (
                  <div key={chat.id} class="flex items-center gap-2">
                    <span class="text-[11px] text-gray-600">{chat.name}</span>
                    <span class="text-[10px] text-gray-400 font-mono">
                      {chat.id}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        <button
          type="button"
          class="w-full text-xs font-medium text-center py-1.5 rounded border border-dashed border-gray-300 text-gray-500"
          disabled
        >
          + Add connection
        </button>
      </div>
    </PanelShell>
  );
}

// --- Setup: Model providers ---

type LandingProviderEntry = {
  providers?: Array<{
    displayName: string;
    defaultModel?: string;
  }>;
};

const modelProviders = (
  providersConfig as { providers: LandingProviderEntry[] }
).providers.flatMap((provider) => provider.providers ?? []);

export function ModelsPanel() {
  const providers = modelProviders.map((provider, index) => ({
    name: provider.displayName,
    model: provider.defaultModel ?? "Auto model",
    selected: index === 0,
    status: "Connected",
  }));

  return (
    <PanelShell title="Models">
      <SectionHeader emoji="🤖" label="Models" />
      <div class="space-y-0 divide-y divide-gray-200 max-h-72 overflow-y-auto pr-1">
        {providers.map((p) => (
          <div
            key={p.name}
            class="flex items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0"
          >
            <div class="flex items-center gap-3 min-w-0">
              <input
                type="radio"
                checked={p.selected}
                readOnly
                class="w-4 h-4 accent-slate-600"
              />
              <div class="min-w-0">
                <p class="text-sm font-medium text-gray-800">{p.name}</p>
                <p class="text-xs text-emerald-600">{p.status}</p>
              </div>
            </div>
            <span class="text-xs text-gray-500 shrink-0">{p.model}</span>
          </div>
        ))}
      </div>
    </PanelShell>
  );
}

// --- Packages: Nix packages ---

export function PackagesPanel() {
  const packages = ["ffmpeg", "gifsicle", "imagemagick"];

  return (
    <PanelShell title="Packages">
      <SectionHeader emoji="📦" label="Packages" />
      <div class="space-y-2">
        {packages.map((pkg) => (
          <div
            key={pkg}
            class="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-1.5"
          >
            <span class="flex-1 text-xs font-mono text-gray-800">{pkg}</span>
            <button
              type="button"
              class="text-xs font-medium text-red-600"
              disabled
            >
              Uninstall
            </button>
          </div>
        ))}
      </div>
    </PanelShell>
  );
}

// --- Skills + Integrations ---

export function IntegrationsPanel() {
  return (
    <PanelShell title="Skills">
      {/* Prefill card — matches the real install flow UI */}
      <div class="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-3">
        <div class="flex items-center gap-2">
          <span class="text-base">⚠️</span>
          <div>
            <p class="text-sm font-semibold text-gray-800">
              Pending changes from your agent
            </p>
            <p class="text-xs text-amber-600">
              Review and approve the requested configuration changes.
            </p>
          </div>
        </div>

        <SectionHeader emoji="⚡" label="Skills" />

        {/* Skill card */}
        <div class="bg-white border border-amber-200 rounded-lg p-2.5 space-y-1.5">
          <div class="space-y-0.5">
            <div class="flex items-center gap-1.5">
              <span class="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 shrink-0">
                skill
              </span>
              <span class="text-xs font-medium text-gray-800">Ops Triage</span>
            </div>
            <p class="text-[10px] text-amber-500 font-mono ml-1">
              system/ops-triage
            </p>
            <p class="text-xs text-gray-500 ml-1">
              Triage inbox, PRs, and issues
            </p>
          </div>

          {/* Nested deps */}
          <div class="ml-4 pl-2 border-l-2 border-purple-100 space-y-1">
            <div class="flex items-center gap-2 py-0.5">
              <span class="text-[9px] uppercase font-bold px-1 py-0.5 rounded bg-gray-100 text-gray-600">
                oauth
              </span>
              <span class="text-[11px] text-gray-600">Google</span>
            </div>
            <div class="flex items-center gap-2 py-0.5">
              <span class="text-[9px] uppercase font-bold px-1 py-0.5 rounded bg-gray-100 text-gray-600">
                oauth
              </span>
              <span class="text-[11px] text-gray-600">GitHub</span>
            </div>
            <div class="flex items-center gap-2 py-0.5">
              <span class="text-[9px] uppercase font-bold px-1 py-0.5 rounded bg-red-50 text-red-600">
                network
              </span>
              <span class="text-[11px] text-gray-600">
                gmail.googleapis.com, api.github.com
              </span>
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div class="flex gap-2">
          <button
            type="button"
            class="px-4 py-1.5 text-xs font-semibold rounded-lg text-white"
            style={{ backgroundColor: "#e67e22" }}
            disabled
          >
            Approve All
          </button>
          <button
            type="button"
            class="px-4 py-1.5 text-xs font-medium rounded-lg border border-gray-300 text-gray-600"
            disabled
          >
            Dismiss
          </button>
        </div>
      </div>
    </PanelShell>
  );
}

// --- Memory: Owletto default plugin ---

export function MemoryPanel() {
  return (
    <PanelShell title="Memory">
      <SectionHeader emoji="🧠" label="Memory Plugins" />
      <div class="space-y-2">
        {/* Owletto — active */}
        <div class="p-2 bg-white rounded border border-gray-100">
          <div class="flex items-center justify-between mb-2">
            <div class="flex items-center gap-2">
              <span class="text-xs font-medium text-slate-700">
                owletto-memory
              </span>
              <span class="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
                default
              </span>
            </div>
            <span class="px-2 py-1 text-xs rounded bg-green-100 text-green-800">
              Enabled
            </span>
          </div>
          <div class="flex flex-wrap gap-1 ml-0.5">
            {[
              "pgvector",
              "BM25 search",
              "entity system",
              "auto-recall",
              "auto-capture",
            ].map((tag) => (
              <span
                key={tag}
                class="text-[9px] px-1.5 py-0.5 rounded bg-violet-50 text-violet-600 border border-violet-100"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>

        {/* Native — disabled */}
        <div class="flex items-center justify-between p-2 bg-white rounded border border-gray-100 opacity-60">
          <div class="flex items-center gap-2">
            <span class="text-xs font-medium text-slate-700">
              native-memory
            </span>
            <span class="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
              optional
            </span>
          </div>
          <span class="px-2 py-1 text-xs rounded bg-slate-100 text-slate-700">
            Disabled
          </span>
        </div>
      </div>
    </PanelShell>
  );
}

// --- Schedules: Reminders ---

export function RemindersPanel() {
  const schedules = [
    {
      task: "Check open PRs and summarize review queue",
      cron: "Every Mon 9:00 AM",
      recurring: true,
      status: "pending",
    },
    {
      task: "Review Q1 deck",
      time: "Tomorrow 2:00 PM",
      recurring: false,
      status: "pending",
    },
  ];

  return (
    <PanelShell title="Schedules">
      <SectionHeader emoji="⏰" label="Reminders" />
      <div class="space-y-2">
        {schedules.map((s) => (
          <div
            key={s.task}
            class="flex items-start justify-between p-2 bg-white rounded border border-gray-200"
          >
            <div class="flex-1 min-w-0">
              <p class="text-xs font-medium text-gray-800 truncate">{s.task}</p>
              <p class="text-xs text-gray-500 mt-0.5">
                <span class="inline-block px-1.5 py-0.5 rounded text-xs bg-slate-100 text-slate-800">
                  {s.status}
                </span>
                {s.recurring && (
                  <span class="inline-block px-1.5 py-0.5 rounded text-xs bg-blue-100 text-blue-800 ml-1">
                    recurring
                  </span>
                )}
                <span class="ml-1">{s.cron || s.time}</span>
              </p>
            </div>
            <button
              type="button"
              class="ml-2 px-2 py-1 text-xs rounded bg-red-100 text-red-700 shrink-0"
              disabled
            >
              Cancel
            </button>
          </div>
        ))}
      </div>
    </PanelShell>
  );
}

// --- Network: Permissions ---

export function PermissionsPanel() {
  const domains = [
    {
      pattern: "github.com",
      badge: "Always",
      color: "bg-green-100 text-green-700",
    },
    {
      pattern: "registry.npmjs.org",
      badge: "Always",
      color: "bg-green-100 text-green-700",
    },
  ];

  const mcpServers = [
    {
      name: "gmail-mcp",
      badge: "Secrets proxied",
      color: "bg-purple-100 text-purple-700",
    },
    {
      name: "github-mcp",
      badge: "Secrets proxied",
      color: "bg-purple-100 text-purple-700",
    },
  ];

  const tools = [
    {
      name: "Bash",
      badge: "Sandboxed",
      color: "bg-amber-100 text-amber-700",
    },
    {
      name: "file_upload",
      badge: "Allowed",
      color: "bg-green-100 text-green-700",
    },
  ];

  return (
    <PanelShell title="Security">
      <SectionHeader emoji="🛡️" label="Domain allowlist" />
      <div class="space-y-1.5 mb-3">
        {domains.map((d) => (
          <div
            key={d.pattern}
            class="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-1.5"
          >
            <span class="flex-1 text-xs font-mono text-gray-800 truncate">
              {d.pattern}
            </span>
            <span
              class={`text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${d.color}`}
            >
              {d.badge}
            </span>
          </div>
        ))}
      </div>
      <SectionHeader emoji="🔌" label="MCP proxy" />
      <div class="space-y-1.5 mb-3">
        {mcpServers.map((m) => (
          <div
            key={m.name}
            class="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-1.5"
          >
            <span class="flex-1 text-xs font-mono text-gray-800 truncate">
              {m.name}
            </span>
            <span
              class={`text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${m.color}`}
            >
              {m.badge}
            </span>
          </div>
        ))}
      </div>
      <SectionHeader emoji="🔧" label="Allowed tools" />
      <div class="space-y-1.5">
        {tools.map((t) => (
          <div
            key={t.name}
            class="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-1.5"
          >
            <span class="flex-1 text-xs font-mono text-gray-800 truncate">
              {t.name}
            </span>
            <span
              class={`text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${t.color}`}
            >
              {t.badge}
            </span>
          </div>
        ))}
      </div>
    </PanelShell>
  );
}
