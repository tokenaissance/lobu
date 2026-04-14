import {
  landingUseCases,
  type HowItWorksPanel,
  type LandingUseCaseDefinition,
  type LandingUseCaseId,
  type LandingUseCaseMemoryDefinition,
  type LandingUseCaseSkillsDefinition,
  type MemoryExample,
  type SkillWorkspacePreviewData,
} from "./use-case-definitions";

type RuntimeStep = {
  title: string;
  detail: string;
  chips?: string[];
};

type RuntimeJourney = {
  requestLabel: string;
  request: string;
  summary: string;
  steps: RuntimeStep[];
  outcomeLabel: string;
  outcome: string[];
};

type CampaignMeta = {
  title: string;
  description: string;
  seoTitle: string;
  seoDescription: string;
  ctaHref: string;
  ctaLabel: string;
};

export type ShowcaseSkillWorkspacePreview = SkillWorkspacePreviewData & {
  useCaseId: LandingUseCaseId;
};

export type ShowcaseMemoryExample = MemoryExample & {
  useCaseId: LandingUseCaseId;
};

export type LandingUseCaseShowcase = {
  id: LandingUseCaseId;
  label: string;
  campaign: CampaignMeta;
  runtime: RuntimeJourney;
  skills: ShowcaseSkillWorkspacePreview;
  memory: ShowcaseMemoryExample;
};

const docsLinks = {
  owlettoDocs: { label: "What is Owletto?", href: "/getting-started/memory/" },
  mcpProxy: { label: "MCP proxy", href: "/guides/mcp-proxy/" },
  connectorSdk: {
    label: "Connector SDK",
    href: "/reference/owletto-cli/#connector-sdk-and-data-integration",
  },
  memoryDocs: { label: "Memory docs", href: "/getting-started/memory/" },
  mcpAuthFlow: { label: "MCP auth flow", href: "/guides/mcp-proxy/" },
};

const memoryStepPanels: Record<
  LandingUseCaseId,
  Partial<Record<"connect" | "auth" | "reuse", HowItWorksPanel>>
> = {
  legal: {
    connect: {
      title: "Legal source inputs",
      description:
        "The contract graph is built from the systems and artifacts legal teams already use.",
      items: [
        {
          meta: "Upload",
          label: "Draft agreement",
          detail:
            "Capture the latest NDA, redlines, or negotiated fallback language directly from a file upload.",
        },
        {
          meta: "Sync",
          label: "Shared legal drive",
          detail:
            "Pull prior templates, playbooks, and approved fallback clauses from the team document workspace.",
        },
        {
          meta: "MCP",
          label: "Research tools",
          detail:
            "Bring in legal research or internal clause libraries through MCP-backed integrations.",
        },
        {
          meta: "Pipeline",
          label: "Clause extraction",
          detail:
            "Feed parser output into structured entities so venue, residuals, and term risk stay queryable.",
        },
      ],
    },
    auth: {
      title: "How access is handled",
      description:
        "Operators connect the data source once, and workers only receive the approved memory/tool surface.",
      items: [
        {
          meta: "OAuth",
          label: "Drive and document systems",
          detail:
            "Counsel can connect shared docs without exposing tokens to the review agent.",
        },
        {
          meta: "Credential",
          label: "Research providers",
          detail:
            "API-backed legal tools stay behind the gateway proxy with centrally managed secrets.",
        },
        {
          meta: "Manual",
          label: "Negotiated drafts",
          detail:
            "One-off uploads work even when a contract never lives in a connected SaaS app.",
        },
        {
          meta: "Isolation",
          label: "Runtime boundary",
          detail:
            "The worker sees extracted context and proxy URLs, not raw account credentials.",
        },
      ],
    },
    reuse: {
      title: "Legal agents",
      description:
        "The same contract memory powers legal agents wherever teams work.",
      items: [
        {
          label: "Risk review agent",
          detail:
            "Flags unresolved clauses and approval blockers in active negotiations.",
          platform: { id: "slack", label: "Slack" },
        },
        {
          label: "Negotiation assistant",
          detail:
            "Recalls fallback language and prior concessions before the next draft.",
          platform: { id: "claude", label: "Claude" },
        },
        {
          label: "Counterparty brief agent",
          detail:
            "Summarizes prior asks, objections, and open terms for the same external party.",
          platform: { id: "chatgpt", label: "ChatGPT" },
        },
        {
          label: "Draft prep workflow",
          detail:
            "Carries approved edits and unresolved risks into the next review cycle.",
          platform: { id: "openclaw", label: "OpenClaw" },
        },
      ],
    },
  },
  devops: {
    connect: {
      title: "Operational events",
      description:
        "Turn live operational signals into structured incident memory.",
      table: {
        columns: ["Entity", "Events", "Sources", "Added context"],
        rows: [
          [
            "Alerts",
            "Triggered, resolved, severity changed",
            "PagerDuty, Datadog",
            "State, urgency, impact",
          ],
          [
            "Code",
            "PRs, fixes, rollbacks",
            "GitHub, GitLab",
            "Change timeline",
          ],
          [
            "Deploys",
            "Started, failed, rolled back",
            "CI/CD, Argo, Kubernetes",
            "Rollout history",
          ],
          [
            "Notes",
            "Updates, handoffs, comments",
            "Slack, incident tools",
            "Decisions and context",
          ],
        ],
      },
    },
    auth: {
      title: "Connected accounts",
      description:
        "Let teams bring the tools they already use, while keeping credentials outside the worker.",
      table: {
        columns: ["Account", "Brought by", "Access", "Used for"],
        rows: [
          [
            "GitHub / GitLab",
            "User",
            "OAuth",
            "PRs, commits, diffs",
          ],
          [
            "Slack / Linear / Notion",
            "User",
            "OAuth",
            "Notes, tickets, team context",
          ],
          [
            "PagerDuty / Datadog",
            "User or admin",
            "OAuth / token",
            "Alerts and incident state",
          ],
          [
            "AWS / GCP / Kubernetes",
            "Org admin",
            "Service account",
            "Infra and deploy metadata",
          ],
          [
            "Incident history",
            "Org",
            "Import / sync",
            "Memory bootstrap",
          ],
        ],
      },
    },
    reuse: {
      title: "DevOps agents",
      description:
        "The same incident memory powers operational agents wherever teams work.",
      items: [
        {
          label: "Incident responder",
          detail:
            "Answers what broke, what changed, and what’s blocked now.",
          platform: { id: "slack", label: "Slack" },
        },
        {
          label: "Deploy safety agent",
          detail:
            "Checks rollback readiness and deploy risk before action.",
          platform: { id: "openclaw", label: "OpenClaw" },
        },
        {
          label: "Status update agent",
          detail:
            "Drafts current impact and remediation updates from live state.",
          platform: { id: "chatgpt", label: "ChatGPT" },
        },
        {
          label: "Postmortem assistant",
          detail:
            "Reuses the same timeline for follow-up analysis and action items.",
          platform: { id: "claude", label: "Claude" },
        },
      ],
    },
  },
  support: {
    connect: {
      title: "Support source inputs",
      description:
        "Relationship memory comes from the same channels support teams already work in every day.",
      items: [
        {
          meta: "Inbox",
          label: "Message threads",
          detail:
            "Capture promises, preference changes, and ownership notes directly from conversations.",
        },
        {
          meta: "CRM",
          label: "Account sync",
          detail:
            "Pull company context, owners, and lifecycle state from the customer system of record.",
        },
        {
          meta: "Email",
          label: "Follow-up history",
          detail:
            "Attach promised summaries, deadlines, and replies to the right person record.",
        },
        {
          meta: "Knowledge",
          label: "Internal tools",
          detail:
            "Bring in structured account data or operational notes through MCP and custom integrations.",
        },
      ],
    },
    auth: {
      title: "How customer data is connected",
      description:
        "Support teams can authorize inboxes, CRMs, and imports without handing secrets to the runtime.",
      items: [
        {
          meta: "OAuth",
          label: "Inbox and calendar context",
          detail:
            "Connect communication tools so preferences and follow-ups stay in sync.",
        },
        {
          meta: "API key",
          label: "Internal support systems",
          detail:
            "Store scoped credentials centrally for ticketing or account lookup tools.",
        },
        {
          meta: "Import",
          label: "Historical contacts",
          detail:
            "Load CSV or manual records to seed memory before the next live conversation.",
        },
        {
          meta: "Isolation",
          label: "Agent boundary",
          detail:
            "The support agent receives context, not the raw credentials behind it.",
        },
      ],
    },
    reuse: {
      title: "Support agents",
      description:
        "The same relationship memory powers support agents wherever teams work.",
      items: [
        {
          label: "Support responder",
          detail:
            "Drafts replies that match customer preferences and the latest promises.",
          platform: { id: "slack", label: "Slack" },
        },
        {
          label: "Handoff assistant",
          detail:
            "Keeps owners, commitments, and next steps intact when a case moves teams.",
          platform: { id: "claude", label: "Claude" },
        },
        {
          label: "Account context agent",
          detail:
            "Recalls who the contact is, what they own, and what was promised last.",
          platform: { id: "chatgpt", label: "ChatGPT" },
        },
        {
          label: "Follow-up workflow",
          detail:
            "Turns prior asks into durable next actions that future workflows can pick up.",
          platform: { id: "openclaw", label: "OpenClaw" },
        },
      ],
    },
  },
  finance: {
    connect: {
      title: "Finance source inputs",
      description:
        "Variance memory stays credible because it is tied back to ledgers, payment systems, and close artifacts.",
      items: [
        {
          meta: "ERP",
          label: "General ledger data",
          detail:
            "Pull account state and period close context from the finance system of record.",
        },
        {
          meta: "Payments",
          label: "Stripe payouts and refunds",
          detail:
            "Bring payout timing and refund behavior into the same variance graph.",
        },
        {
          meta: "Import",
          label: "CSV reconciliations",
          detail:
            "Load one-off analyses and exceptions without losing the source artifact behind them.",
        },
        {
          meta: "Workflow",
          label: "Close checklist",
          detail:
            "Connect reporting milestones and unresolved items to the same operational record.",
        },
      ],
    },
    auth: {
      title: "How finance data is connected",
      description:
        "Sensitive financial access stays scoped and auditable while agents still get the context they need.",
      items: [
        {
          meta: "API key",
          label: "Finance SaaS tools",
          detail:
            "Use centrally managed credentials for accounting and payment providers.",
        },
        {
          meta: "Service account",
          label: "Internal pipelines",
          detail:
            "Attach warehouse or reconciliation jobs without exposing long-lived secrets.",
        },
        {
          meta: "Manual",
          label: "Exception imports",
          detail:
            "Allow operators to load one-off close evidence when automation is not the right path.",
        },
        {
          meta: "Isolation",
          label: "Worker boundary",
          detail:
            "The agent reasons over reconciled state, not raw credentials or unrestricted system access.",
        },
      ],
    },
    reuse: {
      title: "Finance agents",
      description:
        "The same variance memory powers finance agents wherever teams work.",
      items: [
        {
          label: "Variance analyst",
          detail:
            "Explains why an account moved and what still needs reconciliation before close.",
          platform: { id: "slack", label: "Slack" },
        },
        {
          label: "Reporting assistant",
          detail:
            "Carries reconciliation context into month-end updates and leadership reporting.",
          platform: { id: "claude", label: "Claude" },
        },
        {
          label: "Exception triage agent",
          detail:
            "Surfaces which refunds, payouts, or adjustments still need owner follow-up.",
          platform: { id: "chatgpt", label: "ChatGPT" },
        },
        {
          label: "Audit prep workflow",
          detail:
            "Keeps explanations attached to the originating systems and imported evidence.",
          platform: { id: "openclaw", label: "OpenClaw" },
        },
      ],
    },
  },
  sales: {
    connect: {
      title: "Revenue source inputs",
      description:
        "Account memory is strongest when commercial, product, and support signals land in one graph.",
      items: [
        {
          meta: "CRM",
          label: "Account updates",
          detail:
            "Track account ownership, renewal timing, and opportunity movement from the CRM.",
        },
        {
          meta: "Product",
          label: "Usage and rollout signals",
          detail:
            "Bring expansion health and adoption trends into the renewal story.",
        },
        {
          meta: "Support",
          label: "Risk signals",
          detail:
            "Attach escalations and service friction to the same account record.",
        },
        {
          meta: "Notes",
          label: "Internal call notes",
          detail:
            "Preserve pricing concerns, champion feedback, and next steps from humans in the loop.",
        },
      ],
    },
    auth: {
      title: "How revenue systems are connected",
      description:
        "Sales and ops tools can be authorized safely while memory stays reusable across agents.",
      items: [
        {
          meta: "OAuth",
          label: "CRM and GTM SaaS",
          detail:
            "Connect account systems without injecting raw tokens into the worker.",
        },
        {
          meta: "API key",
          label: "Product and support data",
          detail:
            "Store provider credentials centrally for telemetry or health signals.",
        },
        {
          meta: "Service account",
          label: "Internal pipelines",
          detail:
            "Sync warehouse or scoring outputs into the account graph on a schedule.",
        },
        {
          meta: "Import",
          label: "Historical account state",
          detail:
            "Seed memory from spreadsheets or exports before automations are wired up.",
        },
      ],
    },
    reuse: {
      title: "Revenue agents",
      description:
        "The same account memory powers revenue agents wherever teams work.",
      items: [
        {
          label: "Renewal prep agent",
          detail:
            "Pulls current risks, owners, and blockers before a customer call or QBR.",
          platform: { id: "slack", label: "Slack" },
        },
        {
          label: "Forecast brief assistant",
          detail:
            "Generates consistent leadership updates from the same account memory.",
          platform: { id: "claude", label: "Claude" },
        },
        {
          label: "Expansion context agent",
          detail:
            "Recalls which team owns the rollout, where adoption is growing, and what is blocking expansion.",
          platform: { id: "chatgpt", label: "ChatGPT" },
        },
        {
          label: "Next-step workflow",
          detail:
            "Hands the right commercial follow-up to chat agents and planning tools.",
          platform: { id: "openclaw", label: "OpenClaw" },
        },
      ],
    },
  },
  delivery: {
    connect: {
      title: "Project source inputs",
      description:
        "Project memory comes from issue trackers, docs, chat, and app events — not from one fragile weekly summary.",
      items: [
        {
          meta: "Tracker",
          label: "GitHub and Linear",
          detail:
            "Pull blockers, milestones, and implementation status from delivery systems.",
        },
        {
          meta: "Chat",
          label: "Slack updates",
          detail:
            "Capture informal status changes and dependency mentions from the team thread.",
        },
        {
          meta: "Docs",
          label: "Launch and planning docs",
          detail:
            "Attach review notes and project artifacts to the same graph as the rollout itself.",
        },
        {
          meta: "Events",
          label: "Internal app signals",
          detail:
            "Ingest app-specific rollout or milestone updates through MCP and SDK integrations.",
        },
      ],
    },
    auth: {
      title: "How project systems are connected",
      description:
        "Delivery tools can stay integrated without turning the worker into a secret holder.",
      items: [
        {
          meta: "OAuth",
          label: "Engineering tools",
          detail:
            "Authorize GitHub, Linear, and docs once, then route requests through the proxy layer.",
        },
        {
          meta: "API key",
          label: "Internal services",
          detail:
            "Use scoped credentials for app-specific rollout metadata and delivery dashboards.",
        },
        {
          meta: "Webhook",
          label: "Historical or event imports",
          detail:
            "Feed older project state and new events into memory without manual copy-paste.",
        },
        {
          meta: "Isolation",
          label: "Agent boundary",
          detail:
            "The planner sees shared context, while auth stays outside the runtime.",
        },
      ],
    },
    reuse: {
      title: "Delivery agents",
      description:
        "The same project memory powers delivery agents wherever teams work.",
      items: [
        {
          label: "Standup agent",
          detail:
            "Answers what is blocked, who owns it, and which milestone is at risk.",
          platform: { id: "slack", label: "Slack" },
        },
        {
          label: "Planning assistant",
          detail:
            "Brings prior docs, owners, and dependencies into the next planning session.",
          platform: { id: "claude", label: "Claude" },
        },
        {
          label: "Launch readiness agent",
          detail:
            "Uses one shared memory graph for rollout status, docs, and unresolved risks.",
          platform: { id: "chatgpt", label: "ChatGPT" },
        },
        {
          label: "Stakeholder update workflow",
          detail:
            "Generates Monday risk updates from the same project record leadership already trusts.",
          platform: { id: "openclaw", label: "OpenClaw" },
        },
      ],
    },
  },
  leadership: {
    connect: {
      title: "Decision source inputs",
      description:
        "Executive memory should stay tied to source documents and follow-up evidence, not a lossy summary.",
      items: [
        {
          meta: "Upload",
          label: "Board memo and packet files",
          detail:
            "Treat the original document as evidence while extracting decisions and assignments from it.",
        },
        {
          meta: "Drive",
          label: "Cloud document systems",
          detail:
            "Sync docs and presentations from connected workspaces without copying them by hand.",
        },
        {
          meta: "Browser",
          label: "Authenticated knowledge systems",
          detail:
            "Use browser-backed access for tools that do not expose a clean API surface.",
        },
        {
          meta: "SDK",
          label: "Custom internal feeds",
          detail:
            "Attach finance, legal, or operating context through MCP and Connector SDK integrations.",
        },
      ],
    },
    auth: {
      title: "How document access is handled",
      description:
        "Leaders and operators can connect the right document systems while keeping auth outside the worker.",
      items: [
        {
          meta: "OAuth",
          label: "Drive and docs",
          detail:
            "Authorize cloud document providers once for recurring imports and lookups.",
        },
        {
          meta: "Browser auth",
          label: "Knowledge tools",
          detail:
            "Use browser-based sessions when source systems require interactive login.",
        },
        {
          meta: "API key",
          label: "Attached data services",
          detail:
            "Combine document context with internal APIs or external knowledge tools behind the proxy.",
        },
        {
          meta: "Manual",
          label: "Direct uploads",
          detail:
            "Allow operators to capture important memos immediately, even before connectors are set up.",
        },
      ],
    },
    reuse: {
      title: "Leadership agents",
      description:
        "The same decision memory powers leadership agents wherever teams work.",
      items: [
        {
          label: "Decision recall agent",
          detail:
            "Answers what was approved, what is blocked, and which region or budget line it affects.",
          platform: { id: "claude", label: "Claude" },
        },
        {
          label: "Assignment tracker",
          detail:
            "Keeps action items visible across future workflows and follow-ups.",
          platform: { id: "slack", label: "Slack" },
        },
        {
          label: "Document QA assistant",
          detail:
            "Answers from the extracted graph without re-reading every memo in full.",
          platform: { id: "chatgpt", label: "ChatGPT" },
        },
        {
          label: "Board prep workflow",
          detail:
            "Carries pending decisions and blockers into the next briefing cycle.",
          platform: { id: "openclaw", label: "OpenClaw" },
        },
      ],
    },
  },
};

const fallbackSkills: Partial<
  Record<LandingUseCaseId, LandingUseCaseSkillsDefinition>
> = {
  sales: {
    description:
      "Track renewals, summarize deal risk, and monitor rollout signals",
    agentId: "sales-ops",
    skillId: "sales-ops",
    skills: ["salesforce-mcp", "gong-mcp", "hubspot-sync"],
    nixPackages: ["qsv", "jq"],
    allowedDomains: ["api.salesforce.com", "api.gong.io", "api.hubapi.com"],
    mcpServer: "salesforce-mcp",
    providerId: "anthropic",
    model: "claude/sonnet-4-5",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    skillInstructions: [
      "Lead with renewal risk, rollout state, and the next commercial action.",
      "Keep every commercial summary tied to an account, owner, and source signal.",
    ],
  },
  delivery: {
    description: "Track milestones, blockers, owners, and rollout notes",
    agentId: "delivery-ops",
    skillId: "delivery-ops",
    skills: ["linear-mcp", "github-mcp", "docs-sync"],
    nixPackages: ["gh", "jq"],
    allowedDomains: ["api.linear.app", "api.github.com", ".docs.example.com"],
    mcpServer: "linear-mcp",
    providerId: "anthropic",
    model: "claude/sonnet-4-5",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    skillInstructions: [
      "Start with blockers, dependencies, and milestone movement.",
      "End every update with an owner and the next follow-up.",
    ],
  },
  leadership: {
    description:
      "Extract decisions, blockers, and assignments from executive materials",
    agentId: "leadership-ops",
    skillId: "leadership-ops",
    skills: ["google-drive-mcp", "meeting-notes", "board-packet-sync"],
    nixPackages: ["poppler", "pandoc"],
    allowedDomains: ["www.googleapis.com", ".drive.google.com", ".notion.so"],
    mcpServer: "google-drive-mcp",
    providerId: "anthropic",
    model: "claude/sonnet-4-5",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    skillInstructions: [
      "Separate approved, pending, and blocked outcomes in every summary.",
      "Keep assigned follow-ups attached to owners and deadlines.",
    ],
  },
};

const fallbackMemory: Partial<
  Record<LandingUseCaseId, LandingUseCaseMemoryDefinition>
> = {
  legal: {
    id: "contract",
    description:
      "Store contracts, clauses, counterparties, and risk so every review starts with context.",
    sourceLabel: "Example prompt",
    sourceText:
      "Remember that Redwood Capital's NDA keeps residuals broad, asks for Delaware venue, and still lacks a cap on the confidentiality term.",
    entitySelections: {
      Contract: "legal-contract",
      Clause: "legal-clause",
      Risk: "legal-risk",
      Counterparty: "legal-counterparty",
    },
    howItWorks: [
      {
        id: "model",
        label: "1",
        title: "Model the world",
        detail:
          "Represent contracts, clauses, risks, and counterparties as typed objects so review history and negotiations stay queryable.",
        chips: ["Contract", "Clause", "Risk", "Counterparty"],
      },
      {
        id: "connect",
        label: "2",
        title: "Connect sources",
        detail:
          "Bring in uploaded agreements, shared drives, research tools, and custom parsing pipelines through connector-backed ingestion and MCP proxying.",
        chips: ["File upload", "Drive", "Research", "Custom SDK"],
        links: [docsLinks.mcpProxy, docsLinks.connectorSdk],
      },
      {
        id: "auth",
        label: "3",
        title: "Let users connect their data",
        detail:
          "Use OAuth for document systems, API keys for legal research, and manual uploads for negotiated drafts without exposing credentials to the agent runtime.",
        chips: ["OAuth", "API keys", "File upload", "Manual review"],
        links: [docsLinks.memoryDocs, docsLinks.mcpAuthFlow],
      },
      {
        id: "reuse",
        label: "4",
        title: "Reuse context across agents",
        detail:
          "The same contract memory powers legal agents wherever teams work.",
        chips: ["Slack", "OpenClaw", "ChatGPT", "Claude"],
      },
      {
        id: "fresh",
        label: "5",
        title: "Keep it fresh",
        detail:
          "Watchers track new drafts, changes in negotiated language, and unresolved risk so redlines stay grounded in the latest document state.",
      },
    ],
    watcher: {
      name: "Contract review tracker",
      schedule: "Every 12 hours",
      prompt:
        "Check Redwood Capital contract changes, unresolved risks, and new draft versions.",
      extractionSchema:
        "{ changed_clauses[], unresolved_risks[], new_counterparty_terms[] }",
      schemaEvolution:
        "Started with clause + risk capture. After repeated NDA reviews, added negotiated_position and fallback_language fields.",
    },
    highlights: [
      { label: "Contract", value: "Redwood NDA" },
      { label: "Counterparty", value: "Redwood Capital" },
      { label: "Risk", value: "No cap on confidentiality term" },
      { label: "Negotiation point", value: "Broad residuals + Delaware venue" },
    ],
    nodeHighlights: {
      "legal-root": [
        { label: "Contract", value: "Redwood NDA" },
        { label: "Counterparty", value: "Redwood Capital" },
        { label: "Open risk", value: "No cap on confidentiality term" },
        { label: "Clause note", value: "Residuals remain broad" },
      ],
      "legal-contract": [
        { label: "Type", value: "Contract" },
        { label: "Name", value: "Redwood NDA" },
        { label: "Counterparty", value: "Redwood Capital" },
        { label: "Venue", value: "Delaware" },
      ],
      "legal-clause": [
        { label: "Type", value: "Clause" },
        { label: "Clause", value: "Residuals" },
        { label: "State", value: "Broad language still present" },
        {
          label: "Why it matters",
          value: "Could weaken confidentiality protections",
        },
      ],
      "legal-risk": [
        { label: "Type", value: "Risk" },
        { label: "Risk", value: "Unlimited confidentiality term" },
        { label: "Severity", value: "Needs counsel review" },
        { label: "Source", value: "Current NDA draft" },
      ],
      "legal-counterparty": [
        { label: "Type", value: "Counterparty" },
        { label: "Name", value: "Redwood Capital" },
        { label: "Context", value: "Negotiating NDA" },
        { label: "Known request", value: "Delaware venue" },
      ],
    },
    recordTree: {
      id: "legal-root",
      label: "Record: Redwood NDA review",
      kind: "Model record",
      summary:
        "One contract review note becomes a linked contract record with clause state, counterparty context, and durable legal risk.",
      chips: ["contract memory", "auditable", "reviewable"],
      children: [
        {
          id: "legal-contract",
          label: "Entity: Redwood NDA",
          kind: "Contract",
          summary:
            "Primary contract record used for future reviews, approvals, and negotiation history.",
          chips: ["primary", "agreement"],
        },
        {
          id: "legal-clause",
          label: "Clause: residuals",
          kind: "Clause",
          summary:
            "Clause-level review stays attached to the contract instead of disappearing inside a one-off summary.",
          chips: ["clause", "review"],
        },
        {
          id: "legal-risk",
          label: "Risk: unlimited confidentiality term",
          kind: "Risk",
          summary:
            "Open risk is queryable later when the team asks what still needs counsel approval.",
          chips: ["risk", "open issue"],
        },
        {
          id: "legal-counterparty",
          label: "Counterparty: Redwood Capital",
          kind: "Counterparty",
          summary:
            "Counterparty context helps future drafts and negotiation summaries stay grounded in the same deal thread.",
          chips: ["counterparty", "context"],
        },
      ],
    },
    relations: [
      {
        source: "Redwood NDA",
        sourceType: "Contract",
        label: "contains_clause",
        target: "Residuals clause",
        targetType: "Clause",
        note: "The clause stays attached to the agreement being reviewed.",
      },
      {
        source: "Residuals clause",
        sourceType: "Clause",
        label: "creates_risk",
        target: "Unlimited confidentiality term",
        targetType: "Risk",
        note: "Risk is linked to the language that caused it.",
      },
      {
        source: "Redwood NDA",
        sourceType: "Contract",
        label: "belongs_to_counterparty",
        target: "Redwood Capital",
        targetType: "Counterparty",
        note: "Counterparty context remains queryable across future drafts.",
      },
    ],
  },
  devops: {
    id: "incident",
    description:
      "Track incidents, services, deploys, and remediation work in one shared operational memory graph.",
    sourceLabel: "Example prompt",
    sourceText:
      "Remember that checkout-api incident started right after deploy 2026.04.13.2, impacts EU checkout traffic, and rollback depends on PR #482 landing first.",
    entitySelections: {
      Incident: "devops-incident",
      Service: "devops-service",
      Deploy: "devops-deploy",
      "Pull request": "devops-pr",
    },
    howItWorks: [
      {
        id: "model",
        label: "1",
        title: "Model the world",
        detail:
          "Represent incidents, services, deploys, and pull requests as first-class objects so on-call context survives after the thread scrolls away.",
        chips: ["Incident", "Service", "Deploy", "Pull request"],
      },
      {
        id: "connect",
        label: "2",
        title: "Connect sources",
        detail:
          "Turn live operational signals into structured incident memory.",
        chips: ["PagerDuty", "GitHub", "Deploy logs", "Custom SDK"],
        links: [docsLinks.mcpProxy, docsLinks.connectorSdk],
      },
      {
        id: "auth",
        label: "3",
        title: "Let users connect their data",
        detail:
          "Let teams bring the tools they already use, while keeping credentials outside the worker.",
        chips: ["OAuth", "Service account", "API keys", "Historical import"],
        links: [docsLinks.memoryDocs, docsLinks.mcpAuthFlow],
      },
      {
        id: "reuse",
        label: "4",
        title: "Reuse context across agents",
        detail:
          "The same incident memory powers operational agents wherever teams work.",
        chips: ["Slack", "OpenClaw", "ChatGPT", "Claude"],
      },
      {
        id: "fresh",
        label: "5",
        title: "Keep it fresh",
        detail:
          "Watchers pull in new alerts, deploy state, and merged fixes so the runtime sees the latest impact and rollback options.",
      },
    ],
    watcher: {
      name: "Incident freshness monitor",
      schedule: "Every 5 minutes",
      prompt:
        "Track checkout-api incident state, deploy rollbacks, and the status of PR #482.",
      extractionSchema:
        "{ incident_state, impacted_regions[], rollback_ready, blocking_prs[] }",
      schemaEvolution:
        "Started with incident_state + deploy_id. After repeated incidents, added rollback_ready and impacted_regions fields.",
    },
    highlights: [
      { label: "Incident", value: "checkout-api degradation" },
      { label: "Service", value: "EU checkout" },
      { label: "Trigger", value: "Deploy 2026.04.13.2" },
      { label: "Blocker", value: "PR #482 must merge before rollback" },
    ],
    nodeHighlights: {
      "devops-root": [
        { label: "Incident", value: "checkout-api degradation" },
        { label: "Service", value: "EU checkout" },
        { label: "Trigger", value: "Deploy 2026.04.13.2" },
        { label: "Blocked by", value: "PR #482" },
      ],
      "devops-incident": [
        { label: "Type", value: "Incident" },
        { label: "Status", value: "Active" },
        { label: "Impact", value: "EU checkout traffic degraded" },
        { label: "Started after", value: "Deploy 2026.04.13.2" },
      ],
      "devops-service": [
        { label: "Type", value: "Service" },
        { label: "Name", value: "checkout-api" },
        { label: "Region", value: "EU" },
        { label: "Customer impact", value: "Checkout latency and failures" },
      ],
      "devops-deploy": [
        { label: "Type", value: "Deploy" },
        { label: "ID", value: "2026.04.13.2" },
        { label: "State", value: "Suspected trigger" },
        { label: "Action", value: "Rollback under review" },
      ],
      "devops-pr": [
        { label: "Type", value: "Pull request" },
        { label: "PR", value: "#482" },
        { label: "Role", value: "Rollback prerequisite" },
        { label: "Status", value: "Waiting to merge" },
      ],
    },
    recordTree: {
      id: "devops-root",
      label: "Record: checkout-api incident",
      kind: "Model record",
      summary:
        "Incident state links the active outage, affected service, triggering deploy, and required remediation work in one graph.",
      chips: ["incident memory", "live context", "operational"],
      children: [
        {
          id: "devops-incident",
          label: "Entity: checkout-api degradation",
          kind: "Incident",
          summary:
            "The active incident stays queryable across handoffs and status updates.",
          chips: ["incident", "active"],
        },
        {
          id: "devops-service",
          label: "Service: EU checkout",
          kind: "Service",
          summary:
            "Service impact is preserved separately from the incident narrative.",
          chips: ["service", "impact"],
        },
        {
          id: "devops-deploy",
          label: "Deploy: 2026.04.13.2",
          kind: "Deploy",
          summary:
            "The triggering rollout remains attached to the incident for future analysis.",
          chips: ["deploy", "trigger"],
        },
        {
          id: "devops-pr",
          label: "PR: #482",
          kind: "Pull request",
          summary:
            "Remediation work stays linked to the operational event it is blocking.",
          chips: ["code change", "blocker"],
        },
      ],
    },
    relations: [
      {
        source: "checkout-api degradation",
        sourceType: "Incident",
        label: "affects_service",
        target: "EU checkout",
        targetType: "Service",
        note: "Impact stays attached to the service that is degraded.",
      },
      {
        source: "checkout-api degradation",
        sourceType: "Incident",
        label: "triggered_by_deploy",
        target: "Deploy 2026.04.13.2",
        targetType: "Deploy",
        note: "The rollout remains linked to the operational event it caused.",
      },
      {
        source: "checkout-api degradation",
        sourceType: "Incident",
        label: "blocked_by_pr",
        target: "PR #482",
        targetType: "Pull request",
        note: "The required fix remains queryable for future handoffs.",
      },
    ],
  },
  finance: {
    id: "variance",
    description:
      "Track accounts, transactions, variance, and reporting notes so close workflows can reuse the same structured state.",
    sourceLabel: "Example prompt",
    sourceText:
      "Remember that March close shows a $42k Stripe payout variance on Account 4100, refunds are the likely cause, and the reconciliation note must land in the month-end deck.",
    entitySelections: {
      Account: "finance-account",
      Transaction: "finance-transaction",
      Variance: "finance-variance",
      Report: "finance-report",
    },
    howItWorks: [
      {
        id: "model",
        label: "1",
        title: "Model the world",
        detail:
          "Represent accounts, transactions, variances, and reports as linked objects so close state survives across spreadsheets, dashboards, and chat threads.",
        chips: ["Account", "Transaction", "Variance", "Report"],
      },
      {
        id: "connect",
        label: "2",
        title: "Connect sources",
        detail:
          "Pull data from accounting systems, payment processors, CSV imports, and close checklists through MCP tools and scheduled syncs.",
        chips: ["ERP", "Stripe", "CSV", "Close checklist"],
        links: [docsLinks.mcpProxy, docsLinks.connectorSdk],
      },
      {
        id: "auth",
        label: "3",
        title: "Let users connect their data",
        detail:
          "Use API keys and service accounts for finance systems while keeping access scoped outside the worker runtime.",
        chips: ["API keys", "Service account", "Manual import"],
        links: [docsLinks.memoryDocs, docsLinks.mcpAuthFlow],
      },
      {
        id: "reuse",
        label: "4",
        title: "Reuse context across agents",
        detail:
          "The same variance memory powers finance agents wherever teams work.",
        chips: ["Slack", "OpenClaw", "ChatGPT", "Claude"],
      },
      {
        id: "fresh",
        label: "5",
        title: "Keep it fresh",
        detail:
          "Watchers keep balances, exception lists, and report status current as new payouts and adjustments arrive.",
      },
    ],
    watcher: {
      name: "Month-end variance tracker",
      schedule: "Every 6 hours",
      prompt:
        "Track Account 4100 variance, refund activity, and month-end deck readiness.",
      extractionSchema:
        "{ variance_amount, likely_causes[], unresolved_items[], report_status }",
      schemaEvolution:
        "Started with variance_amount + report_status. After repeated closes, added likely_causes and unresolved_items.",
    },
    highlights: [
      { label: "Account", value: "4100" },
      { label: "Variance", value: "$42k" },
      { label: "Likely cause", value: "Delayed refunds" },
      { label: "Reporting task", value: "Month-end deck reconciliation note" },
    ],
    nodeHighlights: {
      "finance-root": [
        { label: "Account", value: "4100" },
        { label: "Variance", value: "$42k" },
        { label: "Likely cause", value: "Refund timing" },
        { label: "Report", value: "Month-end deck" },
      ],
      "finance-account": [
        { label: "Type", value: "Account" },
        { label: "Account", value: "4100" },
        { label: "State", value: "Needs reconciliation" },
        { label: "Cycle", value: "March close" },
      ],
      "finance-transaction": [
        { label: "Type", value: "Transaction set" },
        { label: "Source", value: "Stripe payouts" },
        { label: "Signal", value: "Refund timing mismatch" },
        { label: "Period", value: "March" },
      ],
      "finance-variance": [
        { label: "Type", value: "Variance" },
        { label: "Amount", value: "$42k" },
        { label: "Status", value: "Needs explanation" },
        { label: "Cause", value: "Refund timing" },
      ],
      "finance-report": [
        { label: "Type", value: "Report" },
        { label: "Name", value: "Month-end deck" },
        { label: "Needs", value: "Reconciliation note" },
        { label: "Owner", value: "Finance ops" },
      ],
    },
    recordTree: {
      id: "finance-root",
      label: "Record: March close variance",
      kind: "Model record",
      summary:
        "A reconciliation note becomes a reusable finance record with the affected account, variance, transaction context, and reporting destination.",
      chips: ["finance memory", "close workflow", "structured"],
      children: [
        {
          id: "finance-account",
          label: "Account: 4100",
          kind: "Account",
          summary:
            "The account record stores the close state and associated exceptions.",
          chips: ["account", "close"],
        },
        {
          id: "finance-transaction",
          label: "Transactions: Stripe payouts",
          kind: "Transaction",
          summary:
            "Transaction context stays attached to the variance it explains.",
          chips: ["payments", "source"],
        },
        {
          id: "finance-variance",
          label: "Variance: $42k",
          kind: "Variance",
          summary:
            "The anomaly remains queryable later for reporting and follow-up work.",
          chips: ["variance", "exception"],
        },
        {
          id: "finance-report",
          label: "Report: month-end deck",
          kind: "Report",
          summary:
            "Reporting outputs stay connected to the supporting data behind them.",
          chips: ["reporting", "evidence"],
        },
      ],
    },
    relations: [
      {
        source: "Stripe payouts",
        sourceType: "Transaction",
        label: "reconciles_to",
        target: "Account 4100",
        targetType: "Account",
        note: "Transaction evidence stays linked to the account it rolls into.",
      },
      {
        source: "Refund timing mismatch",
        sourceType: "Issue",
        label: "creates_variance",
        target: "$42k variance",
        targetType: "Variance",
        note: "The likely cause stays attached to the anomaly it produced.",
      },
      {
        source: "$42k variance",
        sourceType: "Variance",
        label: "summarized_in",
        target: "Month-end deck",
        targetType: "Report",
        note: "Reporting context remains attached to the finance event it explains.",
      },
    ],
  },
};

const runtimeContent: Record<LandingUseCaseId, RuntimeJourney> = {
  legal: {
    requestLabel: "Incoming request",
    request:
      "Review Redwood's NDA, flag risk, and tell me what still needs counsel approval.",
    summary:
      "Run a legal review agent in chat, bundle the tools it needs, and keep contract context in shared memory for the next draft.",
    steps: [
      {
        title: "Runtime handles the live task",
        detail:
          "Lobu receives the request in chat, opens the right skill bundle, and runs the review inside a sandboxed worker.",
      },
      {
        title: "Skills bring the right tools",
        detail:
          "The legal skill bundles research access, contract workflows, network policy, and instructions into one installable unit.",
      },
      {
        title: "Memory keeps legal context durable",
        detail:
          "Owletto stores the contract, clause, risk, and counterparty graph so future reviews begin with the same evidence.",
      },
    ],
    outcomeLabel: "What the team gets",
    outcome: [
      "Clause-level risk summary with citations",
      "Recommended edits and unresolved approval items",
      "Durable contract context for future negotiation turns",
    ],
  },
  devops: {
    requestLabel: "Incoming request",
    request: "What's blocking today's deploy, and can we roll back safely?",
    summary:
      "Combine live operational checks with persistent incident memory so on-call engineers get a useful answer fast.",
    steps: [
      {
        title: "Runtime gathers the live state",
        detail:
          "Lobu checks incidents, PRs, and deploy tools in a sandbox and asks for approval before any risky action.",
        chips: ["PagerDuty", "GitHub", "k8s", "approvals"],
      },
      {
        title: "Skills package the ops workflow",
        detail:
          "The DevOps skill bundles MCP servers, allowed domains, and instructions for triage, rollback, and handoff.",
        chips: ["MCP", "network allowlist", "tool policy"],
      },
      {
        title: "Memory tracks the incident graph",
        detail:
          "Owletto links the current outage to affected services, triggering deploys, and remediation work so context survives handoffs.",
        chips: ["incident memory", "service graph"],
      },
    ],
    outcomeLabel: "What the team gets",
    outcome: [
      "A current deploy-risk answer with blockers called out",
      "Incident and rollback context shared across the team",
      "Fewer repeated explanations during on-call handoffs",
    ],
  },
  support: {
    requestLabel: "Incoming request",
    request:
      "Draft a response for Alex Kim, note the owner, and remind me about the Thursday follow-up.",
    summary:
      "Use one support workflow to pull account context, draft the next response, and keep relationship memory updated for the next conversation.",
    steps: [
      {
        title: "Runtime responds in the channel the team already uses",
        detail:
          "Lobu receives the support request in chat, runs the agent safely, and can trigger approvals or routing when needed.",
        chips: ["Slack", "WhatsApp", "REST API"],
      },
      {
        title: "Skills connect the operational systems",
        detail:
          "The support bundle can talk to ticketing, knowledge, and escalation tools without leaking credentials to workers.",
        chips: ["Zendesk", "knowledge base", "auth proxy"],
      },
      {
        title: "Memory remembers the relationship",
        detail:
          "Owletto stores the contact, organization, communication preferences, and promised follow-up so the next reply starts from context.",
        chips: ["contact memory", "follow-ups", "preferences"],
      },
    ],
    outcomeLabel: "What the team gets",
    outcome: [
      "Faster first replies with consistent context",
      "Less re-triage across shifts and escalations",
      "Shared memory for owners, preferences, and next steps",
    ],
  },
  finance: {
    requestLabel: "Incoming request",
    request:
      "Explain the Stripe variance on Account 4100 and prep the month-end note.",
    summary:
      "Let a finance operator agent pull live sources, explain the variance, and store structured reconciliation context for the close.",
    steps: [
      {
        title: "Runtime reads live finance systems safely",
        detail:
          "Lobu runs the reconciliation flow in a sandbox and uses configured tools to inspect payment and accounting sources.",
        chips: ["sandbox", "close workflow", "tool access"],
      },
      {
        title: "Skills bundle accounting integrations",
        detail:
          "The finance skill package carries the MCP servers, domains, and instructions needed for reconciliations and reporting.",
        chips: ["QuickBooks", "Stripe", "CSV tools"],
      },
      {
        title: "Memory keeps variance context durable",
        detail:
          "Owletto saves the account, variance, source transactions, and reporting destination so the next close starts with history.",
        chips: ["variance memory", "reporting context"],
      },
    ],
    outcomeLabel: "What the team gets",
    outcome: [
      "A structured explanation for the variance",
      "Operator-ready notes for the month-end deck",
      "Shared finance context across reconciliation runs",
    ],
  },
  sales: {
    requestLabel: "Incoming request",
    request:
      "What changed in Northstar before the October renewal, and what should we do next?",
    summary:
      "Combine revenue signals, rollout context, and shared account memory so teams can act before renewal risk grows.",
    steps: [
      {
        title: "Runtime works the live account question",
        detail:
          "Lobu answers from chat, runs the revenue workflow in a sandbox, and can request approval before any external action.",
        chips: ["chat", "sandbox", "approval flow"],
      },
      {
        title: "Skills package the GTM systems",
        detail:
          "The sales bundle can pull CRM, call, and account-health signals through one installable unit.",
        chips: ["Salesforce", "Gong", "HubSpot"],
      },
      {
        title: "Memory tracks the account graph",
        detail:
          "Owletto stores the account, region, pilot, and renewal-risk signals so commercial context compounds over time.",
        chips: ["account memory", "renewal risk"],
      },
    ],
    outcomeLabel: "What the team gets",
    outcome: [
      "Renewal summaries grounded in account evidence",
      "Expansion and risk signals in one place",
      "Shared context across sales, CS, and leadership",
    ],
  },
  delivery: {
    requestLabel: "Incoming request",
    request:
      "Give me the Monday Phoenix rollout update with blockers, owners, and the next escalation.",
    summary:
      "Use one delivery workflow to inspect live rollout tools, summarize blockers, and keep the project graph fresh.",
    steps: [
      {
        title: "Runtime drives the live status update",
        detail:
          "Lobu runs the delivery assistant in chat, pulls the current state, and keeps execution inside your infrastructure.",
        chips: ["chat", "self-hosted", "sandbox"],
      },
      {
        title: "Skills bundle rollout systems",
        detail:
          "The delivery bundle connects issue tracking, source control, and docs so one install brings the full workflow.",
        chips: ["Linear", "GitHub", "docs"],
      },
      {
        title: "Memory preserves the project graph",
        detail:
          "Owletto stores milestones, blockers, stakeholders, and artifacts so every update starts from current project context.",
        chips: ["project memory", "blockers", "owners"],
      },
    ],
    outcomeLabel: "What the team gets",
    outcome: [
      "Consistent rollout updates with owners and blockers",
      "Project context that survives across standups and escalations",
      "A reusable project graph for planning and reporting",
    ],
  },
  leadership: {
    requestLabel: "Incoming request",
    request:
      "Summarize this board memo: what was approved, what is blocked, and who owns the next action?",
    summary:
      "Turn executive materials into a workflow where agents can answer live questions and keep decision context durable.",
    steps: [
      {
        title: "Runtime handles the active executive request",
        detail:
          "Lobu processes the memo or chat message in a sandbox, applies the right instructions, and returns an operator-ready summary.",
        chips: ["docs", "chat", "sandbox"],
      },
      {
        title: "Skills package the source systems",
        detail:
          "The leadership bundle can reach board materials, shared docs, and meeting-note tools through one installable workflow.",
        chips: ["Google Drive", "meeting notes", "board packets"],
      },
      {
        title: "Memory keeps decision history reusable",
        detail:
          "Owletto stores decisions, blockers, regions, and assignments so future executive reviews start with the same context.",
        chips: ["decision memory", "assignments", "blockers"],
      },
    ],
    outcomeLabel: "What the team gets",
    outcome: [
      "Action-oriented board summaries grounded in source material",
      "Durable decision history across review cycles",
      "Clear owners and blockers for follow-up work",
    ],
  },
};

function getSkillsDefinition(
  useCaseId: LandingUseCaseId,
  useCase: LandingUseCaseDefinition
): LandingUseCaseSkillsDefinition {
  return useCase.skills ?? fallbackSkills[useCaseId]!;
}

function getMemoryDefinition(
  useCaseId: LandingUseCaseId,
  useCase: LandingUseCaseDefinition
): LandingUseCaseMemoryDefinition {
  const memory = useCase.memory ?? fallbackMemory[useCaseId]!;

  return {
    ...memory,
    howItWorks: memory.howItWorks.map((step) => ({
      ...step,
      links:
        step.id === "model"
          ? [...(step.links ?? []), docsLinks.owlettoDocs]
          : step.links,
      panel:
        step.panel ??
        (step.id === "connect" || step.id === "auth" || step.id === "reuse"
          ? memoryStepPanels[useCaseId][step.id]
          : undefined),
    })),
  };
}

function toSkillPreview(
  useCaseId: LandingUseCaseId,
  useCase: LandingUseCaseDefinition
): ShowcaseSkillWorkspacePreview {
  const skills = getSkillsDefinition(useCaseId, useCase);

  return {
    useCaseId,
    name: useCase.label,
    description: skills.description,
    agentId: skills.agentId,
    skillId: skills.skillId,
    skills: skills.skills,
    nixPackages: skills.nixPackages,
    allowedDomains: skills.allowedDomains,
    mcpServer: skills.mcpServer,
    providerId: skills.providerId,
    model: skills.model,
    apiKeyEnv: skills.apiKeyEnv,
    identity: useCase.agent.identity,
    soul: useCase.agent.soul,
    user: useCase.agent.user,
    skillInstructions: skills.skillInstructions,
  };
}

function toMemoryExample(
  useCaseId: LandingUseCaseId,
  useCase: LandingUseCaseDefinition
): ShowcaseMemoryExample {
  const memory = getMemoryDefinition(useCaseId, useCase);

  return {
    useCaseId,
    id: memory.id,
    tab: useCase.label,
    title: useCase.label,
    description: memory.description,
    sourceLabel: memory.sourceLabel,
    sourceText: memory.sourceText,
    entityTypes: useCase.model.entities,
    entitySelections: memory.entitySelections,
    howItWorks: memory.howItWorks,
    highlights: memory.highlights,
    nodeHighlights: memory.nodeHighlights,
    watcher: memory.watcher,
    recordTree: memory.recordTree,
    relations: memory.relations,
  };
}

function toCampaignMeta(
  useCaseId: LandingUseCaseId,
  useCase: LandingUseCaseDefinition,
  runtime: RuntimeJourney
): CampaignMeta {
  return {
    title: `Deploy secure ${useCase.label.toLowerCase()} agents in your infrastructure`,
    description: runtime.summary,
    seoTitle: `${useCase.label} AI agents on your infrastructure - Lobu`,
    seoDescription: runtime.summary,
    ctaHref: `/for/${useCaseId}`,
    ctaLabel: `Open ${useCase.label} page`,
  };
}

export const landingUseCaseShowcases: LandingUseCaseShowcase[] = (
  Object.entries(landingUseCases) as Array<
    [LandingUseCaseId, LandingUseCaseDefinition]
  >
).map(([useCaseId, useCase]) => {
  const runtime = runtimeContent[useCaseId];

  return {
    id: useCaseId,
    label: useCase.label,
    campaign: toCampaignMeta(useCaseId, useCase, runtime),
    runtime,
    skills: toSkillPreview(useCaseId, useCase),
    memory: toMemoryExample(useCaseId, useCase),
  };
});

export const DEFAULT_LANDING_USE_CASE_ID: LandingUseCaseId = "devops";

export const landingUseCaseOptions = landingUseCaseShowcases.map((useCase) => ({
  id: useCase.id,
  label: useCase.label,
}));

export function getLandingUseCaseShowcase(
  useCaseId?: string
): LandingUseCaseShowcase {
  return (
    landingUseCaseShowcases.find((useCase) => useCase.id === useCaseId) ??
    landingUseCaseShowcases.find(
      (useCase) => useCase.id === DEFAULT_LANDING_USE_CASE_ID
    ) ??
    landingUseCaseShowcases[0]
  );
}

export const showcaseSkillWorkspacePreviews = landingUseCaseShowcases.map(
  (useCase) => useCase.skills
);

export const showcaseMemoryExamples = landingUseCaseShowcases.map(
  (useCase) => useCase.memory
);

export function getSkillsPrompt(showcase: LandingUseCaseShowcase) {
  const workspace = showcase.skills;

  return `Set up a new Lobu agent for ${showcase.label}. Create lobu.toml with [agents.${workspace.agentId}] pointing at ./agents/${workspace.agentId}, add IDENTITY.md, SOUL.md, and USER.md under agents/${workspace.agentId}/, and add a shared skill in skills/${workspace.skillId}/SKILL.md with nix packages, a network allowlist, tool permissions, and MCP servers for ${workspace.skills.join(", ")}. Keep the workflow aligned with this request: ${showcase.runtime.request}`;
}

export function getMemoryPrompt(showcase: LandingUseCaseShowcase) {
  const memory = showcase.memory;

  return `Initialize Owletto memory for ${showcase.label}. Model these entities: ${memory.entityTypes.join(", ")}. Use this source text as the first example: "${memory.sourceText}". Keep the extracted memory durable, typed, and linked so the runtime can reuse it across future tasks.`;
}
