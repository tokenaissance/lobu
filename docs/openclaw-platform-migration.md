# Replacing Termos Platform Integrations with OpenClaw Channel Plugins

> Based on OpenClaw main branch (v2026.3.9, commit daf8afc95, March 2026)

## Problem

Termos maintains its own platform adapters for Telegram, Slack, and WhatsApp (57 files, ~16K LOC). OpenClaw already provides channel plugins for these plus many more. This is duplicated effort.

## OpenClaw Current State (v2026.3.9)

### Channel Plugins Available (43 extensions on main)

**Core channels:** Telegram, Slack, Discord, WhatsApp, Signal, iMessage, Google Chat, LINE, Matrix, Mattermost, MS Teams, IRC, Nostr, Zalo, Feishu, Synology Chat, Tlon, Twitch, Nextcloud Talk, BlueBubbles

**Other extensions:** memory-core, memory-lancedb, open-prose, llm-task, voice-call, diagnostics-otel, copilot-proxy, device-pair, thread-ownership, and more.

### Plugin SDK (26 Hooks)

All hooks and their interception capability:

| Hook | Type | Can Intercept? |
|------|------|---------------|
| `message_received` | fire-and-forget (parallel) | No — observe only |
| `message_sending` | sequential | **Yes** — `{cancel: true}` skips send |
| `before_model_resolve` | sequential | Override model/provider only |
| `before_prompt_build` | sequential | Inject system prompt/context |
| `before_agent_start` | sequential | Override model/provider (legacy) |
| `before_tool_call` | sequential | **Yes** — `{block: true}` prevents tool |
| `before_message_write` | synchronous | **Yes** — `{block: true}` prevents write |
| `gateway_start` / `gateway_stop` | fire-and-forget | No |
| All others (`llm_input`, `agent_end`, `session_*`, etc.) | fire-and-forget | No |

**Key constraint:** No hook can cancel or skip agent execution itself. `message_received` is fire-and-forget. Agent execution is hardcoded in OpenClaw's core dispatch path.

### Plugin Registration API (`OpenClawPluginApi`)

Plugins can register:
- `registerChannel()` — dock a ChannelPlugin
- `registerTool()` — agent tools (with factory pattern for context-aware creation)
- `registerService()` — background services with start/stop lifecycle
- `registerHttpRoute()` — custom HTTP endpoints with auth
- `registerGatewayMethod()` — gateway RPC methods
- `registerProvider()` — AI provider auth/credentials
- `registerCommand()` — custom bot commands that bypass LLM
- `registerCli()` — CLI subcommands
- `registerContextEngine()` — exclusive context engine slot
- `on(hookName, handler)` — typed hook registration

### Built-in Agent Execution

OpenClaw runs agents locally in two modes:
1. **CLI agents** (`runCliAgent()`) — spawns external CLI process
2. **Embedded Pi agents** (`runEmbeddedPiAgent()`) — in-process via `@mariozechner/pi-agent-core`

Neither mode is pluggable — the execution path is baked into core code at `src/auto-reply/reply/agent-runner-execution.ts`.

### ACP (Agent Client Protocol)

OpenClaw has a remote agent execution protocol at `/src/acp/` using `@agentclientprotocol/sdk`. This enables external workers to communicate with the gateway. Could be an alternative to custom Redis queues for termos worker communication.

### Docker Sandbox

OpenClaw has its own Docker sandbox system at `/src/agents/sandbox/` (56 files) with container isolation, filesystem bridges, network policies, and security controls. This overlaps with termos's worker isolation.

## Proposed Architecture

```
┌──────────────────────────────────────────────────────────┐
│ OpenClaw (platform + dispatch layer)                      │
│                                                           │
│  43 Channel Plugins (Telegram, Slack, Discord, etc.)     │
│                                                           │
│  message_received hook → termos plugin enqueues to Redis  │
│  routeReply() ← termos response consumer delivers back    │
└────────────┬────────────────────────▲────────────────────┘
             │ Redis queue            │ Redis queue
             │ (messages)             │ (thread_response)
┌────────────▼────────────────────────┴────────────────────┐
│ Termos Extension (OpenClaw plugin)                        │
│                                                           │
│  Orchestrator (Docker/K8s worker lifecycle)               │
│  Secret Proxy (credential injection without exposure)     │
│  MCP Proxy (tool credential management)                   │
│  Worker Gateway (SSE streams for job delivery)            │
│  Response Consumer (routes replies via routeReply())      │
│  Queue Producer (Redis/BullMQ message enqueuing)          │
└──────────────────────────────────────────────────────────┘
                         │ SSE
┌────────────────────────▼─────────────────────────────────┐
│ Termos Workers (Docker/K8s containers)                    │
│                                                           │
│  OpenClaw agent runtime (sandboxed)                       │
│  Custom tools (AskUser, UploadFile, SearchSkills, etc.)   │
│  Settings page (web UI served separately)                 │
└──────────────────────────────────────────────────────────┘
```

## How It Works

### Message Flow (Inbound)

1. User sends message on Telegram/Slack/Discord/etc.
2. OpenClaw's channel plugin receives it via native SDK (Grammy, Bolt, Carbon, etc.)
3. OpenClaw fires `message_received` plugin hook (fire-and-forget)
4. Termos plugin picks up the event, enqueues `MessagePayload` to Redis
5. Termos orchestrator consumes from queue, creates/scales worker deployment
6. Worker receives job via SSE, executes agent

### Preventing Default Agent Execution

Since `message_received` cannot intercept, we need a strategy to prevent OpenClaw from also running its own local agent:

**Option A: No model configured.** Don't set any AI provider/model in OpenClaw config. The dispatch path will fail gracefully at model resolution. Termos workers handle all execution.

**Option B: `before_model_resolve` redirect.** Return `{modelOverride: "noop"}` to force a model that doesn't exist. The agent fails to start, termos handles it.

**Option C: ACP delegation.** Configure ACP to route all agent execution to termos workers. OpenClaw's ACP protocol is designed exactly for remote agent execution. This is the most native approach but requires termos workers to speak ACP.

**Option D: `registerCommand()` catch-all.** Register a custom command that matches all messages and bypasses the LLM entirely. The command handler enqueues to termos pipeline. Cleanest if the command system supports wildcards.

### Message Flow (Outbound)

1. Worker produces `ThreadResponsePayload` on `thread_response` Redis queue
2. Termos response consumer picks up the response
3. Calls OpenClaw's `routeReply()` (lazy-loaded from `src/auto-reply/reply/route-reply.ts`)
4. `routeReply()` identifies the originating channel
5. Fires `message_sending` hook (sequential — other plugins can modify/cancel)
6. Channel's outbound adapter sends message via native platform API
7. Fires `message_sent` hook (fire-and-forget confirmation)

### InteractionService Bridge

Worker tools like AskUser and UploadFile need to render platform-native UI:

1. Worker calls AskUser → POST to termos plugin HTTP endpoint (`/termos/worker/response`)
2. Termos plugin receives interaction request
3. Bridges to OpenClaw's channel outbound adapter to render inline keyboard / Block Kit / etc.
4. User interaction callback flows through OpenClaw → termos plugin → worker via SSE

## The Termos OpenClaw Extension

Located at `../openclaw/extensions/termos/` (currently local/untracked, needs update for latest SDK).

### Services (7)

| Service | Purpose |
|---------|---------|
| `termos-orchestrator` | Worker deployment lifecycle (K8s/Docker/Local) |
| `termos-proxy` | HTTP filtering proxy for worker network isolation |
| `termos-tenant` | Multi-tenant context resolution |
| `termos-queue` | Message queue producer (Redis/BullMQ) |
| `termos-mcp-proxy` | MCP credential and request proxying |
| `termos-worker-gateway` | SSE streams + HTTP endpoints for workers |
| `termos-response-consumer` | Routes worker responses back via routeReply() |

### HTTP Routes

- `POST /termos/worker/stream` — SSE stream for workers to receive jobs
- `POST /termos/worker/response` — workers POST responses/interactions
- `GET /termos/worker/config` — workers fetch MCP config
- `POST /termos/api/messaging/send` — enqueue a message externally
- `GET /termos/mcp/oauth/callback` — MCP OAuth flow

### Tool Factories

- **AskUserQuestion** — posts question to user, waits for response via SSE
- **UploadUserFile** — shares generated files with user via channel outbound

### Hooks

- `message_received` — fire-and-forget enqueue to Redis pipeline
- `before_agent_start` — inject tenant context into prompt

### Extension Status

The extension was written against a stale branch (17,987 commits behind main). It needs:
- Update imports to current `openclaw/plugin-sdk` API
- Remove `{handled: true}` return from `message_received` (hook is void now)
- Fix `MessagePayload` field mapping (`platform` should be `"telegram"` not `ctx.channelId`)
- Verify `routeReply()` import path against current module layout
- Update `package.json` dependencies

## What Termos Keeps

- **Worker orchestration** — Docker/K8s deployment manager, idle cleanup, scaling
- **Secret proxy** — workers never see real API credentials
- **MCP proxy** — tool credential management and OAuth flows
- **Settings page** — web UI for providers, models, skills, permissions
- **Grant system** — network access approval with per-domain control
- **Custom tools** — AskUser, UploadFile, SearchSkills, InstallSkill, InstallPackage, RequestNetworkAccess, etc.
- **Scheduling** — reminders and cron-based recurring tasks
- **Session management** — persistent sessions across worker restarts

## What Termos Deletes

- `packages/gateway/src/telegram/` (14 files, ~3,738 LOC)
- `packages/gateway/src/slack/` (25 files, ~6,959 LOC)
- `packages/gateway/src/whatsapp/` (15 files, ~4,746 LOC)
- Platform-specific response renderers, interaction renderers, file handlers, converters
- Total: **~57 files, ~15,859 LOC removed**

## What Termos Gains

- **20+ platforms** including Discord, Signal, iMessage, Google Chat, LINE, Matrix, Mattermost, MS Teams, IRC, Nostr, Twitch, Zalo, Feishu, etc.
- **No maintenance burden** for platform SDK updates, API changes, message formatting
- **Pull latest from OpenClaw** to get new platforms and bug fixes

## Known Gaps & Challenges

### 1. Cannot Cancel Default Agent Execution via Hooks

`message_received` is fire-and-forget. No hook can prevent OpenClaw from trying to run its local agent. Options:
- **No model configured** — agent dispatch fails gracefully at model resolution
- **ACP delegation** — use OpenClaw's native remote execution protocol
- **Catch-all command** — `registerCommand()` to bypass LLM for all messages

### 2. InteractionService Bridge (Hardest Part)

Termos has a rich `InteractionService` (questions with buttons, grant approvals, link buttons, package install requests). OpenClaw has no equivalent generic abstraction — each channel handles interactions natively via `ChannelMessageActionAdapter`.

The termos extension needs to bridge interaction events to OpenClaw's per-channel outbound adapters. This requires understanding each channel's button/keyboard/card API.

### 3. ACP vs Custom SSE/Queue

OpenClaw has ACP (`@agentclientprotocol/sdk`) for remote agent execution. The current termos extension uses custom SSE + Redis queues instead. Migrating to ACP would be more native but requires reworking the worker communication protocol.

### 4. Docker Sandbox Overlap

OpenClaw has its own Docker sandbox system (56 files at `src/agents/sandbox/`). Termos has its own worker isolation via Docker/K8s. These overlap. Long-term, termos workers could use OpenClaw's sandbox system, but for now they coexist.

### 5. Response Streaming

Termos workers stream `delta` payloads. OpenClaw's Telegram adapter supports "draft streaming" (editing messages progressively). The response consumer currently skips `statusUpdate` payloads and treats responses as atomic. Needs mapping to OpenClaw's streaming mechanism.

### 6. File Handling

UploadFile tool calls `/internal/files/upload` which doesn't exist in OpenClaw. Needs to bridge through OpenClaw's channel outbound adapter with `mediaUrl` support.

### 7. Settings Page Link Buttons

Settings page is accessed via platform-native buttons. The termos extension must use OpenClaw's outbound adapters to post these links, or serve them via the extension's HTTP routes.

### 8. OpenClaw Version Coupling

Termos becomes dependent on OpenClaw's plugin SDK (26 hooks, ChannelPlugin interface, OpenClawPluginApi). Pin to specific versions and test upgrades carefully.

## Migration Phases

### Phase 1: Spike (Telegram)
- Update termos extension to latest OpenClaw plugin SDK
- Run OpenClaw side-by-side with termos (different ports)
- OpenClaw handles Telegram, termos keeps Slack/WhatsApp
- Validate: message round-trip, response delivery, basic streaming

### Phase 2: Production Telegram
- Harden the termos extension (error handling, retry, logging)
- Implement InteractionService bridge for Telegram
- Implement file upload bridge
- Remove termos Telegram adapter

### Phase 3: Slack & WhatsApp Migration
- Configure OpenClaw Slack and WhatsApp channel plugins
- Validate against termos's existing platform-specific features
- Remove termos Slack and WhatsApp adapters

### Phase 4: New Platforms
- Enable Discord, Signal, and other channels in OpenClaw config
- No termos code changes needed — just configuration

### Phase 5: ACP Migration (Optional)
- Replace custom SSE/queue communication with ACP protocol
- Workers speak ACP natively
- Simplifies the termos extension significantly

## Runtime Architecture

### Development Mode (Side-by-Side)
```
┌─────────────┐     ┌──────────────────────┐
│ OpenClaw     │────▶│ Redis                │◀──── Workers
│ (port 9090)  │     │ (shared)             │
└─────────────┘     └──────────────────────┘
                          ▲
┌─────────────┐           │
│ Termos GW   │───────────┘
│ (port 8080)  │  (settings API, proxy, MCP)
└─────────────┘
```

### Production Mode
OpenClaw replaces termos gateway as the entry point. Termos gateway becomes a headless orchestration service (no platform adapters, just worker management + settings API + proxy).

## OpenClaw Configuration Example

```yaml
# openclaw.yaml
channels:
  telegram:
    token: "${TELEGRAM_BOT_TOKEN}"
  discord:
    token: "${DISCORD_BOT_TOKEN}"

# No model configured — all execution delegated to termos workers
plugins:
  entries:
    termos:
      config:
        redisUrl: "${REDIS_URL}"
        deploymentMode: "docker"  # or "k8s"
        workerImage: "termos-worker:latest"
        publicGatewayUrl: "http://localhost:9090"
        networkProxy:
          allowedDomains: ["api.anthropic.com", "api.openai.com"]
```

## Key OpenClaw Files (for reference)

```
Plugin SDK:
  src/plugins/types.ts              — hook names, API interface, tool context
  src/plugins/loader.ts             — plugin discovery & loading
  src/plugins/registry.ts           — plugin registration & storage
  src/plugins/hooks.ts              — hook dispatch (runVoidHook, runModifyingHook)

Channel System:
  src/channels/plugins/types.plugin.ts — ChannelPlugin interface
  src/channels/dock.ts              — channel docking mechanism

Message Dispatch:
  src/auto-reply/dispatch.ts        — dispatchInboundMessage()
  src/auto-reply/reply/route-reply.ts — routeReply() for outbound delivery
  src/auto-reply/reply/agent-runner.ts — agent execution entry

Agent Execution:
  src/auto-reply/reply/agent-runner-execution.ts — runAgentTurnWithFallback()
  src/agents/cli-runner.ts          — CLI agent mode
  src/agents/pi-embedded-runner/    — embedded Pi agent mode

Remote Execution:
  src/acp/                          — Agent Client Protocol

Sandbox:
  src/agents/sandbox/               — Docker container isolation (56 files)

Extensions:
  extensions/telegram/              — Telegram channel plugin
  extensions/discord/               — Discord channel plugin
  extensions/slack/                 — Slack channel plugin
  extensions/whatsapp/              — WhatsApp channel plugin
```
