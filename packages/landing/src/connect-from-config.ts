import type { LandingUseCaseShowcase } from "./use-case-showcases";

export type ConnectFromClientId = "chatgpt" | "claude" | "openclaw";

type ConnectFromDocLink = {
  label: string;
  href: string;
};

type ConnectFromDocSection = {
  title: string;
  paragraphs: string[];
};

type ConnectFromClientConfig = {
  id: ConnectFromClientId;
  label: string;
  docsHref: string;
  docsLabel: string;
  command: string;
  startTitle: string;
  describe: (showcase: LandingUseCaseShowcase) => string;
  prompt: (showcase: LandingUseCaseShowcase) => string;
  docsIntro: string[];
  docsNeeds: string[];
  docsSetupTitle: string;
  docsSetupSteps: string[];
  docsSetupNote?: string;
  docsExtraSection?: ConnectFromDocSection;
  docsRelated: ConnectFromDocLink[];
};

export const connectFromClientConfigs: Record<
  ConnectFromClientId,
  ConnectFromClientConfig
> = {
  chatgpt: {
    id: "chatgpt",
    label: "ChatGPT",
    docsHref: "/connect-from/chatgpt/",
    docsLabel: "ChatGPT setup docs",
    command: "npx owletto@latest init",
    startTitle: "Connect ChatGPT in seconds",
    describe: (showcase) =>
      `Use the ${showcase.label.toLowerCase()} Owletto workspace as the shared memory layer for ChatGPT, then reuse the same entities, relations, and watcher outputs from this example.`,
    prompt: (showcase) =>
      `Connect ChatGPT to Owletto for ${showcase.label}. Reuse the same memory model shown here: ${showcase.memory.entityTypes.join(", ")}. Keep ChatGPT pointed at the Owletto workspace for this project so it can search, read, and save shared memory.`,
    docsIntro: [
      "Use your Owletto MCP endpoint (or an org-scoped endpoint for fixed workspaces) as the memory source when connecting from ChatGPT.",
    ],
    docsNeeds: [
      "An Owletto MCP endpoint (shared or org-scoped)",
      "A valid Owletto login",
      "A workspace or organization selected in Owletto",
    ],
    docsSetupTitle: "Connect ChatGPT",
    docsSetupSteps: [
      "Open ChatGPT's MCP connection flow.",
      "Add your Owletto MCP endpoint.",
      "Complete the normal Owletto auth flow.",
      "Verify ChatGPT can access the memory tools you expect.",
    ],
    docsSetupNote:
      "Start with the same endpoint and auth flow described in the Owletto CLI Reference.",
    docsRelated: [
      { label: "Memory", href: "/getting-started/memory/" },
      {
        label: "Owletto CLI Reference",
        href: "/reference/owletto-cli/",
      },
      { label: "Connect from Claude", href: "/connect-from/claude/" },
      {
        label: "Install to OpenClaw",
        href: "/connect-from/openclaw/",
      },
    ],
  },
  claude: {
    id: "claude",
    label: "Claude",
    docsHref: "/connect-from/claude/",
    docsLabel: "Claude setup docs",
    command: "npx owletto@latest init",
    startTitle: "Connect Claude in seconds",
    describe: (showcase) =>
      `Use the ${showcase.label.toLowerCase()} Owletto workspace as the shared memory layer for Claude, then reuse the same entities, relations, and watcher outputs from this example.`,
    prompt: (showcase) =>
      `Connect Claude to Owletto for ${showcase.label}. Reuse the same memory model shown here: ${showcase.memory.entityTypes.join(", ")}. Keep Claude pointed at the Owletto workspace for this project so it can search, read, and save shared memory.`,
    docsIntro: [
      "Use the same Owletto MCP endpoint (or an org-scoped endpoint for fixed workspaces) from Claude when you want Claude-based workflows to read and write shared memory.",
    ],
    docsNeeds: [
      "An Owletto MCP endpoint (shared or org-scoped)",
      "A valid Owletto login",
      "A workspace or organization selected in Owletto",
    ],
    docsSetupTitle: "Connect Claude",
    docsSetupSteps: [
      "Open Claude's MCP connection flow.",
      "Add your Owletto MCP endpoint.",
      "Complete the normal Owletto auth flow.",
      "Verify Claude can access the memory tools you expect.",
    ],
    docsSetupNote:
      "In practice, this uses Claude's MCP connection flow with your Owletto endpoint and standard Owletto auth.",
    docsExtraSection: {
      title: "Claude Code And Claude Desktop",
      paragraphs: [
        "If you are using Claude Code or the Claude Desktop app instead of the hosted Claude client, the setup is usually a mix of local client configuration and project-level instructions.",
        "A practical setup is to run owletto init, run owletto login, then add a local skill or instruction file that tells the agent when to search, read, and save knowledge in Owletto.",
        "That gives you both pieces: MCP or client wiring through the Owletto CLI, plus skill-style instructions for how the coding agent should use memory during work.",
      ],
    },
    docsRelated: [
      { label: "Memory", href: "/getting-started/memory/" },
      { label: "Skills", href: "/getting-started/skills/" },
      {
        label: "Owletto CLI Reference",
        href: "/reference/owletto-cli/",
      },
      { label: "Connect from ChatGPT", href: "/connect-from/chatgpt/" },
      {
        label: "Install to OpenClaw",
        href: "/connect-from/openclaw/",
      },
    ],
  },
  openclaw: {
    id: "openclaw",
    label: "OpenClaw",
    docsHref: "/connect-from/openclaw/",
    docsLabel: "OpenClaw setup docs",
    command: "npx owletto@latest configure",
    startTitle: "Install OpenClaw memory in seconds",
    describe: (showcase) =>
      `Install Owletto into OpenClaw for the ${showcase.label.toLowerCase()} example so OpenClaw can read and write the same shared memory graph shown on this page.`,
    prompt: (showcase) =>
      `Install Owletto memory in OpenClaw for ${showcase.label}. Reuse the same memory model shown here: ${showcase.memory.entityTypes.join(", ")}. Configure OpenClaw to read and write the Owletto workspace for this project.`,
    docsIntro: [
      "For OpenClaw, install and configure the @lobu/owletto-openclaw memory plugin so OpenClaw can read and write Owletto directly.",
      "You can use a shared endpoint or an org-scoped endpoint for fixed workspaces.",
    ],
    docsNeeds: [
      "OpenClaw installed",
      "An Owletto MCP endpoint (shared or org-scoped)",
      "A valid Owletto login",
    ],
    docsSetupTitle: "Install to OpenClaw",
    docsSetupSteps: [
      "Run owletto configure.",
      "Review the generated memory plugin configuration.",
      "Point OpenClaw at the Owletto workspace for your project.",
      "Verify OpenClaw can read and write shared memory.",
    ],
    docsSetupNote:
      "The fastest path is owletto configure, which writes the plugin config for you.",
    docsRelated: [
      { label: "Memory", href: "/getting-started/memory/" },
      {
        label: "Owletto CLI Reference",
        href: "/reference/owletto-cli/",
      },
      { label: "Connect from ChatGPT", href: "/connect-from/chatgpt/" },
      { label: "Connect from Claude", href: "/connect-from/claude/" },
    ],
  },
};

export const connectFromClientIds = Object.keys(
  connectFromClientConfigs
) as ConnectFromClientId[];

export function isConnectFromClientId(
  value: string
): value is ConnectFromClientId {
  return value in connectFromClientConfigs;
}

export function getConnectFromClientConfig(clientId: ConnectFromClientId) {
  return connectFromClientConfigs[clientId];
}
