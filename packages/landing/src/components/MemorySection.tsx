import { connectorModes, faqItems } from "../memory-examples";
import { ExampleShowcase } from "./memory/ExampleShowcase";
import {
  accentPink,
  accentPurple,
  cardBg,
  cardBorder,
  textColor,
  textMuted,
} from "./memory/styles";

function SectionDivider() {
  return <div class="section-divider" />;
}

function GitHubIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 .5C5.65.5.5 5.65.5 12A11.5 11.5 0 0 0 8.36 22.1c.58.1.79-.25.79-.56v-1.95c-3.18.69-3.85-1.35-3.85-1.35-.52-1.31-1.27-1.66-1.27-1.66-1.04-.71.08-.7.08-.7 1.15.08 1.75 1.18 1.75 1.18 1.02 1.76 2.68 1.25 3.34.96.1-.74.4-1.25.72-1.54-2.54-.29-5.2-1.27-5.2-5.64 0-1.25.45-2.28 1.18-3.08-.12-.29-.51-1.47.11-3.06 0 0 .96-.31 3.15 1.18a10.9 10.9 0 0 1 5.74 0c2.18-1.49 3.14-1.18 3.14-1.18.62 1.59.23 2.77.11 3.06.74.8 1.18 1.83 1.18 3.08 0 4.38-2.67 5.35-5.22 5.63.41.36.77 1.08.77 2.18v3.24c0 .31.21.66.8.55A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
}

export function MemorySection() {
  return (
    <section class="pt-32 pb-24 px-4 sm:px-8">
      <div class="max-w-[72rem] mx-auto">
        {/* Hero */}
        <div class="text-center mb-12">
          <h1
            class="text-4xl sm:text-5xl font-bold tracking-tight leading-[1.05] mb-5"
            style={{ color: textColor }}
          >
            Turn data into{" "}
            <span style={{ color: "var(--color-tg-accent)" }}>
              shared, structured memory
            </span>
          </h1>
          <p
            class="text-lg sm:text-xl leading-8 max-w-[52rem] mx-auto m-0"
            style={{ color: textMuted }}
          >
            Connect OpenClaw, ChatGPT, Claude, any MCP client, and any messaging
            app. <br />
            Bring public data, user data, and internal context together.
          </p>
          <div class="flex flex-wrap gap-3 mt-8 justify-center">
            <a
              href="https://owletto.com"
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex items-center rounded-xl px-4 py-2.5 text-sm font-medium border transition-transform hover:-translate-y-0.5"
              style={{
                color: textColor,
                backgroundColor: "rgba(255,255,255,0.04)",
                borderColor: "var(--color-page-border-active)",
              }}
            >
              Try Owletto
            </a>
            <a
              href="/reference/owletto-cli/"
              class="inline-flex items-center rounded-xl px-4 py-2.5 text-sm font-medium"
              style={{ color: textMuted }}
            >
              Getting started with CLI
            </a>
          </div>
        </div>

        {/* Interactive example showcase */}
        <ExampleShowcase />

        <SectionDivider />

        {/* Connectors + auth */}
        <div
          class="rounded-3xl p-6 sm:p-8 border max-w-[48rem] mx-auto"
          style={{
            background:
              "radial-gradient(circle at top right, rgba(244, 114, 182, 0.14), transparent 34%), linear-gradient(180deg, rgba(19, 16, 22, 0.94), rgba(13, 11, 16, 0.9))",
            borderColor: cardBorder,
          }}
        >
          <div
            class="text-xs uppercase tracking-[0.22em] mb-3"
            style={{ color: accentPink }}
          >
            Connectors + auth
          </div>
          <h2
            class="text-3xl tracking-[-0.03em] mt-0 mb-4"
            style={{ color: textColor }}
          >
            Embedded data ingestion
          </h2>
          <div class="grid gap-3">
            {connectorModes.map((mode) => (
              <div
                key={mode.label}
                class="rounded-2xl p-4 border"
                style={{
                  borderColor: "rgba(251, 113, 133, 0.14)",
                  backgroundColor: "rgba(18, 12, 16, 0.45)",
                }}
              >
                <div class="text-sm leading-6" style={{ color: textMuted }}>
                  <span class="font-semibold" style={{ color: textColor }}>
                    {mode.label}.
                  </span>{" "}
                  {mode.text}
                </div>
              </div>
            ))}
          </div>
        </div>

        <SectionDivider />

        {/* FAQ */}
        <div>
          <div class="flex flex-col items-center text-center mb-8">
            <div
              class="text-xs uppercase tracking-[0.22em] mb-3"
              style={{ color: accentPurple }}
            >
              FAQ
            </div>
            <h2
              class="text-3xl sm:text-4xl tracking-[-0.03em]"
              style={{ color: textColor }}
            >
              Common questions
            </h2>
          </div>
          <div class="max-w-[48rem] mx-auto grid gap-4">
            {faqItems.map((item) => (
              <div
                key={item.q}
                class="rounded-2xl p-5 border"
                style={{
                  background: cardBg,
                  borderColor: cardBorder,
                }}
              >
                <h3
                  class="text-base font-semibold mb-2 mt-0"
                  style={{ color: textColor }}
                >
                  {item.q}
                </h3>
                <p class="text-sm leading-6 m-0" style={{ color: textMuted }}>
                  {item.a}{" "}
                  {item.link && (
                    <a
                      href={item.link.href}
                      class="transition-colors hover:opacity-80"
                      style={{ color: "var(--color-tg-accent)" }}
                    >
                      {item.link.label}
                    </a>
                  )}
                </p>
              </div>
            ))}
          </div>
        </div>

        <SectionDivider />

        {/* CTA */}
        <div
          class="rounded-[2rem] p-7 sm:p-10 border"
          style={{
            background:
              "linear-gradient(135deg, rgba(245, 158, 11, 0.12), rgba(14, 14, 18, 0.92) 36%, rgba(56, 189, 248, 0.12))",
            borderColor: "rgba(82, 99, 124, 0.56)",
          }}
        >
          <div class="grid gap-6 lg:grid-cols-[1fr_auto] items-center">
            <div>
              <h2
                class="text-3xl sm:text-4xl tracking-[-0.03em] mt-0 mb-3"
                style={{ color: textColor }}
              >
                Inspect structured memory from any prompt
              </h2>
              <p
                class="text-base leading-7 m-0 max-w-[42rem]"
                style={{ color: textMuted }}
              >
                See the prompt, the extracted record, its relationships, and the
                model log.
              </p>
            </div>
            <div class="flex flex-wrap gap-3">
              <a
                href="https://github.com/lobu-ai/owletto"
                target="_blank"
                rel="noopener noreferrer"
                class="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium border"
                style={{
                  color: textColor,
                  backgroundColor: "rgba(255,255,255,0.05)",
                  borderColor: "var(--color-page-border-active)",
                }}
              >
                <GitHubIcon />
                Owletto on GitHub
              </a>
              <a
                href="/getting-started/memory/"
                class="inline-flex items-center rounded-xl px-4 py-2.5 text-sm font-medium"
                style={{ color: textMuted }}
              >
                Memory docs →
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
