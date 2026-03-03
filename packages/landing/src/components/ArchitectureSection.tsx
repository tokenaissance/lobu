const nodes = [
  {
    label: "Platform",
    sublabel: "Slack, Telegram, API",
    features: [
      "Multi-user with per-agent context",
      "Deploy to any messaging platform",
    ],
  },
  {
    label: "Gateway",
    accent: true,
    features: [
      "HTTP proxy with domain allowlist",
      "MCP proxy with OAuth per user",
      "Secret swapping — workers never see keys",
      "BYO provider keys (Anthropic, OpenAI, etc.)",
    ],
  },
  {
    label: "OpenClaw Runtime",
    sublabel: "sandboxed worker",
    features: [
      "No direct internet access",
      "Owletto memory plugin enabled by default",
      "Nix reproducible environments",
      "Per-thread persistent storage",
    ],
  },
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

function NodeColumn({ node }: { node: (typeof nodes)[0] }) {
  return (
    <div class="flex flex-col items-center flex-1 min-w-0">
      {/* Node box */}
      <div
        class="rounded-lg px-5 py-3 text-center w-full max-w-[180px]"
        style={{
          backgroundColor: node.accent
            ? "rgba(var(--color-tg-accent-rgb), 0.12)"
            : "var(--color-page-surface-dim)",
          border: `1px solid ${node.accent ? "var(--color-tg-accent)" : "var(--color-page-border)"}`,
        }}
      >
        <div
          class="text-sm font-semibold"
          style={{
            color: node.accent
              ? "var(--color-tg-accent)"
              : "var(--color-page-text)",
          }}
        >
          {node.label}
        </div>
        {node.sublabel && (
          <div
            class="text-[10px] mt-0.5"
            style={{ color: "var(--color-page-text-muted)" }}
          >
            {node.sublabel}
          </div>
        )}
      </div>

      {/* Feature list */}
      <ul class="mt-4 space-y-2 w-full max-w-[220px]">
        {node.features.map((f) => (
          <li
            key={f}
            class="text-xs leading-relaxed flex gap-2"
            style={{ color: "var(--color-page-text-muted)" }}
          >
            <span
              class="shrink-0 mt-1 w-1 h-1 rounded-full"
              style={{
                backgroundColor: node.accent
                  ? "var(--color-tg-accent)"
                  : "var(--color-page-text-muted)",
              }}
            />
            {f}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ArchitectureSection() {
  return (
    <section id="architecture" class="py-12 px-8 relative">
      <div class="max-w-3xl mx-auto">
        <h2
          class="text-2xl sm:text-3xl font-bold text-center mb-3 tracking-tight"
          style={{ color: "var(--color-page-text)" }}
        >
          Architecture
        </h2>
        <p
          class="text-center text-sm mb-12 max-w-lg mx-auto"
          style={{ color: "var(--color-page-text-muted)" }}
        >
          Security-first. Zero trust by default.
        </p>

        <div class="flex flex-col md:flex-row items-start justify-center gap-6 md:gap-0">
          <NodeColumn node={nodes[0]} />
          <Arrow />
          <NodeColumn node={nodes[1]} />
          <Arrow />
          <NodeColumn node={nodes[2]} />
        </div>
      </div>
    </section>
  );
}
