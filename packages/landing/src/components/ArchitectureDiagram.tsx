const platforms = [
  {
    name: "Telegram",
    detail: "Mini App, inline buttons",
    icon: (
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
      </svg>
    ),
  },
  {
    name: "Slack",
    detail: "Block Kit, interactive actions",
    icon: (
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" />
      </svg>
    ),
  },
  {
    name: "WhatsApp",
    detail: "Reply buttons, list menus",
    icon: (
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
      </svg>
    ),
  },
];

const gatewayLayer = {
  label: "Gateway",
  sublabel: "single egress point",
  features: [
    "Secret swapping — workers never see real keys",
    "HTTP proxy with domain allowlist",
    "MCP proxy with per-user OAuth",
    "BYO provider keys (Anthropic, OpenAI, etc.)",
  ],
};

const runtimeLayer = {
  label: "OpenClaw Runtime",
  sublabel: "per-user isolation",
  features: [
    "One sandbox per user and channel",
    "Kata Containers / Firecracker microVMs / gVisor on GCP",
    "virtualized bash for scaling beyond 1000 users",
    "No direct internet access (internal network)",
    "Nix reproducible environments",
    "OpenTelemetry for observability",
  ],
};

export const infraBadges = [
  {
    label: "Kubernetes",
    color: "bg-blue-900/40 text-blue-400 border-blue-800/50",
  },
  {
    label: "Firecracker",
    color: "bg-orange-900/40 text-orange-400 border-orange-800/50",
  },
  {
    label: "gVisor",
    color: "bg-green-900/40 text-green-400 border-green-800/50",
  },
  {
    label: "just-bash",
    color: "bg-yellow-900/40 text-yellow-400 border-yellow-800/50",
  },
  {
    label: "OpenTelemetry",
    color: "bg-purple-900/40 text-purple-400 border-purple-800/50",
  },
  {
    label: "Kata Containers",
    color: "bg-amber-900/40 text-amber-400 border-amber-800/50",
  },
  { label: "Nix", color: "bg-cyan-900/40 text-cyan-400 border-cyan-800/50" },
];

function Arrow() {
  return (
    <svg
      width="32"
      height="12"
      viewBox="0 0 32 12"
      fill="none"
      class="shrink-0 hidden md:block mt-4"
      aria-hidden="true"
    >
      <line
        x1="0"
        y1="6"
        x2="26"
        y2="6"
        stroke="var(--color-page-text-muted)"
        stroke-width="1.5"
      />
      <polyline
        points="22,2 28,6 22,10"
        stroke="var(--color-page-text-muted)"
        stroke-width="1.5"
        fill="none"
      />
    </svg>
  );
}

function FeatureList({
  features,
  accent,
}: {
  features: string[];
  accent?: boolean;
}) {
  return (
    <ul class="mt-4 space-y-2 w-full max-w-[230px]">
      {features.map((f) => (
        <li
          key={f}
          class="text-xs leading-relaxed flex gap-2"
          style={{ color: "var(--color-page-text-muted)" }}
        >
          <span
            class="shrink-0 mt-1 w-1 h-1 rounded-full"
            style={{
              backgroundColor: accent
                ? "var(--color-tg-accent)"
                : "var(--color-page-text-muted)",
            }}
          />
          {f}
        </li>
      ))}
    </ul>
  );
}

function PlatformColumn() {
  return (
    <div class="flex flex-col items-center flex-1 min-w-0">
      <div class="w-full max-w-[200px] space-y-1.5">
        {platforms.map((p) => (
          <div
            key={p.name}
            class="rounded-lg px-4 py-2 flex items-center gap-2.5"
            style={{
              backgroundColor: "var(--color-page-surface-dim)",
              border: "1px solid var(--color-page-border)",
            }}
          >
            <span style={{ color: "var(--color-page-text-muted)" }}>
              {p.icon}
            </span>
            <div>
              <div
                class="text-xs font-semibold"
                style={{ color: "var(--color-page-text)" }}
              >
                {p.name}
              </div>
              <div
                class="text-[9px]"
                style={{ color: "var(--color-page-text-muted)" }}
              >
                {p.detail}
              </div>
            </div>
          </div>
        ))}
      </div>
      <FeatureList
        features={[
          "Native UI per platform — not just text",
          "Users authenticate with their own accounts",
          "Embedded settings via inline buttons",
        ]}
      />
    </div>
  );
}

function GatewayColumn() {
  return (
    <div class="flex flex-col items-center flex-1 min-w-0">
      <div
        class="rounded-lg px-5 py-3 text-center w-full max-w-[200px]"
        style={{
          backgroundColor: "rgba(var(--color-tg-accent-rgb), 0.12)",
          border: "1px solid var(--color-tg-accent)",
        }}
      >
        <div
          class="text-sm font-semibold"
          style={{ color: "var(--color-tg-accent)" }}
        >
          {gatewayLayer.label}
        </div>
        <div
          class="text-[10px] mt-0.5"
          style={{ color: "var(--color-page-text-muted)" }}
        >
          {gatewayLayer.sublabel}
        </div>
      </div>
      <FeatureList features={gatewayLayer.features} accent />
    </div>
  );
}

function RuntimeColumn() {
  return (
    <div class="flex flex-col items-center flex-1 min-w-0">
      <div class="w-full max-w-[200px] space-y-1.5">
        {["User A", "User B", "User C"].map((user, i) => (
          <div
            key={user}
            class="rounded-lg px-4 py-2 flex items-center justify-between"
            style={{
              backgroundColor: "var(--color-page-surface-dim)",
              border: "1px solid var(--color-page-border)",
              opacity: i === 0 ? 1 : i === 1 ? 0.6 : 0.35,
            }}
          >
            <div class="text-left">
              <div
                class="text-xs font-semibold"
                style={{ color: "var(--color-page-text)" }}
              >
                {runtimeLayer.label}
              </div>
              <div
                class="text-[9px]"
                style={{ color: "var(--color-page-text-muted)" }}
              >
                {user}
              </div>
            </div>
            <span
              class="text-[8px] font-medium px-1.5 py-0.5 rounded-full"
              style={{
                backgroundColor: "rgba(16, 185, 129, 0.15)",
                color: "#10b981",
                border: "1px solid rgba(16, 185, 129, 0.3)",
              }}
            >
              isolated
            </span>
          </div>
        ))}
      </div>
      <FeatureList features={runtimeLayer.features} />
    </div>
  );
}

export function ArchitectureDiagram() {
  return (
    <div class="flex flex-col md:flex-row items-start justify-center gap-6 md:gap-0">
      <PlatformColumn />
      <Arrow />
      <GatewayColumn />
      <Arrow />
      <RuntimeColumn />
    </div>
  );
}
