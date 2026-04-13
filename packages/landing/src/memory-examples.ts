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

export type MemoryExample = {
  id: string;
  tab: string;
  title: string;
  description: string;
  sourceLabel: string;
  sourceText: string;
  entityTypes: string[];
  entitySelections?: Record<string, string>;
  transformation: Array<{
    label: string;
    title: string;
    detail: string;
  }>;
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

export const capabilityLenses = [
  {
    title: "Capture",
    body: "Accept prompts and data from MCP clients, coding tools, and messaging apps.",
    accent: "#67e8f9",
  },
  {
    title: "Structure",
    body: "Extract entities, relationships, hierarchy, and source tracking into primary records.",
    accent: "#c084fc",
  },
  {
    title: "Use",
    body: "Search, inspect, and reuse structured memory across agents and tools.",
    accent: "#86efac",
  },
  {
    title: "Watch",
    body: "Run persistent prompts over memory, turning stored context into updates, alerts, and actions.",
    accent: "#fb7185",
  },
];

export const sharedRecallStep = {
  label: "4",
  title: "Recall",
  detail:
    "Agents search by entity name and inspect fields via read-only SQL. BM25 full-text retrieval and semantic vector search find relevant facts even when wording changes.",
};

export const sharedActStep = {
  label: "5",
  title: "Act",
  detail:
    "Watchers run on a schedule — each one has a prompt, an extraction schema for the output shape, and a schema that evolves as new patterns emerge across runs.",
};

export const examples: MemoryExample[] = [
  {
    id: "person",
    tab: "Person",
    title: "A person record becomes more than a contact card",
    description:
      "Owletto separates a human, their role, their preferences, and the organization they belong to — then keeps the evidence behind each field.",
    sourceLabel: "Example prompt",
    sourceText:
      "Remember that Alex Kim from Acme Health owns vendor onboarding, prefers weekly email summaries, and asked us to send the draft by Thursday.",
    entityTypes: ["Person", "Organization", "Preference", "Task"],
    entitySelections: {
      Person: "person-entity",
      Organization: "person-org",
      Preference: "person-attribute-preference",
      Task: "person-task",
    },
    transformation: [
      {
        label: "1",
        title: "Extract",
        detail:
          "Identify Alex Kim, Acme Health, the onboarding workflow, and the follow-up draft request from one conversational input.",
      },
      {
        label: "2",
        title: "Normalize",
        detail:
          "Turn raw phrasing into typed fields like role, communication preference, and due date instead of storing a blob of text.",
      },
      {
        label: "3",
        title: "Link",
        detail: "Create relationship edges.",
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
  {
    id: "company",
    tab: "Company",
    title: "A company record keeps hierarchy, not just CRM fields",
    description:
      "Owletto represents the company, its product lines, internal teams, and changing customer signals inside one inspectable memory flow.",
    sourceLabel: "Example prompt",
    sourceText:
      "Remember that Northstar Foods expanded into EMEA, launched the Warehouse OS pilot under the Operations team, and raised a pricing concern ahead of the October renewal.",
    entityTypes: ["Organization", "Region", "Team", "Product", "Renewal risk"],
    entitySelections: {
      Organization: "company-entity",
      Region: "company-region",
      Team: "company-team",
      Product: "company-pilot",
      "Renewal risk": "company-risk",
    },
    transformation: [
      {
        label: "1",
        title: "Extract",
        detail:
          "Capture the company, expansion region, product pilot, internal team, and renewal risk from a single operating note.",
      },
      {
        label: "2",
        title: "Normalize",
        detail:
          "Convert loose phrasing into organization metadata, product rollout state, and commercial risk objects.",
      },
      {
        label: "3",
        title: "Link",
        detail:
          "Create relationship edges: Northstar Foods expanded_into EMEA, Operations team runs Warehouse OS pilot, and pricing concern affects October renewal. These edges let agents traverse the account graph directly.",
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
  {
    id: "project",
    tab: "Project",
    title: "Projects become composite memory objects",
    description:
      "Instead of one project summary, Owletto keeps milestones, stakeholders, blockers, and documents linked under the same project hierarchy.",
    sourceLabel: "Example prompt",
    sourceText:
      "Remember that Phoenix migration is in phase two, Maya owns the rollout, infra is blocking the SSO cutover, the design review is in the launch doc, and leadership wants a risk update every Monday.",
    entityTypes: ["Project", "Milestone", "Stakeholder", "Blocker", "Document"],
    entitySelections: {
      Project: "project-node",
      Milestone: "project-phase",
      Stakeholder: "project-owner",
      Blocker: "project-blocker",
      Document: "project-doc",
    },
    transformation: [
      {
        label: "1",
        title: "Extract",
        detail:
          "Separate project phase, owner, blocker, source document, and reporting cadence from one project update.",
      },
      {
        label: "2",
        title: "Normalize",
        detail:
          "Store phase two as milestone state, convert the blocker into an operational dependency, and structure the cadence request as a repeatable preference.",
      },
      {
        label: "3",
        title: "Link",
        detail: "Create relationship edges.",
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
  {
    id: "document",
    tab: "Document",
    title: "Documents become structured memory, not just attachments",
    description:
      "Owletto treats a memo or transcript as a source object, then extracts entities, decisions, and follow-ups while keeping the document as evidence.",
    sourceLabel: "Example prompt",
    sourceText:
      "From this board memo, remember that the LATAM expansion budget was approved, the warehouse lease decision is delayed pending legal review, and Elena needs to update the forecast for next week's board packet.",
    entityTypes: ["Document", "Decision", "Region", "Risk", "Task"],
    entitySelections: {
      Document: "document-node",
      Decision: "document-decision-approved",
      Region: "document-decision-approved",
      Risk: "document-blocker",
      Task: "document-task",
    },
    transformation: [
      {
        label: "1",
        title: "Extract",
        detail:
          "Identify decisions, delays, owners, and upcoming deliverables directly from the memo body.",
      },
      {
        label: "2",
        title: "Normalize",
        detail:
          "Classify approved, pending, and assigned items into typed decision and task records.",
      },
      {
        label: "3",
        title: "Link",
        detail: "Create relationship edges.",
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
];

export const connectorModes = [
  {
    label: "OAuth",
    text: "Connectors declare scopes. Owletto handles login, storage, refresh, and upgrades.",
  },
  {
    label: "MCP",
    text: "Connector Proxy lets create a change data capture from your MCP tool calls.",
  },
  {
    label: "API keys",
    text: "Saved or environment-backed credentials, never exposed to workers.",
  },
  {
    label: "Browser",
    text: "Persist browser auth, launch a browser, or connect over CDP.",
  },
];

export type FaqItem = {
  q: string;
  a: string;
  link?: {
    href: string;
    label: string;
  };
};

export const faqItems: FaqItem[] = [
  {
    q: "How is this different from filesystem memory?",
    a: "Filesystem memory lives on one machine and serves one user. Owletto scopes memory by workspace so agents share the same graph, connectors sync external data, and watchers keep it fresh.",
    link: {
      href: "/blog/filesystem-vs-database-agent-memory",
      label: "Read: Filesystem vs Database for Agent Memory",
    },
  },
  {
    q: "How is this different from RAG?",
    a: "RAG returns similar text chunks. Owletto stores typed entities and relationships, then combines entity matching, full-text, and semantic search to find the right context even when wording changes.",
  },
  {
    q: "How is this different from chat history?",
    a: "Chat history is per-conversation and temporary. Owletto turns conversations and external sources into durable knowledge any agent in the workspace can recall.",
  },
  {
    q: "Is memory shared across agents?",
    a: "Yes. Agents in the same workspace share a graph. A support agent can save context that a sales agent recalls later, while organizations stay isolated.",
  },
  {
    q: "Can I use a different memory system?",
    a: "Yes. Workers use MCP tools, so you can point them at any memory server with the same interface.",
  },
];
