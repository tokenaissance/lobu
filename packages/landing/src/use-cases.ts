import type { UseCase } from "./types";

export const useCases: UseCase[] = [
  {
    id: "connections",
    tabLabel: "Connections",
    title: "Connect any platform",
    description:
      "Add Telegram, Slack, Discord, WhatsApp, or Teams from the admin page. No env vars — just paste your bot token and go.",
    settingsLabel: "Manage platform connections",
    chatLabel: "Bot works instantly after connecting",
    botName: "Lobu",
    botInitial: "L",
    botColor: "#0ea5e9",
    messages: [
      {
        role: "user",
        text: "Hey, I just added you on Telegram!",
      },
      {
        role: "bot",
        text: "I'm live! Your admin connected me in the admin page — no config files needed.\n\nHow can I help?",
      },
      {
        role: "user",
        text: "What platforms do you support?",
      },
      {
        role: "bot",
        text: "Telegram, Slack, Discord, WhatsApp, and Teams. Your admin can add more anytime from the admin page.",
      },
    ],
  },
  {
    id: "setup",
    tabLabel: "Setup",
    title: "Self-service setup",
    description:
      "Users bring their own AI provider keys via a settings page you don't have to build. No config files, no terminal.",
    settingsLabel: "Pick your AI provider and model",
    chatLabel: "Bot walks users through setup",
    botName: "YourSaaS",
    botInitial: "Y",
    botColor: "#6366f1",
    messages: [
      {
        role: "user",
        text: "Help me write a blog post",
      },
      {
        role: "bot",
        text: "I need an AI model first. Set me up below.",
        buttons: [{ label: "Open Settings", action: "settings" }],
      },
      {
        role: "user",
        text: "Done, let's go",
      },
      {
        role: "bot",
        text: "Here's an outline:\n1. Hook with a question\n2. Key insight + examples\n3. Clear takeaway\n\nExpand any section?",
      },
    ],
  },
  {
    id: "network",
    tabLabel: "Security",
    title: "Zero-trust security",
    description:
      "Agents start with no internet access and never see real credentials. The gateway proxy swaps in secrets at request time and enforces a domain allowlist.",
    settingsLabel: "Domains, MCP proxy, and tool permissions",
    chatLabel: "Agent asks for network access",
    botName: "InfraBot",
    botInitial: "I",
    botColor: "#ef4444",
    messages: [
      {
        role: "user",
        text: "Clone my repo and install dependencies",
      },
      {
        role: "bot",
        text: "Can't reach github.com — not in allowed domains.\n\nGrant access?",
        buttons: [{ label: "Allow for 1 hour", action: "link" }],
      },
      {
        role: "user",
        text: "Allow it permanently",
      },
      {
        role: "bot",
        text: "github.com added to always-allow list.\n\nCloned the repo and ran npm install. Ready to go.",
      },
    ],
  },
  {
    id: "skills",
    tabLabel: "Skills",
    title: "Skills and integrations",
    description:
      "Users install skills that bundle MCP servers and integrations. OAuth and API-key auth handled for you.",
    learnMoreUrl: "/skills",
    settingsLabel: "Review skills, MCP servers, and auth",
    chatLabel: "Agent configures dependencies",
    botName: "OpsTriage",
    botInitial: "O",
    botColor: "#f59e0b",
    messages: [
      {
        role: "user",
        text: "Install my triage skill and summarize inbox + PRs",
      },
      {
        role: "bot",
        text: "Found `ops-triage`.\nNeeds:\n• Gmail MCP (OAuth)\n• GitHub MCP (OAuth)\n• Linear integration (API key)\n\nInstall and connect now?",
        buttons: [{ label: "Install Skill", action: "link" }],
      },
      {
        role: "user",
        text: "Yes, connect everything",
      },
      {
        role: "bot",
        text: "Done. OAuth connected for Gmail/GitHub, Linear API key saved.\n\nSummary:\n• Inbox: 3 urgent emails\n• PRs: 2 need review\n• Linear: 5 high-priority issues",
      },
    ],
  },
  {
    id: "memory",
    tabLabel: "Memory",
    title: "Built-in persistent memory",
    description:
      "Owletto memory plugin is enabled by default. PostgreSQL + pgvector for semantic search, BM25 for keyword recall, and an entity system — auto-recall on every turn, no setup required.",
    settingsLabel: "Choose and configure memory plugins",
    chatLabel: "Agent stores and recalls long-term context",
    botName: "ReportBot",
    botInitial: "R",
    botColor: "#10b981",
    messages: [
      {
        role: "user",
        text: "Remember that my weekly report should focus on customer churn",
      },
      {
        role: "bot",
        text: "Saved to persistent memory via Owletto (default memory plugin). I will use this preference in future reports.",
      },
      {
        role: "user",
        text: "Can I use a different memory backend later?",
      },
      {
        role: "bot",
        text: "Yes. You can switch to another OpenClaw memory plugin, such as native memory, by changing `pluginsConfig`.",
      },
    ],
  },
  {
    id: "schedules",
    tabLabel: "Schedules",
    title: "Scheduling out of the box",
    description:
      "Users set reminders and recurring tasks in natural language. Agents run autonomously at the scheduled time — you don't build the scheduler.",
    settingsLabel: "View and manage scheduled jobs",
    chatLabel: "Schedule tasks in natural language",
    botName: "TaskPilot",
    botInitial: "T",
    botColor: "#8b5cf6",
    messages: [
      {
        role: "user",
        text: "Every Monday 9am, check my PRs",
      },
      {
        role: "bot",
        text: "⏰ Mon 9 AM — check open PRs\n\nApprove?",
        buttons: [{ label: "Approve Schedule", action: "link" }],
      },
      {
        role: "user",
        text: "Yes. Also remind me tomorrow 2pm to review Q1 deck",
      },
      {
        role: "bot",
        text: "Two schedules active:\n1. PR summary — Mon 9 AM (recurring)\n2. Q1 deck — Tomorrow 2 PM (one-off)\n\nI'll ping you when they trigger.",
      },
    ],
  },
  {
    id: "packages",
    tabLabel: "Packages",
    title: "User-installable packages",
    description:
      "Let users install system packages via Nix on demand. Environments persist across sessions and are fully reproducible.",
    settingsLabel: "Manage installed system packages",
    chatLabel: "Agent requests tools it needs",
    botName: "MediaBot",
    botInitial: "M",
    botColor: "#ec4899",
    messages: [
      {
        role: "user",
        text: "Convert this video to a gif under 5MB",
      },
      {
        role: "bot",
        text: "I need ffmpeg and gifsicle. Install them?",
        buttons: [{ label: "Approve Installation", action: "link" }],
      },
      {
        role: "user",
        text: "Go for it",
      },
      {
        role: "bot",
        text: "Installed via Nix. These persist across sessions.\n\nConverting now...",
      },
      {
        role: "bot",
        text: "Done! 4.2 MB (from 28 MB). Adjust frame rate?",
      },
    ],
  },
];
