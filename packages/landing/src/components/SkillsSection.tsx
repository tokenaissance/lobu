import { TerminalLog } from "./TerminalLog";

const GITHUB_URL = "https://github.com/lobu-ai/lobu";

const PROMPT_TEXT = `I am new to Lobu and want to set up a Telegram assistant.

Please:
1. Start with \`npx @lobu/cli --help\` and use it to choose the right commands.
2. Create a new project named \`my-agent\` with \`npx @lobu/cli init my-agent\`.
3. Add the \`google-workspace\` skill.
4. Explain each step in plain language.
5. Provide deployment steps for local testing and production.
6. End with exact commands, including \`cd my-agent && npx @lobu/cli dev -d\`.`;

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
          onClick={(e) => {
            const button = e.currentTarget as HTMLButtonElement;
            const textarea = document.querySelector(
              ".prompt-textarea"
            ) as HTMLTextAreaElement;
            const text = textarea?.value || PROMPT_TEXT;
            navigator.clipboard.writeText(text).then(() => {
              const originalText = button.textContent;
              button.textContent = "Copied";
              setTimeout(() => {
                button.textContent = originalText || "Copy";
              }, 2000);
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

const verticals = [
  {
    name: "Legal",
    description: "Draft contracts, search case law, review clauses",
    skills: ["westlaw-mcp", "contract-drafter", "case-search"],
  },
  {
    name: "DevOps",
    description: "Triage PRs, manage incidents, deploy services",
    skills: ["github-mcp", "pagerduty-mcp", "k8s-tools"],
  },
  {
    name: "Support",
    description: "Route tickets, draft responses, escalate issues",
    skills: ["zendesk-mcp", "knowledge-base", "sentiment"],
  },
  {
    name: "Finance",
    description: "Reconcile accounts, generate reports, flag anomalies",
    skills: ["quickbooks-mcp", "stripe-mcp", "csv-tools"],
  },
];

const anatomy = [
  {
    label: "System Packages",
    description:
      "Declare Nix packages your skill needs (ffmpeg, poppler, gh, ripgrep). Installed once, persisted across sessions. Your agent gets a real Linux environment.",
    badge: "nix",
    color: "bg-cyan-900/40 text-cyan-400 border-cyan-800/50",
  },
  {
    label: "Network Policy",
    description:
      "Agents start with zero internet access. Skills declare exactly which domains are allowed — nothing else gets through.",
    badge: "network",
    color: "bg-red-900/40 text-red-400 border-red-800/50",
  },
  {
    label: "Tool Permissions",
    description:
      "Allowlist and denylist which tools the agent can use. Bash commands, file operations, MCP tools — all scoped per skill.",
    badge: "permissions",
    color: "bg-purple-900/40 text-purple-400 border-purple-800/50",
  },
  {
    label: "MCP Servers",
    description:
      "Connect to external APIs via MCP. Auth is handled by the gateway — workers never see real credentials.",
    badge: "mcp",
    color: "bg-blue-900/40 text-blue-400 border-blue-800/50",
  },
  {
    label: "Integrations",
    description:
      "OAuth and API-key authenticated services. Users connect their own accounts via the settings page.",
    badge: "api",
    color: "bg-amber-900/40 text-amber-400 border-amber-800/50",
  },
  {
    label: "Instructions",
    description:
      "System prompt, behavioral rules, and domain knowledge. The markdown body of SKILL.md becomes the agent's persona.",
    badge: "prompt",
    color: "bg-green-900/40 text-green-400 border-green-800/50",
  },
];

const k = { color: "#7dcfff" }; // keys
const s = { color: "#9ece6a" }; // strings
const d = { color: "#565f89" }; // delimiters / muted
const o = { color: "#ff9e64" }; // booleans / special
const h = { color: "#c0caf5" }; // headings
const m = { color: "#9aa5ce" }; // body text

function SkillYaml() {
  return (
    <pre
      class="p-4 text-[11px] leading-relaxed font-mono overflow-x-auto m-0"
      style={{ backgroundColor: "rgba(0,0,0,0.3)", color: "#9aa5ce" }}
    >
      <code>
        <span style={d}>---</span>
        {"\n"}
        <span style={k}>name</span>: <span style={s}>Ops Triage</span>
        {"\n"}
        <span style={k}>description</span>:{" "}
        <span style={s}>Triage inbox, PRs, and issues</span>
        {"\n"}
        {"\n"}
        <span style={k}>integrations</span>:{"\n"}
        {"  "}- <span style={k}>id</span>: <span style={s}>google</span>
        {"\n"}
        {"    "}
        <span style={k}>authType</span>: <span style={s}>oauth</span>
        {"\n"}
        {"  "}- <span style={k}>id</span>: <span style={s}>linear</span>
        {"\n"}
        {"    "}
        <span style={k}>authType</span>: <span style={s}>api-key</span>
        {"\n"}
        {"\n"}
        <span style={k}>mcpServers</span>:{"\n"}
        {"  "}
        <span style={k}>github-mcp</span>:{"\n"}
        {"    "}
        <span style={k}>url</span>:{" "}
        <span style={s}>https://github-mcp.example.com</span>
        {"\n"}
        {"    "}
        <span style={k}>type</span>: <span style={s}>sse</span>
        {"\n"}
        {"\n"}
        <span style={k}>nixConfig</span>:{"\n"}
        {"  "}
        <span style={k}>packages</span>: <span style={d}>[</span>
        <span style={s}>jq</span>, <span style={s}>gh</span>,{" "}
        <span style={s}>ripgrep</span>
        <span style={d}>]</span>
        {"\n"}
        {"\n"}
        <span style={k}>networkConfig</span>:{"\n"}
        {"  "}
        <span style={k}>allowedDomains</span>:{"\n"}
        {"    "}- <span style={s}>api.github.com</span>
        {"\n"}
        {"    "}- <span style={s}>gmail.googleapis.com</span>
        {"\n"}
        {"    "}- <span style={s}>.linear.app</span>
        {"\n"}
        {"  "}
        <span style={k}>deniedDomains</span>:{"\n"}
        {"    "}- <span style={s}>"*.malicious.com"</span>
        {"\n"}
        {"\n"}
        <span style={k}>toolsConfig</span>:{"\n"}
        {"  "}
        <span style={k}>allowedTools</span>:{"\n"}
        {"    "}- <span style={s}>Read</span>
        {"\n"}
        {"    "}- <span style={s}>Bash(git:*)</span>
        {"\n"}
        {"    "}- <span style={s}>mcp__github__*</span>
        {"\n"}
        {"  "}
        <span style={k}>deniedTools</span>:{"\n"}
        {"    "}- <span style={s}>Bash(rm:*)</span>
        {"\n"}
        {"    "}- <span style={s}>DeleteFile</span>
        {"\n"}
        {"  "}
        <span style={k}>strictMode</span>: <span style={o}>true</span>
        {"\n"}
        <span style={d}>---</span>
        {"\n"}
        {"\n"}
        <span style={h}># Ops Triage</span>
        {"\n"}
        {"\n"}
        <span style={m}>Prioritize by severity. Summarize blockers</span>
        {"\n"}
        <span style={m}>first, then open reviews.</span>
        {"\n"}
        {"\n"}
        <span style={h}>## Behavior</span>
        {"\n"}
        <span style={m}>- Check inbox for urgent emails</span>
        {"\n"}
        <span style={m}>- Review open PRs and flag blockers</span>
        {"\n"}
        <span style={m}>- Summarize Linear issues by priority</span>
        {"\n"}
        {"\n"}
        <span style={h}>## Rules</span>
        {"\n"}
        <span style={m}>- Never auto-close issues without approval</span>
        {"\n"}
        <span style={m}>- Always include links to source threads</span>
        {"\n"}
        <span style={m}>- Escalate P0 issues immediately</span>
      </code>
    </pre>
  );
}

function LobuTomlExample() {
  return (
    <pre
      class="p-4 text-[11px] leading-relaxed font-mono overflow-x-auto m-0"
      style={{ backgroundColor: "rgba(0,0,0,0.3)", color: "#9aa5ce" }}
    >
      <code>
        <span style={d}>[</span>
        <span style={k}>agents.acme-support</span>
        <span style={d}>]</span>
        {"\n"}
        <span style={k}>name</span>
        {" = "}
        <span style={s}>"acme-support"</span>
        {"\n"}
        <span style={k}>description</span>
        {" = "}
        <span style={s}>"Customer support agent for Acme Corp"</span>
        {"\n"}
        <span style={k}>dir</span>
        {" = "}
        <span style={s}>"./agents/acme-support"</span>
        {"\n\n"}
        <span style={d}>{"# LLM providers (order = priority)"}</span>
        {"\n"}
        <span style={d}>[[</span>
        <span style={k}>agents.acme-support.providers</span>
        <span style={d}>]]</span>
        {"\n"}
        <span style={k}>id</span>
        {" = "}
        <span style={s}>"groq"</span>
        {"\n"}
        <span style={k}>key</span>
        {" = "}
        <span style={s}>"$GROQ_API_KEY"</span>
        {"\n\n"}
        <span style={d}>[[</span>
        <span style={k}>agents.acme-support.providers</span>
        <span style={d}>]]</span>
        {"\n"}
        <span style={k}>id</span>
        {" = "}
        <span style={s}>"gemini"</span>
        {"\n"}
        <span style={k}>key</span>
        {" = "}
        <span style={s}>"$GEMINI_API_KEY"</span>
        {"\n\n"}
        <span style={d}>{"# Platform connection"}</span>
        {"\n"}
        <span style={d}>[[</span>
        <span style={k}>agents.acme-support.connections</span>
        <span style={d}>]]</span>
        {"\n"}
        <span style={k}>type</span>
        {" = "}
        <span style={s}>"telegram"</span>
        {"\n"}
        <span style={d}>[</span>
        <span style={k}>agents.acme-support.connections.config</span>
        <span style={d}>]</span>
        {"\n"}
        <span style={k}>botToken</span>
        {" = "}
        <span style={s}>"$TELEGRAM_BOT_TOKEN"</span>
        {"\n\n"}
        <span style={d}>{"# Skills from the registry"}</span>
        {"\n"}
        <span style={d}>[</span>
        <span style={k}>agents.acme-support.skills</span>
        <span style={d}>]</span>
        {"\n"}
        <span style={k}>enabled</span>
        {" = "}
        <span style={d}>[</span>
        <span style={s}>"github"</span>
        <span style={d}>,</span> <span style={s}>"google-workspace"</span>
        <span style={d}>]</span>
        {"\n\n"}
        <span style={d}>{"# Custom MCP server"}</span>
        {"\n"}
        <span style={d}>[</span>
        <span style={k}>agents.acme-support.skills.mcp.my-kb</span>
        <span style={d}>]</span>
        {"\n"}
        <span style={k}>url</span>
        {" = "}
        <span style={s}>"https://mcp.acme.com/sse"</span>
        {"\n\n"}
        <span style={d}>{"# Network sandbox"}</span>
        {"\n"}
        <span style={d}>[</span>
        <span style={k}>agents.acme-support.network</span>
        <span style={d}>]</span>
        {"\n"}
        <span style={k}>allowed</span>
        {" = "}
        <span style={d}>[</span>
        <span style={s}>"api.github.com"</span>
        <span style={d}>,</span> <span style={s}>"registry.npmjs.org"</span>
        <span style={d}>]</span>
      </code>
    </pre>
  );
}

export function SkillsSection() {
  return (
    <section class="pt-28 pb-16 px-8">
      <div class="max-w-3xl mx-auto">
        {/* Hero */}
        <div class="text-center mb-16">
          <h1
            class="text-4xl sm:text-5xl font-bold tracking-tight leading-[1.1] mb-5"
            style={{ color: "var(--color-page-text)" }}
          >
            Build skills, bundle as{" "}
            <span style={{ color: "var(--color-tg-accent)" }}>OpenClaw</span>
          </h1>
          <p
            class="text-lg max-w-xl mx-auto mb-8 leading-relaxed"
            style={{ color: "var(--color-page-text-muted)" }}
          >
            A skill isn't a prompt template — it's a full sandboxed computer.
            System packages, network policies, tool permissions, MCP servers,
            and integrations, all bundled into one installable unit.
          </p>
          <div class="flex flex-wrap gap-3 justify-center">
            <button
              type="button"
              class="skills-hero-copy inline-flex items-center gap-2 text-sm font-semibold px-5 py-2.5 rounded-lg transition-all hover:opacity-90 cursor-pointer"
              style={{
                backgroundColor: "var(--color-page-text)",
                color: "var(--color-page-bg)",
              }}
              onClick={(e) => {
                const button = e.currentTarget as HTMLButtonElement;
                navigator.clipboard.writeText(PROMPT_TEXT).then(() => {
                  const original = button.innerHTML;
                  button.textContent = "Copied!";
                  setTimeout(() => {
                    button.innerHTML = original;
                  }, 2000);
                });
              }}
            >
              <CopyIcon />
              Copy getting started prompt
            </button>
            <a
              href="/getting-started/skills/"
              class="inline-flex items-center gap-2 text-sm font-medium px-5 py-2.5 rounded-lg transition-all hover:opacity-90"
              style={{
                color: "var(--color-page-text-muted)",
                border: "1px solid var(--color-page-border)",
              }}
            >
              Getting Started
            </a>
          </div>

          <div class="flex flex-col md:flex-row items-center md:items-stretch gap-2 md:gap-0 max-w-4xl mx-auto mt-10">
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
                aria-hidden="true"
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
                aria-hidden="true"
              >
                <path d="M12 5v14M5 12l7 7 7-7" />
              </svg>
            </div>
            <div class="flex-1 min-w-0">
              <TerminalLog fill />
            </div>
          </div>
        </div>

        {/* Agent project structure */}
        <div class="mb-16">
          <h2
            class="text-xl font-bold mb-2 text-center"
            style={{ color: "var(--color-page-text)" }}
          >
            Define your agent in files
          </h2>
          <p
            class="text-sm text-center mb-8 max-w-lg mx-auto"
            style={{ color: "var(--color-page-text-muted)" }}
          >
            Each skill declares its own packages, network access, tool
            permissions, and auth — the platform provisions a matching sandbox
            automatically.
          </p>

          {/* Unified block */}
          <div
            class="rounded-xl overflow-hidden mb-6"
            style={{ border: "1px solid var(--color-page-border)" }}
          >
            {/* Top: IDENTITY.md, SOUL.md, USER.md cards */}
            <div
              class="grid grid-cols-1 sm:grid-cols-3"
              style={{ borderBottom: "1px solid var(--color-page-border)" }}
            >
              {[
                {
                  file: "IDENTITY.md",
                  desc: "Who the agent is — persona, name, tone.",
                  badge: "identity",
                  color: "bg-cyan-900/40 text-cyan-400 border-cyan-800/50",
                },
                {
                  file: "SOUL.md",
                  desc: "Behavior rules. What the agent should always or never do.",
                  badge: "rules",
                  color:
                    "bg-purple-900/40 text-purple-400 border-purple-800/50",
                },
                {
                  file: "USER.md",
                  desc: "User-specific context — timezone, preferences.",
                  badge: "context",
                  color: "bg-green-900/40 text-green-400 border-green-800/50",
                },
              ].map((item, i) => (
                <div
                  key={item.file}
                  class="p-5"
                  style={{
                    backgroundColor: "var(--color-page-bg-elevated)",
                    borderRight:
                      i < 2 ? "1px solid var(--color-page-border)" : undefined,
                  }}
                >
                  <div class="flex items-center gap-2 mb-2">
                    <span
                      class={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${item.color}`}
                    >
                      {item.badge}
                    </span>
                    <h3
                      class="text-sm font-semibold font-mono"
                      style={{ color: "var(--color-page-text)" }}
                    >
                      {item.file}
                    </h3>
                  </div>
                  <p
                    class="text-xs leading-relaxed"
                    style={{ color: "var(--color-page-text-muted)" }}
                  >
                    {item.desc}
                  </p>
                </div>
              ))}
            </div>

            {/* Bottom: lobu.toml (left) + skills/*.md (right) */}
            <div class="grid grid-cols-1 md:grid-cols-2">
              {/* lobu.toml */}
              <div
                style={{
                  borderRight: "1px solid var(--color-page-border)",
                }}
              >
                <div
                  class="p-5"
                  style={{
                    backgroundColor: "var(--color-page-bg-elevated)",
                    borderBottom: "1px solid var(--color-page-border)",
                  }}
                >
                  <div class="flex items-center gap-2 mb-2">
                    <span class="text-[10px] font-medium px-2 py-0.5 rounded-full border bg-amber-900/40 text-amber-400 border-amber-800/50">
                      config
                    </span>
                    <h3
                      class="text-sm font-semibold font-mono"
                      style={{ color: "var(--color-page-text)" }}
                    >
                      lobu.toml
                    </h3>
                  </div>
                  <p
                    class="text-xs leading-relaxed"
                    style={{ color: "var(--color-page-text-muted)" }}
                  >
                    Providers, skills, network policy, platforms.
                  </p>
                </div>
                <LobuTomlExample />
              </div>

              {/* skills/*.md */}
              <div>
                <div
                  class="p-5"
                  style={{
                    backgroundColor: "var(--color-page-bg-elevated)",
                    borderBottom: "1px solid var(--color-page-border)",
                  }}
                >
                  <div class="flex items-center gap-2 mb-2">
                    <span class="text-[10px] font-medium px-2 py-0.5 rounded-full border bg-blue-900/40 text-blue-400 border-blue-800/50">
                      skills
                    </span>
                    <h3
                      class="text-sm font-semibold font-mono"
                      style={{ color: "var(--color-page-text)" }}
                    >
                      skills/ops-triage.md
                    </h3>
                  </div>
                  <p
                    class="text-xs leading-relaxed"
                    style={{ color: "var(--color-page-text-muted)" }}
                  >
                    Third-party app integrations, MCP, and sandbox config.
                  </p>
                </div>
                <SkillYaml />
              </div>
            </div>
          </div>

          <div class="text-center">
            <div
              class="inline-flex flex-wrap items-center gap-4 text-xs"
              style={{ color: "var(--color-page-text-muted)" }}
            >
              <code
                class="text-[11px] px-2 py-1 rounded"
                style={{ backgroundColor: "var(--color-page-surface-dim)" }}
              >
                lobu dev
              </code>
              <span>Run locally</span>
              <span style={{ opacity: 0.3 }}>|</span>
              <code
                class="text-[11px] px-2 py-1 rounded"
                style={{ backgroundColor: "var(--color-page-surface-dim)" }}
              >
                lobu launch
              </code>
              <a
                href="/serverless-openclaw"
                class="hover:underline underline-offset-2"
                style={{ color: "var(--color-tg-accent)" }}
              >
                Deploy to cloud →
              </a>
            </div>
          </div>
        </div>

        {/* Anatomy of a skill */}
        <div class="mb-16">
          <h2
            class="text-xl font-bold mb-6 text-center"
            style={{ color: "var(--color-page-text)" }}
          >
            A skill is a full computer
          </h2>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {anatomy.map((item) => (
              <div
                key={item.label}
                class="rounded-xl p-5"
                style={{
                  backgroundColor: "var(--color-page-bg-elevated)",
                  border: "1px solid var(--color-page-border)",
                }}
              >
                <div class="flex items-center gap-2 mb-2">
                  <span
                    class={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${item.color}`}
                  >
                    {item.badge}
                  </span>
                  <h3
                    class="text-sm font-semibold"
                    style={{ color: "var(--color-page-text)" }}
                  >
                    {item.label}
                  </h3>
                </div>
                <p
                  class="text-xs leading-relaxed"
                  style={{ color: "var(--color-page-text-muted)" }}
                >
                  {item.description}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Verticals */}
        <div class="mb-16">
          <h2
            class="text-xl font-bold mb-2 text-center"
            style={{ color: "var(--color-page-text)" }}
          >
            Any vertical, one platform
          </h2>
          <p
            class="text-sm text-center mb-8 max-w-lg mx-auto"
            style={{ color: "var(--color-page-text-muted)" }}
          >
            Build skills for your domain and ship them on Lobu. Users get a
            ready-made agent without touching infrastructure.
          </p>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {verticals.map((v) => (
              <div
                key={v.name}
                class="rounded-xl p-5"
                style={{
                  backgroundColor: "var(--color-page-bg-elevated)",
                  border: "1px solid var(--color-page-border)",
                }}
              >
                <h3
                  class="text-sm font-semibold mb-1"
                  style={{ color: "var(--color-page-text)" }}
                >
                  {v.name}
                </h3>
                <p
                  class="text-xs mb-3 leading-relaxed"
                  style={{ color: "var(--color-page-text-muted)" }}
                >
                  {v.description}
                </p>
                <div class="flex flex-wrap gap-1.5">
                  {v.skills.map((s) => (
                    <span
                      key={s}
                      class="text-[10px] font-mono px-2 py-0.5 rounded"
                      style={{
                        backgroundColor: "var(--color-page-surface-dim)",
                        color: "var(--color-page-text-muted)",
                        border: "1px solid var(--color-page-border)",
                      }}
                    >
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Built-in Registry */}
        <div class="mb-16">
          <h2
            class="text-xl font-bold mb-2 text-center"
            style={{ color: "var(--color-page-text)" }}
          >
            Built-in registry
          </h2>
          <p
            class="text-sm text-center mb-8 max-w-lg mx-auto"
            style={{ color: "var(--color-page-text-muted)" }}
          >
            System skills ship with every agent. Agents discover and install
            additional skills via{" "}
            <code
              class="text-[11px] px-1 py-0.5 rounded"
              style={{ backgroundColor: "var(--color-page-surface-dim)" }}
            >
              SearchSkills
            </code>{" "}
            /{" "}
            <code
              class="text-[11px] px-1 py-0.5 rounded"
              style={{ backgroundColor: "var(--color-page-surface-dim)" }}
            >
              InstallSkill
            </code>
            — users approve through a prefilled settings link.
          </p>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div
              class="rounded-xl p-5"
              style={{
                backgroundColor: "var(--color-page-bg-elevated)",
                border: "1px solid var(--color-page-border)",
              }}
            >
              <div class="flex items-center gap-2 mb-3">
                <span class="text-[10px] font-medium px-2 py-0.5 rounded-full border bg-amber-900/40 text-amber-400 border-amber-800/50">
                  oauth
                </span>
                <h3
                  class="text-sm font-semibold"
                  style={{ color: "var(--color-page-text)" }}
                >
                  Integrations
                </h3>
              </div>
              <div class="flex flex-wrap gap-1.5">
                {[
                  "Google",
                  "GitHub",
                  "Microsoft 365",
                  "Notion",
                  "Linear",
                  "Jira",
                  "Sentry",
                ].map((name) => (
                  <span
                    key={name}
                    class="text-[10px] font-mono px-2 py-0.5 rounded"
                    style={{
                      backgroundColor: "var(--color-page-surface-dim)",
                      color: "var(--color-page-text-muted)",
                      border: "1px solid var(--color-page-border)",
                    }}
                  >
                    {name}
                  </span>
                ))}
              </div>
            </div>
            <div
              class="rounded-xl p-5"
              style={{
                backgroundColor: "var(--color-page-bg-elevated)",
                border: "1px solid var(--color-page-border)",
              }}
            >
              <div class="flex items-center gap-2 mb-3">
                <span class="text-[10px] font-medium px-2 py-0.5 rounded-full border bg-blue-900/40 text-blue-400 border-blue-800/50">
                  mcp
                </span>
                <h3
                  class="text-sm font-semibold"
                  style={{ color: "var(--color-page-text)" }}
                >
                  Memory
                </h3>
              </div>
              <div class="flex flex-wrap gap-1.5">
                <span
                  class="text-[10px] font-mono px-2 py-0.5 rounded"
                  style={{
                    backgroundColor: "var(--color-page-surface-dim)",
                    color: "var(--color-page-text-muted)",
                    border: "1px solid var(--color-page-border)",
                  }}
                >
                  Owletto
                </span>
              </div>
            </div>
            <div
              class="rounded-xl p-5"
              style={{
                backgroundColor: "var(--color-page-bg-elevated)",
                border: "1px solid var(--color-page-border)",
              }}
            >
              <div class="flex items-center gap-2 mb-3">
                <span class="text-[10px] font-medium px-2 py-0.5 rounded-full border bg-green-900/40 text-green-400 border-green-800/50">
                  api-key
                </span>
                <h3
                  class="text-sm font-semibold"
                  style={{ color: "var(--color-page-text)" }}
                >
                  LLM Providers
                </h3>
              </div>
              <div class="flex flex-wrap gap-1.5">
                {[
                  "OpenAI",
                  "Groq",
                  "Gemini",
                  "Together AI",
                  "NVIDIA NIM",
                  "z.ai",
                  "Fireworks",
                  "Mistral",
                  "DeepSeek",
                  "OpenRouter",
                  "Cerebras",
                  "OpenCode Zen",
                  "xAI",
                  "Perplexity",
                  "Cohere",
                  "ElevenLabs",
                ].map((name) => (
                  <span
                    key={name}
                    class="text-[10px] font-mono px-2 py-0.5 rounded"
                    style={{
                      backgroundColor: "var(--color-page-surface-dim)",
                      color: "var(--color-page-text-muted)",
                      border: "1px solid var(--color-page-border)",
                    }}
                  >
                    {name}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div class="text-center mt-6">
            <a
              href="/getting-started/skills/"
              class="text-xs font-medium hover:underline"
              style={{ color: "var(--color-tg-accent)" }}
            >
              See all integrations →
            </a>
          </div>
        </div>

        {/* CTA */}
        <div class="text-center">
          <h2
            class="text-2xl font-bold mb-3"
            style={{ color: "var(--color-page-text)" }}
          >
            Start building skills
          </h2>
          <p
            class="text-sm mb-6 max-w-md mx-auto leading-relaxed"
            style={{ color: "var(--color-page-text-muted)" }}
          >
            Define your vertical. Bundle your integrations. Ship it on Lobu.
          </p>
          <div class="flex flex-wrap gap-3 justify-center">
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex items-center gap-2 text-xs font-medium px-4 py-2 rounded-lg transition-all hover:opacity-80"
              style={{
                backgroundColor: "var(--color-page-surface)",
                color: "var(--color-page-text)",
                border: "1px solid var(--color-page-border-active)",
              }}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
              </svg>
              View on GitHub
            </a>
            <a
              href="/getting-started/skills/"
              class="inline-flex items-center gap-2 text-xs font-medium px-4 py-2 rounded-lg transition-all hover:opacity-80"
              style={{
                color: "var(--color-tg-accent)",
              }}
            >
              Getting Started →
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
