import { ScheduleCallButton } from "./ScheduleDialog";

const ApiIcon = () => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d="M4 17l6-6-6-6M12 19h8" />
  </svg>
);

const CalendarIcon = () => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <path d="M16 2v4M8 2v4M3 10h18" />
  </svg>
);

const GITHUB_URL = "https://github.com/lobu-ai/lobu";

export function HeroSection() {
  return (
    <section class="pt-28 pb-12 px-8 relative">
      <div class="max-w-5xl mx-auto text-center relative">
        <h1
          class="text-4xl sm:text-5xl font-bold tracking-tight leading-[1.1] mb-5"
          style={{ color: "var(--color-page-text)" }}
        >
          Serverless{" "}
          <span style={{ whiteSpace: "nowrap" }}>
            <span
              style={{
                color: "var(--color-tg-accent)",
              }}
            >
              Openclaw
            </span>{" "}
            infra
          </span>
        </h1>
        <p
          class="text-lg max-w-2xl mx-auto mb-8 leading-relaxed"
          style={{ color: "var(--color-page-text-muted)" }}
        >
          Computer use agents via REST API, on Slack, Telegram, and WhatsApp.
          <br />
          <a
            href="/guides/security"
            class="underline decoration-dotted underline-offset-2 transition-opacity hover:opacity-80"
            style={{ color: "var(--color-page-text-muted)" }}
          >
            Sandboxed
          </a>
          , persistent, powered by the{" "}
          <a
            href="/getting-started/comparison/"
            class="underline decoration-dotted underline-offset-2 transition-opacity hover:opacity-80"
            style={{ color: "var(--color-page-text-muted)" }}
          >
            OpenClaw runtime
          </a>{" "}
          and{" "}
          <a
            href="/skills-as-saas"
            class="underline decoration-dotted underline-offset-2 transition-opacity hover:opacity-80"
            style={{ color: "var(--color-page-text-muted)" }}
          >
            Lobu Skills
          </a>
          .
        </p>

        {/* CTA buttons */}
        <div class="flex flex-wrap gap-3 mb-8 justify-center">
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-2 text-sm font-semibold px-5 py-2.5 rounded-lg transition-all hover:opacity-90"
            style={{
              backgroundColor: "var(--color-page-text)",
              color: "var(--color-page-bg)",
            }}
          >
            <ApiIcon />
            See GitHub
          </a>
          <ScheduleCallButton
            class="inline-flex items-center gap-2 text-sm font-medium px-5 py-2.5 rounded-lg transition-all hover:opacity-90"
            style={{
              color: "var(--color-page-text-muted)",
              border: "1px solid var(--color-page-border)",
            }}
          >
            <CalendarIcon />
            Talk to Founder
          </ScheduleCallButton>
        </div>
      </div>
    </section>
  );
}
