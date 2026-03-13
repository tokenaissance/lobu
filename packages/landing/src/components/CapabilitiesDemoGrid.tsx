import type { ComponentType } from "preact";
import { useCases } from "../use-cases";
import {
  ConnectionsPanel,
  IntegrationsPanel,
  MemoryPanel,
  ModelsPanel,
  PackagesPanel,
  PermissionsPanel,
  RemindersPanel,
} from "./SettingsPanels";
import { TelegramChat } from "./TelegramChat";

const PANEL_MAP: Record<string, ComponentType> = {
  connections: ConnectionsPanel,
  setup: ModelsPanel,
  packages: PackagesPanel,
  skills: IntegrationsPanel,
  schedules: RemindersPanel,
  network: PermissionsPanel,
  memory: MemoryPanel,
};

type DemoItem = {
  id: string;
  title: string;
  useCaseId: string;
  promptExamples: string[];
  behavior: string;
};

const demoItems: DemoItem[] = [
  {
    id: "platform-connections",
    title: "Platform Connections",
    useCaseId: "connections",
    promptExamples: [
      "Hey, I just added you on Telegram!",
      "What platforms do you support?",
    ],
    behavior:
      "Platforms are connected via the admin page — paste a bot token and the agent is live. No env vars or config files.",
  },
  {
    id: "model-setup",
    title: "Model Setup and Provider Selection",
    useCaseId: "setup",
    promptExamples: [
      "Help me write a blog post",
      "Use groq/llama-3.3-70b for this task",
    ],
    behavior:
      "Agent asks for setup, user picks provider/model in settings, then the same conversation continues immediately.",
  },
  {
    id: "network-security",
    title: "Network and Security Permissions",
    useCaseId: "network",
    promptExamples: [
      "Clone my repo and install dependencies",
      "Allow github.com and rerun the command",
    ],
    behavior:
      "Blocked domains trigger an approval flow. After approval, the agent retries with updated network policy.",
  },
  {
    id: "skills-integrations",
    title: "Skills and Integrations",
    useCaseId: "skills",
    promptExamples: [
      "Install ops-triage and summarize inbox + PRs",
      "Connect Gmail and GitHub now",
    ],
    behavior:
      "Agent proposes skill installation with required integrations, user approves once, then the capability is active.",
  },
  {
    id: "memory-runtime",
    title: "Persistent Memory Runtime",
    useCaseId: "memory",
    promptExamples: [
      "Remember that weekly reports should focus on churn",
      "What preferences do you remember about my reports?",
    ],
    behavior:
      "Memory plugins persist context between sessions and auto-recall relevant facts on new turns.",
  },
  {
    id: "scheduling-runtime",
    title: "Reminders and Recurring Jobs",
    useCaseId: "schedules",
    promptExamples: [
      "Every Monday at 9am check my open PRs",
      "Remind me tomorrow at 2pm to review the deck",
    ],
    behavior:
      "Natural language schedule requests become managed jobs with approval, status, and cancellation support.",
  },
  {
    id: "package-runtime",
    title: "On-demand System Packages",
    useCaseId: "packages",
    promptExamples: [
      "Convert this video to a gif under 5MB",
      "Install ffmpeg and gifsicle first",
    ],
    behavior:
      "Agent requests package installation, user approves, and tools become available in a reproducible environment.",
  },
];

const useCaseById = new Map(useCases.map((uc) => [uc.id, uc]));

function DemoBlock({ item }: { item: DemoItem }) {
  const useCase = useCaseById.get(item.useCaseId);
  if (!useCase) return null;

  const Panel = PANEL_MAP[item.useCaseId];
  if (!Panel) return null;

  return (
    <section style={{ marginBottom: "2rem" }}>
      <h3>{item.title}</h3>
      <p>{item.behavior}</p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(290px, 1fr))",
          gap: "16px",
          alignItems: "start",
          marginTop: "10px",
        }}
      >
        <div>
          <p
            style={{
              fontSize: "12px",
              color: "var(--color-page-text-muted)",
              marginBottom: "8px",
            }}
          >
            Settings panel behavior
          </p>
          <Panel />
        </div>
        <div>
          <p
            style={{
              fontSize: "12px",
              color: "var(--color-page-text-muted)",
              marginBottom: "8px",
            }}
          >
            Chat behavior (same component as homepage)
          </p>
          <TelegramChat useCase={useCase} />
        </div>
      </div>
      <p style={{ marginTop: "10px" }}>
        <strong>Example prompts:</strong> {item.promptExamples.join(" | ")}
      </p>
    </section>
  );
}

export function CapabilitiesDemoGrid() {
  return (
    <div>
      {demoItems.map((item) => (
        <DemoBlock key={item.id} item={item} />
      ))}
    </div>
  );
}
