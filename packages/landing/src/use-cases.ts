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
    id: "mcp",
    tabLabel: "MCP",
    title: "Connect tools via MCP",
    description:
      "Add MCP servers for Gmail, GitHub, and more. Agents authenticate via OAuth — you control what they access.",
    settingsLabel: "Add and authenticate integrations",
    chatLabel: "Agent discovers and uses tools",
    messages: [
      {
        role: "user",
        text: "Summarize my unread emails",
      },
      {
        role: "bot",
        text: "No email access yet. Found a Gmail integration.",
        buttons: [{ label: "Connect Gmail", action: "link" }],
      },
      {
        role: "user",
        text: "Connected",
      },
      {
        role: "bot",
        text: "Inbox summary:\n• 3 from team — sprint planning\n• 1 from CEO — Q1 deck\n• 2 newsletters (skipped)\n\nDraft a reply?",
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
