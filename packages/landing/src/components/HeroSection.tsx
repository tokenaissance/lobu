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
const TELEGRAM_BOT_URL = "https://t.me/lobuaibot";

const TelegramIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden="true"
  >
    <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
  </svg>
);

export function HeroSection() {
  return (
    <section class="pt-28 pb-12 px-8 relative">
      <div class="max-w-5xl mx-auto text-center relative">
        <h1
          class="text-4xl sm:text-5xl font-bold tracking-tight leading-[1.1] mb-5"
          style={{ color: "var(--color-page-text)" }}
        >
          Multi-tenant{" "}
          <span style={{ whiteSpace: "nowrap" }}>
            <span
              style={{
                color: "var(--color-tg-accent)",
              }}
            >
              OpenClaw
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
            href="/skills"
            class="underline decoration-dotted underline-offset-2 transition-opacity hover:opacity-80"
            style={{ color: "var(--color-page-text-muted)" }}
          >
            Lobu Skills
          </a>
          .
        </p>

        {/* CTA buttons */}
        <div class="flex flex-wrap gap-3 mb-5 justify-center">
          <a
            href={TELEGRAM_BOT_URL}
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-2 text-sm font-semibold px-5 py-2.5 rounded-lg transition-all hover:opacity-90"
            style={{
              backgroundColor: "var(--color-page-text)",
              color: "var(--color-page-bg)",
            }}
          >
            <TelegramIcon />
            Try on Telegram
          </a>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-2 text-sm font-medium px-5 py-2.5 rounded-lg transition-all hover:opacity-90"
            style={{
              color: "var(--color-page-text-muted)",
              border: "1px solid var(--color-page-border)",
            }}
          >
            <ApiIcon />
            GitHub
          </a>
        </div>

        {/* Run locally */}
        <div class="flex items-center justify-center gap-2 mb-8">
          <span
            class="text-xs"
            style={{ color: "var(--color-page-text-muted)" }}
          >
            or run locally
          </span>
          <button
            type="button"
            class="hero-copy-btn inline-flex items-center gap-2 font-mono text-[13px] px-4 py-2 rounded-lg transition-all hover:opacity-80 cursor-pointer"
            style={{
              color: "rgba(255,255,255,0.75)",
              backgroundColor: "rgba(0,0,0,0.3)",
              border: "1px solid rgba(255,255,255,0.08)",
            }}
            onClick={(e) => {
              const button = e.currentTarget as HTMLButtonElement;
              navigator.clipboard.writeText("npx @lobu/cli init").then(() => {
                const original = button.innerHTML;
                button.innerHTML =
                  '<span style="color: var(--color-tg-accent)">Copied!</span>';
                setTimeout(() => {
                  button.innerHTML = original;
                }, 2000);
              });
            }}
          >
            <span style={{ color: "var(--color-tg-accent)" }}>$</span> npx
            @lobu/cli init
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              style={{ opacity: 0.5 }}
              aria-hidden="true"
            >
              <rect x="9" y="9" width="13" height="13" rx="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          </button>
        </div>
      </div>
    </section>
  );
}
