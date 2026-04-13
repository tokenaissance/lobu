export type MemoryField = {
  label: string;
  value: string;
};

export type RecordNode = {
  id: string;
  label: string;
  kind: string;
  summary: string;
  chips?: string[];
  children?: RecordNode[];
};

export type ExampleRelation = {
  source: string;
  label: string;
  target: string;
  note: string;
};

export type ExampleLink = {
  label: string;
  href: string;
};

export type HowItWorksPanelItem = {
  label: string;
  detail: string;
  meta?: string;
};

export type HowItWorksPanel = {
  title: string;
  description?: string;
  items?: HowItWorksPanelItem[];
};

export type HowItWorksStep = {
  id: "model" | "connect" | "auth" | "reuse" | "fresh";
  label: string;
  title: string;
  detail: string;
  chips?: string[];
  links?: ExampleLink[];
  panel?: HowItWorksPanel;
};

export type MemoryExample = {
  id: string;
  tab: string;
  title: string;
  description: string;
  sourceLabel: string;
  sourceText: string;
  entityTypes: string[];
  entitySelections?: Record<string, string>;
  howItWorks: HowItWorksStep[];
  highlights: MemoryField[];
  nodeHighlights?: Record<string, MemoryField[]>;
  watcher: {
    name: string;
    schedule: string;
    prompt: string;
    extractionSchema: string;
    schemaEvolution: string;
  };
  recordTree: RecordNode;
  relations: ExampleRelation[];
};

export type SkillWorkspacePreviewData = {
  name: string;
  description: string;
  agentId: string;
  skillId: string;
  skills: string[];
  allowedDomains: string[];
  mcpServer: string;
  providerId: string;
  model: string;
  apiKeyEnv: string;
  identity: string[];
  soul: string[];
  user: string[];
  skillInstructions: string[];
};

export type LandingUseCaseAgentDefinition = {
  identity: string[];
  soul: string[];
  user: string[];
};

export type LandingUseCaseModelDefinition = {
  entities: string[];
  relationships: Array<{
    label: string;
    note: string;
  }>;
};

export type LandingUseCaseSkillsDefinition = {
  description: string;
  agentId: string;
  skillId: string;
  skills: string[];
  allowedDomains: string[];
  mcpServer: string;
  providerId: string;
  model: string;
  apiKeyEnv: string;
  skillInstructions: string[];
};

export type LandingUseCaseMemoryDefinition = {
  id: string;
  description: string;
  sourceLabel: string;
  sourceText: string;
  entitySelections?: Record<string, string>;
  howItWorks: HowItWorksStep[];
  highlights: MemoryField[];
  nodeHighlights?: Record<string, MemoryField[]>;
  watcher: {
    name: string;
    schedule: string;
    prompt: string;
    extractionSchema: string;
    schemaEvolution: string;
  };
  recordTree: RecordNode;
  relations: ExampleRelation[];
};

export type LandingUseCaseDefinition = {
  id: string;
  label: string;
  agent: LandingUseCaseAgentDefinition;
  model: LandingUseCaseModelDefinition;
  skills?: LandingUseCaseSkillsDefinition;
  memory?: LandingUseCaseMemoryDefinition;
};

const technicalLinks = {
  mcpProxy: { label: "MCP proxy", href: "/guides/mcp-proxy/" },
  connectorSdk: {
    label: "Connector SDK",
    href: "/reference/owletto-cli/#connector-sdk-and-data-integration",
  },
  memoryDocs: { label: "Memory docs", href: "/getting-started/memory/" },
  mcpAuthFlow: { label: "MCP auth flow", href: "/guides/mcp-proxy/" },
};

export const landingUseCases = {
  legal: {
    id: "legal",
    label: "Legal",
    agent: {
      identity: [
        "You review contracts, summarize risk, and surface missing protections.",
        "Support legal teams with fast clause analysis and cited research notes.",
      ],
      soul: [
        "- Be precise and cautious.",
        "- Separate facts, risks, and recommendations.",
        "- Flag language that needs counsel approval.",
      ],
      user: [
        "- Team: Commercial legal",
        "- Priority: Turn NDAs around quickly",
        "- Preference: Redlines with short rationale",
      ],
    },
    model: {
      entities: ["Contract", "Clause", "Risk", "Counterparty"],
      relationships: [
        {
          label: "contains_clause",
          note: "Represent how a contract is composed so risky language stays attached to the right section.",
        },
        {
          label: "creates_risk",
          note: "Keep legal risk linked to the clause or term that caused it.",
        },
        {
          label: "belongs_to_counterparty",
          note: "Tie agreements and negotiation context back to the right external party.",
        },
      ],
    },
    skills: {
      description: "Draft contracts, search case law, review clauses",
      agentId: "legal-review",
      skillId: "legal-review",
      skills: ["westlaw-mcp", "contract-drafter", "case-search"],
      allowedDomains: ["api.westlaw.com", ".courtlistener.com"],
      mcpServer: "westlaw-mcp",
      providerId: "anthropic",
      model: "claude/sonnet-4-5",
      apiKeyEnv: "ANTHROPIC_API_KEY",
      skillInstructions: [
        "Summarize material risk before drafting edits.",
        "Cite authority or precedent when recommending changes.",
      ],
    },
  },
  devops: {
    id: "devops",
    label: "DevOps",
    agent: {
      identity: [
        "You help platform teams triage incidents, reviews, and deploy safety checks.",
        "Keep humans aligned on what is broken, blocked, or ready to ship.",
      ],
      soul: [
        "- Prefer signal over noise.",
        "- Highlight user impact and rollout risk.",
        "- Never auto-deploy without approval.",
      ],
      user: [
        "- Team: Platform engineering",
        "- Rotation: Primary on-call this week",
        "- Preference: Incident-first summaries",
      ],
    },
    model: {
      entities: ["Incident", "Service", "Deploy", "Pull request"],
      relationships: [
        {
          label: "affects_service",
          note: "Attach incidents to the systems they degrade so impact stays visible.",
        },
        {
          label: "triggered_by_deploy",
          note: "Link operational events back to the rollout or config change that caused them.",
        },
        {
          label: "blocked_by_pr",
          note: "Keep remediation work connected to the code changes that need action.",
        },
      ],
    },
    skills: {
      description: "Triage PRs, manage incidents, deploy services",
      agentId: "devops-control",
      skillId: "devops-control",
      skills: ["github-mcp", "pagerduty-mcp", "k8s-tools"],
      allowedDomains: ["api.github.com", "api.pagerduty.com", ".k8s.example.com"],
      mcpServer: "github-mcp",
      providerId: "anthropic",
      model: "claude/sonnet-4-5",
      apiKeyEnv: "ANTHROPIC_API_KEY",
      skillInstructions: [
        "Start with active incidents, then pending reviews and deploys.",
        "Call out rollback steps when release risk is high.",
      ],
    },
  },
  support: {
    id: "support",
    label: "Support",
    agent: {
      identity: [
        "You help support teams route tickets, draft replies, and escalate urgent issues.",
        "Balance empathy with fast, accurate resolution paths.",
      ],
      soul: [
        "- Be calm and helpful.",
        "- Confirm what the customer needs next.",
        "- Escalate outages or billing risk immediately.",
      ],
      user: [
        "- Team: Support operations",
        "- SLA: First reply under 15 minutes",
        "- Preference: Reusable macros where possible",
      ],
    },
    model: {
      entities: ["Person", "Organization", "Preference", "Task"],
      relationships: [
        {
          label: "works_at",
          note: "Link contacts to the companies and accounts they represent.",
        },
        {
          label: "prefers",
          note: "Persist communication preferences so future replies stay aligned.",
        },
        {
          label: "created_task",
          note: "Turn requests and promises into follow-ups with clear ownership.",
        },
      ],
    },
    skills: {
      description: "Route tickets, draft responses, escalate issues",
      agentId: "support-desk",
      skillId: "support-desk",
      skills: ["zendesk-mcp", "knowledge-base", "sentiment"],
      allowedDomains: ["subdomain.zendesk.com", ".intercomcdn.com"],
      mcpServer: "zendesk-mcp",
      providerId: "anthropic",
      model: "claude/sonnet-4-5",
      apiKeyEnv: "ANTHROPIC_API_KEY",
      skillInstructions: [
        "Propose the next best reply and the internal follow-up owner.",
        "Detect sentiment shifts before queues back up.",
      ],
    },
    memory: {
      id: "person",
      description:
        "Remember contacts, preferences, owners, and follow-ups across conversations.",
      sourceLabel: "Example prompt",
      sourceText:
        "Remember that Alex Kim from Acme Health owns vendor onboarding, prefers weekly email summaries, and asked us to send the draft by Thursday.",
      entitySelections: {
        Person: "person-entity",
        Organization: "person-org",
        Preference: "person-attribute-preference",
        Task: "person-task",
      },
      howItWorks: [
        {
          id: "model",
          label: "1",
          title: "Model the world",
          detail:
            "Define the people, organizations, preferences, and follow-ups your agents should recognize across conversations and synced contact data.",
          chips: ["Person", "Organization", "Preference", "Task"],
        },
        {
          id: "connect",
          label: "2",
          title: "Connect sources",
          detail:
            "Proxy MCP servers and ingest contact context from messaging apps, CRM syncs, email, and custom Connector SDK integrations through one runtime.",
          chips: ["Slack", "CRM sync", "Email", "Custom SDK", "MCP proxy"],
          links: [technicalLinks.mcpProxy, technicalLinks.connectorSdk],
        },
        {
          id: "auth",
          label: "3",
          title: "Let users connect their data",
          detail:
            "Support OAuth for inbox and calendar context, API keys for internal tools, and imports for historical contacts without exposing credentials to agents.",
          chips: ["OAuth", "API keys", "CSV import", "Manual import"],
          links: [technicalLinks.memoryDocs, technicalLinks.mcpAuthFlow],
        },
        {
          id: "reuse",
          label: "4",
          title: "Reuse context everywhere",
          detail:
            "The same contact graph is available in messaging apps and MCP clients like OpenClaw, ChatGPT, Claude, and any tool that can work against your MCP surface.",
          chips: [
            "Messaging apps",
            "OpenClaw",
            "ChatGPT",
            "Claude",
            "Any MCP client",
          ],
        },
        {
          id: "fresh",
          label: "5",
          title: "Keep it fresh",
          detail:
            "Watchers monitor new activity and update ownership, preferences, and follow-ups as the relationship changes.",
        },
      ],
      watcher: {
        name: "Contact freshness",
        schedule: "Every 24 hours",
        prompt:
          "Monitor Alex Kim's organization for role changes, new preferences, and overdue follow-ups.",
        extractionSchema:
          "{ status, role_changed, new_preferences[], overdue_tasks[] }",
        schemaEvolution:
          "Started with name + role. After 3 runs, added preference_history and follow_up_urgency as new patterns emerged.",
      },
      highlights: [
        { label: "Primary person", value: "Alex Kim" },
        { label: "Role", value: "Vendor onboarding owner" },
        { label: "Preference", value: "Weekly email summaries" },
        { label: "Follow-up", value: "Send draft by Thursday" },
      ],
      nodeHighlights: {
        "person-root": [
          { label: "Primary person", value: "Alex Kim" },
          { label: "Organization", value: "Acme Health" },
          { label: "Preference", value: "Weekly email summaries" },
          { label: "Follow-up", value: "Send draft by Thursday" },
        ],
        "person-entity": [
          { label: "Type", value: "Person" },
          { label: "Name", value: "Alex Kim" },
          { label: "Role", value: "Vendor onboarding owner" },
          { label: "Works at", value: "Acme Health" },
        ],
        "person-attribute-role": [
          { label: "Field", value: "role" },
          { label: "Type", value: "string" },
          { label: "Value", value: "Vendor onboarding owner" },
          { label: "Source phrase", value: "owns vendor onboarding" },
        ],
        "person-attribute-preference": [
          { label: "Field", value: "communication_preference" },
          { label: "Type", value: "string" },
          { label: "Value", value: "Weekly email summaries" },
          { label: "Applies to", value: "Future follow-ups and reports" },
        ],
        "person-org": [
          { label: "Relationship", value: "works_at" },
          { label: "Source", value: "Alex Kim" },
          { label: "Target", value: "Acme Health" },
          {
            label: "Why it matters",
            value: "Connects contact memory to org context",
          },
        ],
        "person-task": [
          { label: "Type", value: "Task" },
          { label: "Action", value: "Send draft" },
          { label: "Due", value: "Thursday" },
          { label: "Source", value: "Alex Kim follow-up request" },
        ],
      },
      recordTree: {
        id: "person-root",
        label: "Record: Alex Kim memory update",
        kind: "Model record",
        summary:
          "One incoming message produces a primary person node, linked organization, durable preference, and a follow-up task.",
        chips: ["append-only", "reviewed", "workspace-scoped"],
        children: [
          {
            id: "person-entity",
            label: "Entity: Alex Kim",
            kind: "Person",
            summary:
              "Primary contact with role ownership and source-linked facts that can be reused across threads.",
            chips: ["primary", "person", "owner"],
            children: [
              {
                id: "person-attribute-role",
                label: "Attribute: role",
                kind: "Field",
                summary:
                  "Normalized to 'vendor onboarding owner' from natural language 'owns vendor onboarding'.",
                chips: ["normalized", "derived"],
              },
              {
                id: "person-attribute-preference",
                label: "Attribute: communication preference",
                kind: "Field",
                summary:
                  "Stored as a reusable preference so future agents choose the right delivery style automatically.",
                chips: ["durable", "preference"],
              },
            ],
          },
          {
            id: "person-org",
            label: "Relationship: works at Acme Health",
            kind: "Relationship",
            summary:
              "Links the person node to the organization node so both records benefit from the same evidence chain.",
            chips: ["relationship", "organization"],
          },
          {
            id: "person-task",
            label: "Task: send draft by Thursday",
            kind: "Operational memory",
            summary:
              "Follow-up stored with source reference so agents can act on it and explain where it came from.",
            chips: ["actionable", "deadline"],
          },
        ],
      },
      relations: [
        {
          source: "Alex Kim",
          label: "works_at",
          target: "Acme Health",
          note: "Organization affiliation extracted directly from the meeting note.",
        },
        {
          source: "Alex Kim",
          label: "prefers",
          target: "Weekly email summaries",
          note: "Stored as a durable preference for future agent behavior.",
        },
        {
          source: "Q3 planning call",
          label: "created_task",
          target: "Send draft by Thursday",
          note: "Operational memory stays attached to the originating event.",
        },
      ],
    },
  },
  finance: {
    id: "finance",
    label: "Finance",
    agent: {
      identity: [
        "You help finance teams reconcile data, explain variance, and prepare reporting runs.",
        "Spot anomalies early and summarize them in operator language.",
      ],
      soul: [
        "- Be exact with numbers and dates.",
        "- Separate confirmed variance from possible causes.",
        "- Escalate payment risk quickly.",
      ],
      user: [
        "- Team: Finance ops",
        "- Close: Month-end in progress",
        "- Preference: Clear exceptions list",
      ],
    },
    model: {
      entities: ["Account", "Transaction", "Variance", "Report"],
      relationships: [
        {
          label: "reconciles_to",
          note: "Tie transactions and balances back to the accounts they roll into.",
        },
        {
          label: "creates_variance",
          note: "Keep anomalies attached to the source records that produced them.",
        },
        {
          label: "summarized_in",
          note: "Let agents trace reporting outputs back to the supporting data.",
        },
      ],
    },
    skills: {
      description: "Reconcile accounts, generate reports, flag anomalies",
      agentId: "finance-ops",
      skillId: "finance-ops",
      skills: ["quickbooks-mcp", "stripe-mcp", "csv-tools"],
      allowedDomains: ["quickbooks.api.intuit.com", "api.stripe.com"],
      mcpServer: "stripe-mcp",
      providerId: "anthropic",
      model: "claude/sonnet-4-5",
      apiKeyEnv: "ANTHROPIC_API_KEY",
      skillInstructions: [
        "Lead with exceptions, then summarize reconciled balances.",
        "Prepare operator-ready notes for anomalies that need review.",
      ],
    },
  },
  sales: {
    id: "sales",
    label: "Sales",
    agent: {
      identity: [
        "You help revenue teams track account health, rollout progress, and renewal signals.",
        "Keep every commercial update tied to the people, products, and risks behind it.",
      ],
      soul: [
        "- Focus on what changes account trajectory.",
        "- Separate confirmed signals from speculation.",
        "- Flag renewal risk early and clearly.",
      ],
      user: [
        "- Team: Revenue operations",
        "- Priority: Protect renewals and identify expansion",
        "- Preference: Account summaries with clear next steps",
      ],
    },
    model: {
      entities: ["Organization", "Region", "Team", "Product", "Renewal risk"],
      relationships: [
        {
          label: "expanded_into",
          note: "Track where an account is growing so territory and rollout context stay explicit.",
        },
        {
          label: "runs",
          note: "Link the internal team or customer function to the pilot they own.",
        },
        {
          label: "affects",
          note: "Connect commercial signals directly to the renewal or expansion they influence.",
        },
      ],
    },
    memory: {
      id: "company",
      description:
        "Track accounts, pilots, renewal risk, and buying signals.",
      sourceLabel: "Example prompt",
      sourceText:
        "Remember that Northstar Foods expanded into EMEA, launched the Warehouse OS pilot under the Operations team, and raised a pricing concern ahead of the October renewal.",
      entitySelections: {
        Organization: "company-entity",
        Region: "company-region",
        Team: "company-team",
        Product: "company-pilot",
        "Renewal risk": "company-risk",
      },
      howItWorks: [
        {
          id: "model",
          label: "1",
          title: "Model the world",
          detail:
            "Represent accounts as organizations with regions, teams, pilots, and risks instead of flattening everything into CRM notes.",
          chips: ["Organization", "Region", "Team", "Product", "Renewal risk"],
        },
        {
          id: "connect",
          label: "2",
          title: "Connect sources",
          detail:
            "Ingest CRM updates, product telemetry, support signals, and internal notes through supported connectors, MCP proxying, and custom SDK integrations.",
          chips: [
            "CRM",
            "Product events",
            "Support data",
            "Internal notes",
            "Custom SDK",
          ],
          links: [technicalLinks.mcpProxy, technicalLinks.connectorSdk],
        },
        {
          id: "auth",
          label: "3",
          title: "Let users connect their data",
          detail:
            "Mix OAuth for SaaS apps, API keys for services, and service accounts for internal pipelines while keeping credentials scoped outside the agent runtime.",
          chips: ["OAuth", "API keys", "Service account", "Scheduled imports"],
          links: [technicalLinks.memoryDocs, technicalLinks.mcpAuthFlow],
        },
        {
          id: "reuse",
          label: "4",
          title: "Reuse context everywhere",
          detail:
            "Shared account context can power revenue agents in Slack, operator workflows in chat, and MCP clients like OpenClaw, ChatGPT, and Claude.",
          chips: ["Slack", "Messaging apps", "OpenClaw", "ChatGPT", "Claude"],
        },
        {
          id: "fresh",
          label: "5",
          title: "Keep it fresh",
          detail:
            "Watchers turn ongoing account changes into updated risk, expansion, and renewal state without rewriting the whole record by hand.",
        },
      ],
      watcher: {
        name: "Account health monitor",
        schedule: "Every 12 hours",
        prompt:
          "Poll CRM data for Northstar Foods. Track expansion progress, risk level changes, and renewal timeline.",
        extractionSchema:
          "{ risk_level, expansion_status, renewal_blockers[], activity_delta }",
        schemaEvolution:
          "Started with risk_level + renewal_date. After processing EMEA expansion data, added region_status and pilot_health fields automatically.",
      },
      highlights: [
        { label: "Organization", value: "Northstar Foods" },
        { label: "Expansion", value: "EMEA" },
        { label: "Pilot", value: "Warehouse OS" },
        {
          label: "Commercial signal",
          value: "Pricing concern before October renewal",
        },
      ],
      nodeHighlights: {
        "company-root": [
          { label: "Organization", value: "Northstar Foods" },
          { label: "Expansion", value: "EMEA" },
          { label: "Pilot", value: "Warehouse OS" },
          { label: "Renewal signal", value: "Pricing concern before October" },
        ],
        "company-entity": [
          { label: "Type", value: "Organization" },
          { label: "Name", value: "Northstar Foods" },
          { label: "Expansion region", value: "EMEA" },
          { label: "Owner team", value: "Operations" },
        ],
        "company-region": [
          { label: "Node type", value: "Geography" },
          { label: "Region", value: "EMEA" },
          { label: "Status", value: "Expanded into" },
          { label: "Parent", value: "Northstar Foods" },
        ],
        "company-team": [
          { label: "Node type", value: "Team" },
          { label: "Team", value: "Operations" },
          { label: "Owns", value: "Warehouse OS pilot" },
          { label: "Role", value: "Pilot operator" },
        ],
        "company-pilot": [
          { label: "Type", value: "Product rollout" },
          { label: "Name", value: "Warehouse OS pilot" },
          { label: "Owner", value: "Operations team" },
          { label: "Account", value: "Northstar Foods" },
        ],
        "company-risk": [
          { label: "Type", value: "Renewal risk" },
          { label: "Signal", value: "Pricing concern" },
          { label: "Affects", value: "October renewal" },
          { label: "Severity", value: "Needs follow-up" },
        ],
      },
      recordTree: {
        id: "company-root",
        label: "Record: Northstar Foods update",
        kind: "Model record",
        summary:
          "One sync note expands the company node with geography, internal team structure, product rollout state, and renewal risk.",
        chips: ["org graph", "timelined", "inspectable"],
        children: [
          {
            id: "company-entity",
            label: "Entity: Northstar Foods",
            kind: "Organization",
            summary:
              "The primary organization node accumulates account context instead of scattering it across separate summaries.",
            chips: ["primary", "account"],
            children: [
              {
                id: "company-region",
                label: "Child node: EMEA expansion",
                kind: "Geography",
                summary:
                  "Region expansion modeled as structured company growth metadata, not buried inside free text.",
                chips: ["hierarchy", "region"],
              },
              {
                id: "company-team",
                label: "Child node: Operations team",
                kind: "Team",
                summary:
                  "Internal org structure lets the memory graph represent where pilots and issues actually live.",
                chips: ["team", "owner"],
              },
            ],
          },
          {
            id: "company-pilot",
            label: "Entity: Warehouse OS pilot",
            kind: "Product rollout",
            summary:
              "The pilot is tracked as its own typed object with state, owner, and relationship back to the company account.",
            chips: ["product", "stateful"],
          },
          {
            id: "company-risk",
            label: "Entity: pricing concern",
            kind: "Renewal risk",
            summary:
              "Commercial risk is separated from the raw note so success or sales agents can query it directly later.",
            chips: ["risk", "renewal"],
          },
        ],
      },
      relations: [
        {
          source: "Northstar Foods",
          label: "expanded_into",
          target: "EMEA",
          note: "Regional growth becomes part of the organization hierarchy.",
        },
        {
          source: "Operations team",
          label: "runs",
          target: "Warehouse OS pilot",
          note: "Owning team provides retrieval context for future planning questions.",
        },
        {
          source: "Pricing concern",
          label: "affects",
          target: "October renewal",
          note: "Temporal linkage makes the signal useful for upcoming workflows.",
        },
      ],
    },
  },
  delivery: {
    id: "delivery",
    label: "Delivery",
    agent: {
      identity: [
        "You help delivery teams keep milestones, blockers, owners, and artifacts aligned.",
        "Turn operational updates into reusable project context instead of one-off status notes.",
      ],
      soul: [
        "- Lead with blockers and dependencies.",
        "- Preserve ownership and evidence.",
        "- Keep leadership updates concise and factual.",
      ],
      user: [
        "- Team: Delivery operations",
        "- Priority: Keep rollouts unblocked",
        "- Preference: Weekly risk snapshots",
      ],
    },
    model: {
      entities: ["Project", "Milestone", "Stakeholder", "Blocker", "Document"],
      relationships: [
        {
          label: "owned_by",
          note: "Keep project ownership queryable across updates and artifacts.",
        },
        {
          label: "blocked_by",
          note: "Tie blockers directly to the project and milestone they threaten.",
        },
        {
          label: "documented_in",
          note: "Preserve the source documents and reviews behind key project state.",
        },
      ],
    },
    memory: {
      id: "project",
      description:
        "Keep milestones, blockers, owners, and reporting context in one shared record.",
      sourceLabel: "Example prompt",
      sourceText:
        "Remember that Phoenix migration is in phase two, Maya owns the rollout, infra is blocking the SSO cutover, the design review is in the launch doc, and leadership wants a risk update every Monday.",
      entitySelections: {
        Project: "project-node",
        Milestone: "project-phase",
        Stakeholder: "project-owner",
        Blocker: "project-blocker",
        Document: "project-doc",
      },
      howItWorks: [
        {
          id: "model",
          label: "1",
          title: "Model the world",
          detail:
            "Treat projects as first-class objects with milestones, owners, blockers, artifacts, and recurring reporting expectations.",
          chips: ["Project", "Milestone", "Stakeholder", "Blocker", "Document"],
        },
        {
          id: "connect",
          label: "2",
          title: "Connect sources",
          detail:
            "Bring project state in from GitHub, Linear, Slack, docs, and internal app events through MCP proxying or custom Connector SDKs.",
          chips: ["GitHub", "Linear", "Slack", "Docs", "Custom SDK"],
          links: [technicalLinks.mcpProxy, technicalLinks.connectorSdk],
        },
        {
          id: "auth",
          label: "3",
          title: "Let users connect their data",
          detail:
            "Support OAuth for engineering tools, API keys for internal services, and source-specific imports for historical project state and artifacts.",
          chips: ["OAuth", "API keys", "Webhooks", "Manual import"],
          links: [technicalLinks.memoryDocs, technicalLinks.mcpAuthFlow],
        },
        {
          id: "reuse",
          label: "4",
          title: "Reuse context everywhere",
          detail:
            "Use the same project memory from standup bots, planning assistants, chat threads, and MCP clients like OpenClaw, ChatGPT, and Claude.",
          chips: ["Standups", "Planning", "OpenClaw", "ChatGPT", "Claude"],
        },
        {
          id: "fresh",
          label: "5",
          title: "Keep it fresh",
          detail:
            "Watchers turn new blockers, milestone changes, and reporting cadences into updated project memory and ready-to-send summaries.",
        },
      ],
      watcher: {
        name: "Phoenix rollout tracker",
        schedule: "Every Monday at 9 AM",
        prompt:
          "Check Phoenix migration blockers, milestone progress, and generate the weekly risk summary for leadership.",
        extractionSchema:
          "{ blockers_resolved[], milestone_state, new_risks[], risk_summary }",
        schemaEvolution:
          "Started with blocker_status + phase. After the design review brief arrived, added document_references and dependency_chain fields.",
      },
      highlights: [
        { label: "Project", value: "Phoenix migration" },
        { label: "Current phase", value: "Phase two" },
        { label: "Blocker", value: "Infra blocking SSO cutover" },
        { label: "Reporting cadence", value: "Risk update every Monday" },
      ],
      nodeHighlights: {
        "project-root": [
          { label: "Project", value: "Phoenix migration" },
          { label: "Phase", value: "Phase two" },
          { label: "Owner", value: "Maya" },
          { label: "Reporting cadence", value: "Every Monday" },
        ],
        "project-node": [
          { label: "Type", value: "Project" },
          { label: "Name", value: "Phoenix migration" },
          { label: "State", value: "Phase two" },
          { label: "Owner", value: "Maya" },
        ],
        "project-phase": [
          { label: "Type", value: "Milestone" },
          { label: "Name", value: "Phase two" },
          { label: "Lifecycle", value: "In progress" },
          { label: "Parent", value: "Phoenix migration" },
        ],
        "project-blocker": [
          { label: "Type", value: "Dependency" },
          { label: "Blocker", value: "SSO cutover" },
          { label: "Owned by", value: "Infra" },
          { label: "Impact", value: "Blocks rollout progress" },
        ],
        "project-doc": [
          { label: "Type", value: "Reference" },
          { label: "Document", value: "Launch doc" },
          { label: "Contains", value: "Design review" },
          { label: "Linked to", value: "Phoenix migration" },
        ],
        "project-owner": [
          { label: "Type", value: "Person" },
          { label: "Name", value: "Maya" },
          { label: "Role", value: "Project owner" },
          { label: "Owns", value: "Phoenix migration rollout" },
        ],
        "project-cadence": [
          { label: "Type", value: "Preference" },
          { label: "Audience", value: "Leadership" },
          { label: "Update", value: "Risk summary" },
          { label: "Cadence", value: "Every Monday" },
        ],
      },
      recordTree: {
        id: "project-root",
        label: "Record: Phoenix migration state",
        kind: "Model record",
        summary:
          "Project state becomes a hierarchy of phase, owner, blocker, linked doc, and recurring leadership request.",
        chips: ["project memory", "linked artifacts", "actionable"],
        children: [
          {
            id: "project-node",
            label: "Entity: Phoenix migration",
            kind: "Project",
            summary:
              "Composite project node holding lifecycle state, stakeholders, blockers, and references in one place.",
            chips: ["primary", "project"],
            children: [
              {
                id: "project-phase",
                label: "Milestone: phase two",
                kind: "Milestone",
                summary:
                  "Lifecycle state kept as a first-class project milestone rather than a sentence fragment.",
                chips: ["state", "milestone"],
              },
              {
                id: "project-blocker",
                label: "Blocker: SSO cutover",
                kind: "Dependency",
                summary:
                  "Operational blocker linked to the owning infra function so agents can surface it automatically in updates.",
                chips: ["dependency", "risk"],
              },
              {
                id: "project-doc",
                label: "Document: launch doc",
                kind: "Reference",
                summary:
                  "The design review is attached as a document reference instead of disappearing inside an opaque note.",
                chips: ["artifact", "evidence"],
              },
            ],
          },
          {
            id: "project-owner",
            label: "Stakeholder: Maya",
            kind: "Person",
            summary:
              "Project ownership becomes directly queryable for routing follow-ups and status requests.",
            chips: ["owner", "stakeholder"],
          },
          {
            id: "project-cadence",
            label: "Preference: Monday risk update",
            kind: "Preference",
            summary:
              "Leadership reporting expectations are durable memory too, so agents can follow them consistently.",
            chips: ["cadence", "leadership"],
          },
        ],
      },
      relations: [
        {
          source: "Phoenix migration",
          label: "owned_by",
          target: "Maya",
          note: "Ownership becomes a stable graph edge instead of a transient note.",
        },
        {
          source: "Phoenix migration",
          label: "blocked_by",
          target: "SSO cutover dependency",
          note: "Operational blockers remain tied to the project for retrieval and updates.",
        },
        {
          source: "Phoenix migration",
          label: "documented_in",
          target: "Launch doc",
          note: "Source artifacts stay attached to the project record.",
        },
      ],
    },
  },
  leadership: {
    id: "leadership",
    label: "Leadership",
    agent: {
      identity: [
        "You help leadership teams turn memos, decisions, and board materials into reusable operating context.",
        "Keep decisions, blockers, and assignments attached to their source evidence.",
      ],
      soul: [
        "- Preserve decision history.",
        "- Keep blockers and owners explicit.",
        "- Separate approved, pending, and blocked outcomes.",
      ],
      user: [
        "- Team: Executive operations",
        "- Priority: Preserve decision context between reviews",
        "- Preference: Action-oriented summaries",
      ],
    },
    model: {
      entities: ["Document", "Decision", "Region", "Risk", "Task"],
      relationships: [
        {
          label: "approved",
          note: "Keep approved decisions queryable without re-reading the whole source memo.",
        },
        {
          label: "blocked_by",
          note: "Attach blocked decisions to the dependency that is holding them up.",
        },
        {
          label: "assigned",
          note: "Turn follow-up work into durable ownership instead of transient notes.",
        },
      ],
    },
    memory: {
      id: "document",
      description:
        "Turn decisions, blockers, and assignments from source documents into reusable context.",
      sourceLabel: "Example prompt",
      sourceText:
        "From this board memo, remember that the LATAM expansion budget was approved, the warehouse lease decision is delayed pending legal review, and Elena needs to update the forecast for next week's board packet.",
      entitySelections: {
        Document: "document-node",
        Decision: "document-decision-approved",
        Region: "document-decision-approved",
        Risk: "document-blocker",
        Task: "document-task",
      },
      howItWorks: [
        {
          id: "model",
          label: "1",
          title: "Model the world",
          detail:
            "Treat source files as evidence objects, then extract decisions, blockers, regions, and tasks into linked structured memory.",
          chips: ["Document", "Decision", "Region", "Risk", "Task"],
        },
        {
          id: "connect",
          label: "2",
          title: "Connect sources",
          detail:
            "Ingest uploads, cloud docs, PDFs, browser-backed systems, and custom SDK feeds while routing MCP access through the proxy layer.",
          chips: [
            "File upload",
            "Google Drive",
            "PDFs",
            "Browser auth",
            "Custom SDK",
          ],
          links: [technicalLinks.mcpProxy, technicalLinks.connectorSdk],
        },
        {
          id: "auth",
          label: "3",
          title: "Let users connect their data",
          detail:
            "Let users authorize Drive and knowledge tools with OAuth, attach API-backed sources, or import documents directly when manual capture makes more sense.",
          chips: ["OAuth", "Browser auth", "API keys", "File upload"],
          links: [technicalLinks.memoryDocs, technicalLinks.mcpAuthFlow],
        },
        {
          id: "reuse",
          label: "4",
          title: "Reuse context everywhere",
          detail:
            "The extracted decisions and assignments are available from document QA agents, messaging workflows, and MCP clients like OpenClaw, ChatGPT, and Claude.",
          chips: [
            "Document QA",
            "Messaging apps",
            "OpenClaw",
            "ChatGPT",
            "Claude",
          ],
        },
        {
          id: "fresh",
          label: "5",
          title: "Keep it fresh",
          detail:
            "Watchers keep pending decisions, legal blockers, and assigned tasks current as new board materials and follow-ups arrive.",
        },
      ],
      watcher: {
        name: "Board action tracker",
        schedule: "Daily at 8 AM",
        prompt:
          "Track board action items: check Elena's forecast delivery, legal review status, and upcoming board packet deadlines.",
        extractionSchema:
          "{ action_items[], blocked_items[], deadlines_approaching[], completion_status }",
        schemaEvolution:
          "Started with decision_status + owner. After two board cycles, added deadline_proximity and cross-reference fields for linked decisions.",
      },
      highlights: [
        { label: "Approved", value: "LATAM expansion budget" },
        { label: "Pending", value: "Warehouse lease decision" },
        { label: "Blocker", value: "Legal review" },
        { label: "Owner", value: "Elena" },
      ],
      nodeHighlights: {
        "document-root": [
          { label: "Source", value: "Board memo" },
          { label: "Approved", value: "LATAM expansion budget" },
          { label: "Pending", value: "Warehouse lease decision" },
          { label: "Assigned", value: "Elena updates forecast" },
        ],
        "document-node": [
          { label: "Type", value: "Document" },
          { label: "Name", value: "Board memo" },
          { label: "Role", value: "Evidence object" },
          { label: "Used for", value: "Decisions and task extraction" },
        ],
        "document-decision-approved": [
          { label: "Type", value: "Decision" },
          { label: "Status", value: "Approved" },
          { label: "Subject", value: "LATAM expansion budget" },
          { label: "Source", value: "Board memo" },
        ],
        "document-decision-pending": [
          { label: "Type", value: "Pending decision" },
          { label: "Subject", value: "Warehouse lease" },
          { label: "Status", value: "Delayed" },
          { label: "Blocked by", value: "Legal review" },
        ],
        "document-blocker": [
          { label: "Type", value: "Risk" },
          { label: "Blocker", value: "Legal review" },
          { label: "Affects", value: "Warehouse lease decision" },
          { label: "State", value: "Pending resolution" },
        ],
        "document-task": [
          { label: "Type", value: "Task" },
          { label: "Owner", value: "Elena" },
          { label: "Action", value: "Update forecast" },
          { label: "Deadline", value: "Before next week's board packet" },
        ],
      },
      recordTree: {
        id: "document-root",
        label: "Record: Board memo extraction",
        kind: "Model record",
        summary:
          "The source memo remains intact while decisions, blockers, and assignments become linked structured memory.",
        chips: ["document-backed", "auditable", "multi-entity"],
        children: [
          {
            id: "document-node",
            label: "Source: board memo",
            kind: "Document",
            summary:
              "The memo is stored as an evidence object so every extracted fact can point back to a durable source.",
            chips: ["source of truth", "artifact"],
          },
          {
            id: "document-decision-approved",
            label: "Decision: approve LATAM budget",
            kind: "Decision",
            summary:
              "Approved outcomes are structured separately from pending or blocked items, so agents summarize accurately.",
            chips: ["approved", "decision"],
          },
          {
            id: "document-decision-pending",
            label: "Decision: warehouse lease delayed",
            kind: "Pending decision",
            summary:
              "Pending outcomes keep their blocker attached so future updates can explain why they are still unresolved.",
            chips: ["pending", "blocked"],
            children: [
              {
                id: "document-blocker",
                label: "Blocker: legal review",
                kind: "Risk",
                summary:
                  "The legal dependency is preserved as its own object, making it queryable across documents and meetings.",
                chips: ["dependency", "legal"],
              },
            ],
          },
          {
            id: "document-task",
            label: "Task: Elena updates forecast",
            kind: "Task",
            summary:
              "Assignments created by the memo can feed downstream workflows while preserving the board memo source.",
            chips: ["owner", "deliverable"],
          },
        ],
      },
      relations: [
        {
          source: "Board memo",
          label: "approved",
          target: "LATAM expansion budget",
          note: "Decision state can be surfaced independently from the full memo text.",
        },
        {
          source: "Warehouse lease decision",
          label: "blocked_by",
          target: "Legal review",
          note: "Blockers keep the pending item contextualized.",
        },
        {
          source: "Elena",
          label: "assigned",
          target: "Updated forecast",
          note: "Ownership becomes reusable operational memory.",
        },
      ],
    },
  },
} satisfies Record<string, LandingUseCaseDefinition>;

export type LandingUseCaseId = keyof typeof landingUseCases;
