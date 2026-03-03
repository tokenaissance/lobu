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

// --- Setup: Model providers ---

export function ModelsPanel() {
  const providers = [
    {
      name: "Anthropic",
      model: "claude-sonnet-4-20250514",
      selected: true,
      status: "Connected",
    },
    {
      name: "OpenAI",
      model: "Auto model",
      selected: false,
      status: "Connected",
    },
  ];

  return (
    <PanelShell title="Models">
      <SectionHeader emoji="🤖" label="Models" />
      <div class="space-y-0 divide-y divide-gray-200">
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
  const integrations = [
    {
      name: "ops-triage",
      type: "skill",
      auth: "Mixed",
      description: "Bundles Gmail/GitHub MCP + Linear integration",
      enabled: true,
    },
    {
      name: "gmail-mcp",
      type: "mcp",
      auth: "OAuth",
      description: "https://gmail-mcp.example.com/sse",
      enabled: true,
    },
    {
      name: "github-mcp",
      type: "mcp",
      auth: "OAuth",
      description: "https://github-mcp.example.com/sse",
      enabled: true,
    },
    {
      name: "linear",
      type: "integration",
      auth: "API key",
      description: "Linear workspace token configured",
      enabled: true,
    },
  ];

  return (
    <PanelShell title="Integrations">
      <SectionHeader emoji="🔗" label="Integrations" />
      <div class="space-y-2">
        {integrations.map((i) => (
          <div
            key={i.name}
            class="flex items-center justify-between p-2 bg-white rounded border border-gray-100"
          >
            <div class="flex items-center gap-2 flex-1 min-w-0">
              <span class="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 shrink-0">
                {i.type}
              </span>
              <span class="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 shrink-0">
                {i.auth}
              </span>
              <div class="min-w-0">
                <p class="text-xs font-medium text-slate-700">{i.name}</p>
                <p class="text-xs text-gray-500 truncate">{i.description}</p>
              </div>
            </div>
            <span class="px-2 py-1 text-xs rounded bg-green-100 text-green-800 shrink-0">
              Enabled
            </span>
          </div>
        ))}
      </div>
    </PanelShell>
  );
}

// --- Memory: Owletto default plugin ---

export function MemoryPanel() {
  const memoryPlugins = [
    {
      name: "owletto-memory",
      source: "./plugins/openclaw-owletto-plugin.js",
      slot: "memory",
      status: "Default",
      enabled: true,
    },
    {
      name: "native-memory",
      source: "@openclaw/native-memory",
      slot: "memory",
      status: "Optional",
      enabled: false,
    },
  ];

  return (
    <PanelShell title="Memory">
      <SectionHeader emoji="🧠" label="Memory Plugins" />
      <div class="space-y-2">
        {memoryPlugins.map((p) => (
          <div
            key={p.name}
            class="flex items-center justify-between p-2 bg-white rounded border border-gray-100"
          >
            <div class="flex items-center gap-2 flex-1 min-w-0">
              <span class="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 shrink-0">
                {p.slot}
              </span>
              <span class="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 shrink-0">
                {p.status}
              </span>
              <div class="min-w-0">
                <p class="text-xs font-medium text-slate-700">{p.name}</p>
                <p class="text-xs text-gray-500 truncate">{p.source}</p>
              </div>
            </div>
            <span
              class={`px-2 py-1 text-xs rounded shrink-0 ${
                p.enabled
                  ? "bg-green-100 text-green-800"
                  : "bg-slate-100 text-slate-700"
              }`}
            >
              {p.enabled ? "Enabled" : "Disabled"}
            </span>
          </div>
        ))}
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
  const permissions = [
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
    {
      pattern: "api.openai.com",
      badge: "1 hour",
      color: "bg-amber-100 text-amber-700",
    },
    {
      pattern: "pypi.org",
      badge: "Session",
      color: "bg-blue-100 text-blue-700",
    },
  ];

  return (
    <PanelShell title="Permissions">
      <SectionHeader emoji="🛡️" label="Permissions" />
      <div class="space-y-2">
        {permissions.map((p) => (
          <div
            key={p.pattern}
            class="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-1.5"
          >
            <span class="flex-1 text-xs font-mono text-gray-800 truncate">
              {p.pattern}
            </span>
            <span
              class={`text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${p.color}`}
            >
              {p.badge}
            </span>
          </div>
        ))}
      </div>
    </PanelShell>
  );
}
