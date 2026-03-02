import { TryDropdown } from "./TryDropdown";

const SCHEDULE_CALL_URL = "https://calendar.app.google/LwAk3ecptkJQaYr87";

export function HeroSection() {
  return (
    <section class="pt-28 pb-12 px-8 relative">
      <div class="max-w-2xl mx-auto text-center relative">
        <h1
          class="text-5xl sm:text-6xl font-bold tracking-tight leading-[1.1] mb-5 whitespace-nowrap"
          style={{ color: "var(--color-page-text)" }}
        >
          <span
            style={{
              color: "var(--color-tg-accent)",
            }}
          >
            OpenClaw
          </span>{" "}
          for your team
        </h1>
        <p
          class="text-lg max-w-xl mx-auto mb-8 leading-relaxed"
          style={{ color: "var(--color-page-text-muted)" }}
        >
          Deploy Lobu, and it spins up sandboxed OpenClaw agents on demand for
          every user and channel.
        </p>

        {/* CTA buttons */}
        <div class="flex flex-wrap gap-3 mb-6 justify-center">
          <TryDropdown />
          <a
            href={SCHEDULE_CALL_URL}
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-2 text-sm font-medium px-5 py-2.5 rounded-lg transition-all hover:opacity-90"
            style={{
              color: "var(--color-page-text-muted)",
              border: "1px solid var(--color-page-border)",
            }}
          >
            <svg
              width="14"
              height="14"
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
            Talk to Founder
          </a>
        </div>

        {/* Platform badges */}
        <div
          class="flex flex-wrap items-center gap-3 text-[11px] justify-center"
          style={{ color: "var(--color-page-text-muted)" }}
        >
          <span>Works with</span>
          <span
            class="px-2 py-1 rounded-md"
            style={{
              backgroundColor: "var(--color-page-surface-dim)",
              border: "1px solid var(--color-page-border)",
            }}
          >
            Telegram
          </span>
          <span
            class="px-2 py-1 rounded-md"
            style={{
              backgroundColor: "var(--color-page-surface-dim)",
              border: "1px solid var(--color-page-border)",
            }}
          >
            Slack
          </span>
          <span
            class="px-2 py-1 rounded-md"
            style={{
              backgroundColor: "var(--color-page-surface-dim)",
              border: "1px solid var(--color-page-border)",
            }}
          >
            REST API
          </span>
        </div>
      </div>
    </section>
  );
}
