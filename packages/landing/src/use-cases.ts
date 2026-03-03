import type { UseCase } from "./types";

export const useCases: UseCase[] = [
  {
    id: "setup",
    tabLabel: "Setup",
    title: "Get started in seconds",
    description:
      "Add your own AI provider keys through the settings page — no config files, no terminal.",
    settingsLabel: "Pick your AI provider and model",
    chatLabel: "Bot walks you through setup",
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
    id: "packages",
    tabLabel: "Packages",
    title: "Reproducible environments",
    description:
      "Agents install system packages via Nix. Environments persist across sessions and are fully reproducible.",
    settingsLabel: "Manage installed system packages",
    chatLabel: "Agent requests tools it needs",
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
  {
    id: "skills",
    tabLabel: "Skills",
    title: "Connect skills and integrations",
    description:
      "Install skills that bundle MCP servers and integrations. Mix OAuth and API-key auth in one setup.",
    settingsLabel: "Review skills, MCP servers, and auth",
    chatLabel: "Agent configures dependencies",
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
    title: "Persistent memory with Owletto",
    description:
      "Owletto is the default OpenClaw memory plugin, so important context survives across sessions and compaction.",
    settingsLabel: "Choose and configure memory plugins",
    chatLabel: "Agent stores and recalls long-term context",
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
    title: "Set reminders and recurring tasks",
    description:
      "Agents can schedule one-off reminders or recurring cron jobs. They run autonomously at the specified time.",
    settingsLabel: "View and manage scheduled jobs",
    chatLabel: "Schedule tasks in natural language",
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
    id: "network",
    tabLabel: "Network",
    title: "Fine-grained network access",
    description:
      "Agents have zero internet by default. You allowlist specific domains — agents can't reach anything else.",
    settingsLabel: "Control which domains agents can reach",
    chatLabel: "Agent asks for network access",
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
];
