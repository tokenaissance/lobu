import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";

type CommandHeroProps = {
  title: ComponentChildren;
  description: string;
  command: string;
  prompt?: string;
  commandPrefix?: string;
  commandLabel?: string;
  promptLabel?: string;
  startTitle?: string;
  actions?: ComponentChildren;
  footer?: ComponentChildren;
};

function useCopy(value?: string) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (!value || typeof navigator === "undefined" || !navigator.clipboard) {
      return;
    }

    navigator.clipboard
      .writeText(value)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => undefined);
  };

  return { copied, handleCopy };
}

function CopyButton({
  value,
  label,
}: {
  value?: string;
  label: string;
}) {
  const { copied, handleCopy } = useCopy(value);

  if (!value) return null;

  return (
    <button
      type="button"
      onClick={handleCopy}
      class="text-[11px] font-medium px-2 py-1 rounded-md cursor-pointer transition-colors hover:bg-white/5"
      style={{
        color: copied
          ? "var(--color-tg-accent)"
          : "var(--color-page-text-muted)",
        border: "1px solid var(--color-page-border)",
        backgroundColor: "transparent",
      }}
    >
      {copied ? "Copied" : label}
    </button>
  );
}

function CopyPromptButton({
  prompt,
  label,
}: {
  prompt?: string;
  label: string;
}) {
  const { copied, handleCopy } = useCopy(prompt);
  const [previewOpen, setPreviewOpen] = useState(false);

  if (!prompt) return null;

  return (
    <div class="relative inline-flex">
      <button
        type="button"
        onClick={handleCopy}
        onFocus={() => setPreviewOpen(true)}
        onBlur={() => setPreviewOpen(false)}
        onMouseEnter={() => setPreviewOpen(true)}
        onMouseLeave={() => setPreviewOpen(false)}
        aria-describedby={previewOpen ? "command-hero-prompt-preview" : undefined}
        class="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-medium cursor-pointer transition-colors hover:opacity-90"
        style={{
          backgroundColor: copied
            ? "rgba(122,162,247,0.18)"
            : "var(--color-page-surface)",
          color: "var(--color-page-text)",
          border: "1px solid var(--color-page-border-active)",
        }}
      >
        {copied ? "Copied" : label}
      </button>

      <div
        id="command-hero-prompt-preview"
        role="tooltip"
        class="absolute left-1/2 top-full z-20 mt-3 w-[32rem] max-w-[calc(100vw-2rem)] rounded-xl p-3"
        style={{
          opacity: previewOpen ? 1 : 0,
          pointerEvents: previewOpen ? "auto" : "none",
          transform: previewOpen
            ? "translateX(-50%) translateY(0)"
            : "translateX(-50%) translateY(-4px)",
          transition: "opacity 150ms ease, transform 150ms ease",
          backgroundColor: "var(--color-page-bg-elevated)",
          border: "1px solid var(--color-page-border)",
          boxShadow: "0 18px 50px rgba(0,0,0,0.35)",
        }}
      >
        <div
          class="mb-2 text-[10px] uppercase tracking-[0.18em]"
          style={{ color: "var(--color-page-text-muted)" }}
        >
          Prompt preview
        </div>
        <code
          class="block text-left text-[11px] leading-6 font-mono whitespace-pre-wrap break-words"
          style={{ color: "var(--color-page-text)" }}
        >
          {prompt}
        </code>
      </div>
    </div>
  );
}

export function CommandHero({
  title,
  description,
  command,
  prompt,
  commandPrefix = "$",
  commandLabel = "Copy",
  promptLabel = "Copy prompt",
  startTitle = "Start in seconds",
  actions,
  footer,
}: CommandHeroProps) {
  return (
    <div class="text-center mb-12">
      <h1
        class="text-4xl sm:text-5xl font-bold tracking-tight leading-[1.1] mb-5"
        style={{ color: "var(--color-page-text)" }}
      >
        {title}
      </h1>
      <p
        class="text-lg sm:text-xl leading-8 max-w-[40rem] mx-auto m-0"
        style={{ color: "var(--color-page-text-muted)" }}
      >
        {description}
      </p>

      <div class="mt-10">
        <h2
          class="text-xl font-bold mb-2 text-center"
          style={{ color: "var(--color-page-text)" }}
        >
          {startTitle}
        </h2>

        <div class="flex flex-wrap items-center justify-center gap-3 mb-4">
          {actions}
          <div
            class="inline-flex items-center gap-3 rounded-xl px-4 py-2"
            style={{
              border: "1px solid var(--color-page-border-active)",
              backgroundColor: "rgba(0,0,0,0.3)",
            }}
          >
            <code
              class="text-[13px] font-mono"
              style={{ color: "var(--color-page-text)" }}
            >
              <span style={{ color: "#7aa2f7" }}>{commandPrefix} </span>
              {command}
            </code>
            <CopyButton value={command} label={commandLabel} />
          </div>
          <CopyPromptButton prompt={prompt} label={promptLabel} />
        </div>
      </div>

      {footer ? <div class="mt-6">{footer}</div> : null}
    </div>
  );
}
