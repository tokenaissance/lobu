import { useSignal } from "@preact/signals";

const tryOptions = [
  {
    label: "Add to Slack",
    href: "https://community.lobu.ai/slack/install",
    icon: "slack",
  },
  {
    label: "Join Slack Community",
    href: "https://join.slack.com/t/peerbot/shared_invite/zt-391o8tyw2-iyupjTG1xHIz9Og8C7JOnw",
    icon: "slack",
  },
  {
    label: "API Docs",
    href: "https://community.lobu.ai/api/docs",
    icon: "api",
  },
] as const;

export function TryDropdown() {
  const open = useSignal(false);

  return (
    <div class="relative">
      <button
        type="button"
        onClick={() => {
          open.value = !open.value;
        }}
        onBlur={() =>
          setTimeout(() => {
            open.value = false;
          }, 150)
        }
        class="inline-flex items-center gap-2 text-sm font-semibold px-5 py-2.5 rounded-lg transition-all hover:opacity-90"
        style={{
          backgroundColor: "var(--color-page-text)",
          color: "var(--color-page-bg)",
        }}
      >
        Try Now
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          class={`transition-transform ${open.value ? "rotate-180" : ""}`}
          aria-hidden="true"
        >
          <path
            d="M3 5l3 3 3-3"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>

      {open.value && (
        <div
          class="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-56 rounded-lg py-1.5 z-50"
          style={{
            backgroundColor: "var(--color-page-bg-elevated)",
            border: "1px solid var(--color-page-border)",
          }}
        >
          {tryOptions.map((opt) => (
            <a
              key={opt.label}
              href={opt.href}
              target="_blank"
              rel="noopener noreferrer"
              class="flex items-center gap-2.5 px-3.5 py-2 text-sm transition-colors"
              style={{ color: "var(--color-page-text-muted)" }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.backgroundColor =
                  "rgba(255,255,255,0.05)";
                (e.currentTarget as HTMLElement).style.color =
                  "var(--color-page-text)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.backgroundColor =
                  "transparent";
                (e.currentTarget as HTMLElement).style.color =
                  "var(--color-page-text-muted)";
              }}
            >
              {opt.icon === "slack" && (
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zm10.122 2.521a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zm-1.268 0a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zm-2.523 10.122a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zm0-1.268a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" />
                </svg>
              )}
              {opt.icon === "api" && (
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
                  <path d="M4 17l6-6-6-6M12 19h8" />
                </svg>
              )}
              {opt.label}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
