# Lobu

![License: BUSL-1.1](https://img.shields.io/badge/license-BUSL--1.1-blue)

<a href="https://community.lobu.ai/slack/install"><img alt="Add to Slack" height="40" width="139" src="https://platform.slack-edge.com/img/add_to_slack.png" srcSet="https://platform.slack-edge.com/img/add_to_slack.png 1x, https://platform.slack-edge.com/img/add_to_slack@2x.png 2x" /></a>

Multi-tenant, sandboxed agent orchestration. Run Claude Code or OpenClaw behind a hardened gateway with MCP proxy, multi-provider auth, and per-context isolation.

**Batteries included.** Lobu bundles sandboxed execution, MCP proxy with OAuth, and network isolation — no external sandbox providers, no third-party MCP gateways. One deployment, everything included.

## Interfaces

**REST API** — Programmatic agent creation. [API Docs](https://community.lobu.ai/api/docs)

**Slack** — Multi-channel/DM agents. [Add to Slack](https://community.lobu.ai/slack/install) · [Join community Slack](https://join.slack.com/t/peerbot/shared_invite/zt-391o8tyw2-iyupjTG1xHIz9Og8C7JOnw)

**Telegram** — Personal AI assistants. [Try @lobuaibot](https://t.me/lobuaibot)

**WhatsApp** — Baileys-based integration with self-chat mode for testing.

## Quick Start

### New project (recommended)

```bash
npx create-lobu my-bot
cd my-bot && docker compose up -d
```

The wizard guides you through platform setup (Telegram, Slack, or API-only), credentials, MCP servers, and network configuration.

### Monorepo development

```bash
cp .env.example .env    # configure platform credentials
make setup && make dev
```

### Deployment modes

- **Docker Compose** — `docker compose up` (production single-machine)
- **Kubernetes** — `helm upgrade --install lobu charts/lobu/ -f charts/lobu/values.yaml` (production cluster)
- **Local** — `cd packages/gateway && bun run dev` (development, workers as child processes)

## Architecture

```mermaid
flowchart LR
  Slack[Slack] --> GW[Gateway]
  Telegram[Telegram] --> GW
  WhatsApp[WhatsApp] --> GW
  API[REST API] --> GW

  GW <--> Redis[(Redis)]
  GW -->|orchestrate| Orch[Orchestrator]
  Orch -->|spawn| W[Worker: Claude SDK or OpenClaw]

  subgraph Isolation Boundary
    W
  end

  W -.->|HTTP proxy| GW
  GW -->|domain filter| Internet((Internet))

  W -.->|MCP proxy| GW
  GW -->|scoped tokens| MCP[MCP Servers]
```

### Key Concepts

**Gateway as single egress.** All worker traffic — internet and MCP — routes through the gateway. Workers have no direct network access.

**MCP Proxy.** Workers call MCP tools via gateway REST endpoints (`GET /mcp/tools`, `POST /mcp/:mcpId/tools/:toolName`). The gateway handles OAuth, injects scoped tokens. Workers never see client secrets.

```json
{
  "mcpServers": {
    "github": {
      "url": "https://github-mcp.example.com",
      "oauth": {
        "clientId": "YOUR_CLIENT_ID",
        "clientSecret": "${env:GITHUB_CLIENT_SECRET}",
        "scopes": ["repo", "read:user"]
      }
    }
  }
}
```

`${env:VAR}` is resolved at the gateway — workers never see the secret.

**Multi-platform, multi-tenant.** One bot instance serves Slack, Telegram, WhatsApp, and REST API. Each channel/DM gets its own runtime, model, tools, credentials, and Nix environment.

**Dual runtime.** Workers run Claude Code SDK (CLI subprocess) or OpenClaw Pi Agent SDK (embedded npm package), selected per-agent via the `runtime` field or model prefix.

**OpenClaw compatible.** Lobu supports OpenClaw skills, `IDENTITY.md`, `SOUL.md`, and `USER.md` workspace files — the same personality and behavior system that makes OpenClaw agents powerful. Skills from [ClawhHub](https://clawhub.ai/) are fetched from GitHub, cached, and injected as progressive-disclosure instructions.

**Multi-provider auth.** Claude (OAuth), ChatGPT (device-code flow), and API-key providers (Gemini, NVIDIA, etc.) via pluggable `ModelProviderModule`.

**Built-in tools.** `AskUserQuestion`, `UploadUserFile`, `ScheduleReminder`, `GetChannelHistory`, `GenerateAudio` (TTS).

**Network domain filtering:**

```bash
# Workers can only reach these domains
WORKER_ALLOWED_DOMAINS=github.com,.github.com,registry.npmjs.org
```

## How Lobu Differs

This project started in **July 2025** and was first published under [peerbot.ai](https://peerbot.ai), initially focused on Claude Code. After OpenClaw was released, I added its runtime support so all OpenClaw skills can be used — but Lobu has its own gateway system that replaces the OpenClaw gateway.

| | Lobu | OpenClaw |
|---|---|---|
| **Scale to zero** | Workers scale down when idle | Requires always-on computer |
| **Multi-tenant** | Single bot, per-channel/DM isolation | One instance per setup |
| **Multi-platform** | Slack, Telegram, WhatsApp, REST API | [15+ chat platforms](https://openclaw.ai/integrations) |
| **Runtimes** | Claude SDK + OpenClaw Pi Agent | OpenClaw only |
| **User onboarding** | Configure page with OAuth login per provider | CLI setup required |
| **MCP access** | Proxied through gateway, secrets isolated | Direct from agent |
| **Network isolation** | Workers sandboxed, domain-filtered egress | No built-in isolation |
| **Deployment** | K8s, Docker, Local (sandbox runtime) | Single node |

## Security and Privacy

- **No direct worker egress** — all traffic through gateway proxy ([details](SECURITY.md#network-egress))
- **Secrets stay in gateway** — MCP OAuth, provider creds, `${env:}` substitution ([details](SECURITY.md#mcp-oauth-and-credentials))
- **Defense-in-depth on K8s** — NetworkPolicies, RBAC, gVisor/Kata ([details](SECURITY.md#kubernetes))
- **Nix environments** — reproducible per-session tooling ([details](SECURITY.md#nix-environments))
- **Skills policy enforcement** ([details](SECURITY.md#skills-and-policy))

## License

Business Source License 1.1 (`BUSL-1.1`). See [LICENSE](LICENSE).

---

Follow along: https://x.com/bu7emba
