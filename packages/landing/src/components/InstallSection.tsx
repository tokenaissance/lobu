const modes = [
  {
    id: "docker",
    label: "Docker Compose",
    description:
      "One-command deployment on a single machine. Best for getting started or small teams.",
    steps: [
      { label: "Scaffold a new project", code: "npx create-lobu my-bot" },
      { label: "Start the stack", code: "cd my-bot && docker compose up -d" },
    ],
  },
  {
    id: "kubernetes",
    label: "Kubernetes",
    description:
      "Install via OCI Helm chart — no repo clone needed. Scales horizontally with your team.",
    steps: [
      {
        label: "Install with Helm",
        code: `helm install lobu oci://ghcr.io/lobu-ai/charts/lobu \\
  --namespace lobu \\
  --create-namespace`,
      },
    ],
  },
];

function ModeColumn({ mode }: { mode: (typeof modes)[0] }) {
  return (
    <div>
      <h3
        class="text-lg font-semibold mb-2"
        style={{ color: "var(--color-page-text)" }}
      >
        {mode.label}
      </h3>
      <p
        class="text-sm leading-relaxed mb-4"
        style={{ color: "var(--color-page-text-muted)" }}
      >
        {mode.description}
      </p>
      <div class="space-y-3">
        {mode.steps.map((step, i) => (
          <div key={`${mode.id}-${i}`}>
            <div
              class="text-[11px] font-medium mb-1.5"
              style={{ color: "var(--color-page-text-muted)" }}
            >
              {step.label}
            </div>
            <div
              class="rounded-lg overflow-hidden font-mono text-[12.5px] leading-[1.6]"
              style={{
                backgroundColor: "var(--color-page-bg-elevated)",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              <pre
                class="p-3.5 m-0 overflow-x-auto"
                style={{ color: "rgba(255,255,255,0.75)" }}
              >
                <span style={{ color: "var(--color-tg-accent)" }}>$</span>{" "}
                {step.code}
              </pre>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function InstallSection() {
  return (
    <section class="py-12 px-8">
      <div class="max-w-3xl mx-auto">
        <h2
          class="text-2xl sm:text-3xl font-bold text-center mb-3 tracking-tight"
          style={{ color: "var(--color-page-text)" }}
        >
          Installation
        </h2>
        <p
          class="text-center text-sm mb-10 max-w-lg mx-auto"
          style={{ color: "var(--color-page-text-muted)" }}
        >
          Deploy with Docker Compose or Kubernetes. From zero to running in
          under a minute.
        </p>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-10">
          {modes.map((mode) => (
            <ModeColumn key={mode.id} mode={mode} />
          ))}
        </div>
      </div>
    </section>
  );
}
