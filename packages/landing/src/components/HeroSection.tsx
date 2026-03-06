import { ScheduleCallButton } from "./ScheduleDialog";

const TelegramIcon = () => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden="true"
  >
    <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
  </svg>
);

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

const k = { color: "#7dcfff" }; // keys
const s = { color: "#9ece6a" }; // strings
const d = { color: "#565f89" }; // muted
const c = { color: "#bb9af7" }; // comments

function OutputPanel() {
  return (
    <div
      class="output-panel rounded-xl overflow-hidden h-full flex flex-col"
      style={{ border: "1px solid rgba(255,255,255,0.08)" }}
    >
      <div
        class="flex items-center gap-2 px-4 py-2"
        style={{
          backgroundColor: "rgba(255,255,255,0.03)",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <div class="flex gap-1.5">
          <span
            class="w-2.5 h-2.5 rounded-full"
            style={{ backgroundColor: "rgba(255,255,255,0.12)" }}
          />
          <span
            class="w-2.5 h-2.5 rounded-full"
            style={{ backgroundColor: "rgba(255,255,255,0.12)" }}
          />
          <span
            class="w-2.5 h-2.5 rounded-full"
            style={{ backgroundColor: "rgba(255,255,255,0.12)" }}
          />
        </div>
        <div class="flex gap-0.5 ml-2">
          <button
            type="button"
            class="output-tab px-2.5 py-0.5 rounded text-[10px] font-mono transition-all cursor-pointer"
            style={{
              color: "var(--color-page-text)",
              backgroundColor: "rgba(255,255,255,0.08)",
            }}
            onClick={(e) => {
              const panel = (e.target as HTMLElement).closest(".output-panel");
              if (!panel) return;
              panel.querySelectorAll(".output-tab").forEach((t) => {
                (t as HTMLElement).style.backgroundColor = "transparent";
                (t as HTMLElement).style.color = "var(--color-page-text-muted)";
              });
              (e.target as HTMLElement).style.backgroundColor =
                "rgba(255,255,255,0.08)";
              (e.target as HTMLElement).style.color = "var(--color-page-text)";
              const structure = panel.querySelector(
                ".output-structure"
              ) as HTMLElement;
              const logs = panel.querySelector(".output-logs") as HTMLElement;
              if (structure) {
                structure.style.visibility = "visible";
                structure.style.position = "relative";
              }
              if (logs) {
                logs.style.visibility = "hidden";
                logs.style.position = "absolute";
              }
            }}
          >
            my-agent/
          </button>
          <button
            type="button"
            class="output-tab px-2.5 py-0.5 rounded text-[10px] font-mono transition-all cursor-pointer"
            style={{
              color: "var(--color-page-text-muted)",
              backgroundColor: "transparent",
            }}
            onClick={(e) => {
              const panel = (e.target as HTMLElement).closest(".output-panel");
              if (!panel) return;
              panel.querySelectorAll(".output-tab").forEach((t) => {
                (t as HTMLElement).style.backgroundColor = "transparent";
                (t as HTMLElement).style.color = "var(--color-page-text-muted)";
              });
              (e.target as HTMLElement).style.backgroundColor =
                "rgba(255,255,255,0.08)";
              (e.target as HTMLElement).style.color = "var(--color-page-text)";
              const structure = panel.querySelector(
                ".output-structure"
              ) as HTMLElement;
              const logs = panel.querySelector(".output-logs") as HTMLElement;
              if (structure) {
                structure.style.visibility = "hidden";
                structure.style.position = "absolute";
              }
              if (logs) {
                logs.style.visibility = "visible";
                logs.style.position = "relative";
              }
            }}
          >
            lobu dev
          </button>
        </div>
      </div>

      {/* Tab content wrapper - both tabs rendered, only one visible */}
      <div
        class="relative flex-1"
        style={{ backgroundColor: "rgba(0,0,0,0.3)" }}
      >
        {/* Project structure tab */}
        <div
          class="output-structure p-4 text-[11px] leading-[1.7] font-mono text-left"
          style={{ color: "#9aa5ce" }}
        >
          {(
            [
              {
                name: "lobu.toml",
                comment: "# providers, skills, network",
                color: "#7dcfff",
                href: "/skills-as-saas",
              },
              {
                name: "IDENTITY.md",
                comment: "# who the agent is",
                color: "#7dcfff",
              },
              {
                name: "SOUL.md",
                comment: "# behavior rules",
                color: "#7dcfff",
              },
              { name: "USER.md", comment: "# user context", color: "#7dcfff" },
              { name: "skills/", comment: "", color: "#7dcfff" },
              {
                name: "ops-triage.md",
                comment: "# inbox + PRs + issues",
                color: "#9ece6a",
                indent: true,
              },
              {
                name: "media-tools.md",
                comment: "# ffmpeg, gif conversion",
                color: "#9ece6a",
                indent: true,
              },
              { name: ".env", comment: "# secrets", color: "#565f89" },
              { name: "docker-compose.yml", comment: "", color: "#565f89" },
            ] as Array<{
              name: string;
              comment: string;
              color: string;
              indent?: boolean;
              href?: string;
            }>
          ).map((item) => (
            <div
              key={item.name}
              class="flex"
              style={item.indent ? { paddingLeft: "16px" } : undefined}
            >
              <span
                class="shrink-0"
                style={{
                  width: item.indent ? "164px" : "180px",
                  display: "inline-block",
                }}
              >
                {item.href ? (
                  <a
                    href={item.href}
                    class="underline decoration-dotted underline-offset-2 hover:opacity-80 transition-opacity"
                    style={{ color: item.color }}
                  >
                    {item.name}
                  </a>
                ) : (
                  <span style={{ color: item.color }}>{item.name}</span>
                )}
              </span>
              {item.comment && (
                <span style={{ color: "#bb9af7" }}>{item.comment}</span>
              )}
            </div>
          ))}
        </div>

        {/* Logs tab - invisible but rendered to hold height */}
        <div
          class="output-logs absolute inset-0 p-4 text-[11px] leading-[1.8] font-mono text-left overflow-hidden"
          style={{ visibility: "hidden" }}
        >
          {terminalLines.map((line, i) => (
            <div
              key={i}
              class="terminal-line"
              style={{
                color: lineColors[line.style],
                opacity: 0,
                animation: `fadeIn 0.3s ease-out ${line.delay}ms forwards`,
              }}
            >
              {line.text || "\u00A0"}
            </div>
          ))}
          <style>{`
          @keyframes fadeIn {
            from { opacity: 0; transform: translateY(4px); }
            to { opacity: 1; transform: translateY(0); }
          }
        `}</style>
        </div>
      </div>
      {/* close relative wrapper */}

      {/* Auto-switch to logs tab after 20s */}
      <script
        dangerouslySetInnerHTML={{
          __html: `
        (function() {
          var timer = setTimeout(function() {
            var panel = document.querySelector('.output-panel');
            if (!panel) return;
            var logsTab = panel.querySelectorAll('.output-tab')[1];
            if (logsTab) logsTab.click();
          }, 20000);
          document.addEventListener('visibilitychange', function() {
            if (document.hidden) clearTimeout(timer);
          });
        })();
      `,
        }}
      />
    </div>
  );
}

const PROMPT_TEXT = `Scaffold a Lobu agent with Telegram support using npx @lobu/cli init my-agent, add the google-workspace skill, then start it with cd my-agent && npx @lobu/cli dev -d`;

const CopyIcon = () => (
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
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

const CheckIcon = () => (
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
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

function PromptBlock() {
  return (
    <div
      class="rounded-xl overflow-hidden relative h-full flex flex-col"
      style={{ border: "1px solid rgba(255,255,255,0.08)" }}
    >
      <div
        class="flex items-center justify-between px-4 py-2"
        style={{
          backgroundColor: "rgba(255,255,255,0.03)",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <span
          class="text-[10px] font-mono"
          style={{ color: "var(--color-page-text-muted)" }}
        >
          paste into Claude Code, Codex, or your agent
        </span>
        <button
          type="button"
          class="prompt-copy-btn inline-flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-medium transition-all hover:opacity-80"
          style={{
            color: "var(--color-page-text-muted)",
            backgroundColor: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.08)",
          }}
          onClick={() => {
            const textarea = document.querySelector(
              ".prompt-textarea"
            ) as HTMLTextAreaElement;
            const text = textarea?.value || PROMPT_TEXT;
            navigator.clipboard.writeText(text).then(() => {
              const btn = document.querySelector(".prompt-copy-btn");
              if (btn) {
                btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Copied`;
                setTimeout(() => {
                  btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy`;
                }, 2000);
              }
            });
          }}
        >
          <CopyIcon />
          Copy
        </button>
      </div>
      <textarea
        class="prompt-textarea flex-1 w-full p-4 text-[12.5px] leading-[1.7] text-left resize-none focus:outline-none"
        style={{
          backgroundColor: "rgba(0,0,0,0.3)",
          color: "rgba(255,255,255,0.75)",
          border: "none",
          minHeight: "140px",
        }}
        spellcheck={false}
      >
        {PROMPT_TEXT}
      </textarea>
    </div>
  );
}

const terminalLines = [
  { text: "$ lobu dev -d", style: "command" as const, delay: 0 },
  { text: "[gateway] listening on :8080", style: "info" as const, delay: 800 },
  { text: "[gateway] connected to Redis", style: "info" as const, delay: 1200 },
  {
    text: "[gateway] Telegram bot @my-agent connected",
    style: "success" as const,
    delay: 2000,
  },
  { text: "", style: "info" as const, delay: 2500 },
  {
    text: '[telegram] message from @alex: "What\'s on my calendar today?"',
    style: "incoming" as const,
    delay: 3200,
  },
  {
    text: "[gateway] spawning worker for chat:482910",
    style: "info" as const,
    delay: 3800,
  },
  {
    text: "[worker] session resumed from /workspace",
    style: "info" as const,
    delay: 4400,
  },
  {
    text: "[worker] calling tool: google-workspace.listEvents",
    style: "tool" as const,
    delay: 5200,
  },
  {
    text: "[worker] sending response (142 tokens)",
    style: "success" as const,
    delay: 6200,
  },
  {
    text: "[gateway] worker scaled to zero (idle 30s)",
    style: "info" as const,
    delay: 8000,
  },
];

const lineColors: Record<string, string> = {
  command: "var(--color-tg-accent)",
  info: "rgba(255,255,255,0.4)",
  success: "#9ece6a",
  incoming: "#7dcfff",
  tool: "#bb9af7",
};

export function HeroSection() {
  return (
    <section class="pt-28 pb-12 px-8 relative">
      <div class="max-w-5xl mx-auto text-center relative">
        <h1
          class="text-4xl sm:text-5xl font-bold tracking-tight leading-[1.1] mb-5"
          style={{ color: "var(--color-page-text)" }}
        >
          Deploy{" "}
          <span style={{ whiteSpace: "nowrap" }}>
            <span
              style={{
                color: "var(--color-tg-accent)",
              }}
            >
              autonomous
            </span>{" "}
            AI agents
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
        <div class="flex flex-wrap gap-3 mb-14 justify-center">
          <a
            href="https://t.me/lobuaibot"
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

        {/* Prompt block → project structure */}
        <div class="flex flex-col md:flex-row items-center md:items-stretch gap-4 md:gap-0 max-w-4xl mx-auto">
          <div class="flex-1 min-w-0">
            <PromptBlock />
          </div>
          <div class="flex items-center justify-center px-3">
            <svg
              class="hidden md:block"
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              style={{ color: "var(--color-page-text-muted)", opacity: 0.4 }}
            >
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
            <svg
              class="block md:hidden"
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              style={{ color: "var(--color-page-text-muted)", opacity: 0.4 }}
            >
              <path d="M12 5v14M5 12l7 7 7-7" />
            </svg>
          </div>
          <div class="flex-1 min-w-0">
            <OutputPanel />
          </div>
        </div>
      </div>
    </section>
  );
}
