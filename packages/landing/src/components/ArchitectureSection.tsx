import { ArchitectureDiagram } from "./ArchitectureDiagram";

const relatedPages = [
  {
    title: "Memory",
    description:
      "Turn conversations into shared, structured memory with typed entities and managed auth.",
    href: "/memory",
    linkLabel: "Explore Memory",
  },
  {
    title: "Skills",
    description:
      "Bundle prompts, MCP servers, network policy, and system packages into installable skills.",
    href: "/skills",
    linkLabel: "Explore Skills",
  },
];

export function ArchitectureSection() {
  return (
    <section id="architecture" class="py-12 px-8 relative">
      <div class="max-w-[72rem] mx-auto">
        <h2
          class="text-2xl sm:text-3xl font-bold text-center mb-3 tracking-tight"
          style={{ color: "var(--color-page-text)" }}
        >
          Architecture
        </h2>
        <p
          class="text-center text-sm mb-6 max-w-lg mx-auto"
          style={{ color: "var(--color-page-text-muted)" }}
        >
          Security-first. Zero trust by default. Every agent runs in an isolated
          sandbox with no direct network access.
        </p>

        <div class="hidden xl:grid xl:grid-cols-2 xl:gap-4 xl:mb-8 max-w-4xl mx-auto">
          {relatedPages.map((page) => (
            <a
              key={page.href}
              href={page.href}
              class="block rounded-2xl p-5 transition-transform hover:-translate-y-0.5"
              style={{
                backgroundColor: "var(--color-page-surface)",
                border: "1px solid var(--color-page-border)",
              }}
            >
              <div
                class="text-[11px] uppercase tracking-[0.18em] mb-2"
                style={{ color: "var(--color-tg-accent)" }}
              >
                Related page
              </div>
              <h3
                class="text-lg font-semibold mb-2"
                style={{ color: "var(--color-page-text)" }}
              >
                {page.title}
              </h3>
              <p
                class="text-sm leading-relaxed mb-4"
                style={{ color: "var(--color-page-text-muted)" }}
              >
                {page.description}
              </p>
              <span
                class="text-sm font-medium"
                style={{ color: "var(--color-tg-accent)" }}
              >
                {page.linkLabel} →
              </span>
            </a>
          ))}
        </div>

        <div class="max-w-3xl mx-auto xl:max-w-none">
          <ArchitectureDiagram />
        </div>
      </div>
    </section>
  );
}
