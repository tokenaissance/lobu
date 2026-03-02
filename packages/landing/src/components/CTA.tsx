import { TryDropdown } from "./TryDropdown";

const GITHUB_URL = "https://github.com/lobu-ai/lobu";
const SCHEDULE_CALL_URL = "https://calendar.app.google/LwAk3ecptkJQaYr87";

export function CTA() {
  return (
    <section class="py-14 px-8 text-center">
      <div class="max-w-2xl mx-auto">
        <h2
          class="text-2xl sm:text-3xl font-bold mb-3 tracking-tight"
          style={{ color: "var(--color-page-text)" }}
        >
          Ready to deploy?
        </h2>
        <p
          class="text-sm mb-8"
          style={{ color: "var(--color-page-text-muted)" }}
        >
          Get running in under a minute — or talk to us about your use case.
        </p>
        <div class="flex flex-wrap justify-center gap-3">
          <TryDropdown />
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-2 text-sm font-medium px-6 py-3 rounded-lg transition-all hover:opacity-90"
            style={{
              backgroundColor: "var(--color-page-surface)",
              color: "var(--color-page-text)",
              border: "1px solid var(--color-page-border-active)",
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
            </svg>
            GitHub
          </a>
          <a
            href={SCHEDULE_CALL_URL}
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-2 text-sm font-medium px-6 py-3 rounded-lg transition-all hover:opacity-90"
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
      </div>
    </section>
  );
}
