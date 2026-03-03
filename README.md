# Lobu [![Talk to Founder](https://img.shields.io/badge/-Talk%20to%20Founder-red?style=flat-square&logo=google-calendar&logoColor=white)](https://calendar.app.google/LwAk3ecptkJQaYr87)

**Lobu** is a platform for deploying **persistent, autonomous agents**. It provides a unified gateway for programmatic agent creation and multi-platform access (Slack, Telegram, WhatsApp), backed by a hardened, sandboxed execution environment.

**Batteries included.** Lobu bundles sandboxed execution, MCP proxy with OAuth, and network isolation — no external sandbox providers, no third-party MCP gateways. One deployment, everything included.

## Messaging & API

**REST API** — Programmatic agent creation, control, and state management.

[![API Docs](https://img.shields.io/badge/API_Docs-0096FF?style=for-the-badge&logo=readme&logoColor=white)](https://community.lobu.ai/api/docs)

**Slack** — Multi-channel/DM agents with rich interactivity.

[![Add to Slack](https://img.shields.io/badge/Add_to_Slack-4A154B?style=for-the-badge&logo=slack&logoColor=white)](https://community.lobu.ai/slack/install) [![Join Community](https://img.shields.io/badge/Join_Community-4A154B?style=for-the-badge&logo=slack&logoColor=white)](https://join.slack.com/t/peerbot/shared_invite/zt-391o8tyw2-iyupjTG1xHIz9Og8C7JOnw)

**Telegram** — Personal AI assistants with long-polling.

[![Try @lobuaibot](https://img.shields.io/badge/Try_@lobuaibot-26A5E4?style=for-the-badge&logo=telegram&logoColor=white)](https://t.me/lobuaibot)

**WhatsApp** — Baileys-based integration with a unique self-chat mode.

## Quick Start

### Create a new bot

The recommended way to start is using our CLI. It scaffolds a project with everything you need.

```bash
npx create-lobu my-bot
cd my-bot && docker compose up -d
```

### Deployment modes

- **Docker Compose** — `docker compose up` (One-click, production single-machine)
- **Kubernetes** — Install via OCI Helm chart (no clone needed):

```bash
helm install lobu oci://ghcr.io/lobu-ai/charts/lobu \
  --namespace lobu \
  --create-namespace
```

- **Local Development** — For contributing to Lobu itself:
  1. Clone this repo
  2. `make setup`
  3. `make dev` (Uses Docker Compose Watch for hot-reloading)

## Architecture

```mermaid
flowchart LR
  Slack[Slack] <--> GW[Gateway]
  Telegram[Telegram] <--> GW
  WhatsApp[WhatsApp] <--> GW
  API[REST API] <--> GW

  GW <--> Redis[(Redis)]
  GW -->|spawn| W[Worker]

  subgraph Sandbox
    W
  end

  W -.->|HTTP proxy| GW
  W -.->|MCP proxy| GW
  GW -->|domain filter| Internet((Internet))
  GW -->|scoped tokens| MCP[MCP Servers]
```

## Capabilities

Every Lobu agent comes equipped with a suite of tools for autonomous execution and persistence:

| Feature | Description | Built-in Tools |
| :--- | :--- | :--- |
| **Autonomous Scheduling** | Schedule one-time or recurring execution via cron. | `ScheduleReminder`, `ListReminders`, `CancelReminder` |
| **Human-in-the-Loop** | Pause for user input via buttons and resume when answered. | `AskUserQuestion`, `GetSettingsLink` |
| **Full Linux Toolbox** | Sandboxed shell access, file editing, and advanced search. | `bash`, `read`, `write`, `edit`, `grep`, `find`, `ls` |
| **Conversation Context** | Pull earlier thread messages when the user references prior work. | `GetChannelHistory` |
| **File & Media Delivery** | Share reports, charts, or generated voice messages. | `UploadUserFile`, `GenerateAudio` |
| **Self-Expansion** | Search and dynamically install new skills or MCP servers. | `SearchSkills`, `InstallSkill` |
| **Connected APIs** | Authenticate and call OAuth/API-key backed services through gateway-managed credentials. | `ConnectService`, `CallService`, `DisconnectService` |
| **Managed MCP Proxy** | Securely connect to any MCP server with OAuth. | [MCP Proxy](docs/SECURITY.md#mcp-oauth-and-credentials) |
| **Advanced Capabilities** | Extend agent abilities with web browsing, headless UI interaction, and specialized utilities via Nix packages or external MCP servers. | `bash` (Nix), `SearchSkills`, `InstallSkill` (MCP) |

### Popular MCP Integrations
Lobu's gateway handles OAuth and secret injection for any MCP server, including:
- **Productivity:** Google Calendar, Slack, Jira, Notion
- **Development:** GitHub, GitLab, Postgres, Docker
- **Knowledge:** Wikipedia, Brave Search, YouTube, PDF Search

**Gateway as single egress.** All worker traffic — internet and MCP — routes through the gateway. Workers have no direct network access. Domain filtering controls which external services workers can reach.

**MCP Proxy.** Workers call MCP tools via the gateway. The gateway handles OAuth, injects scoped tokens, and resolves `${env:VAR}` secrets. Workers never see client secrets.

**Multi-platform, multi-tenant.** One bot instance serves Slack, Telegram, WhatsApp, and REST API. Each channel/DM gets its own isolated runtime, model, tools, credentials, and Nix packages.

**OpenClaw runtime.** Workers run [OpenClaw Pi Agent](https://openclaw.ai/), with per-agent model selection via the settings page. Supports OpenClaw skills, `IDENTITY.md`, `SOUL.md`, and `USER.md` workspace files.

**Multi-provider auth.** Claude (OAuth), ChatGPT (device-code flow), and API-key providers (Gemini, NVIDIA, etc.) via pluggable `ModelProviderModule`.

## How Lobu Differs

Lobu is the **infrastructure layer** for autonomous agents. Unlike frameworks (LangChain, CrewAI) that help you *write* agent logic, Lobu is the **delivery mechanism** that runs those agents at scale — handling the sandboxing, persistence, and messaging connectivity.

| | Lobu | OpenClaw |
|---|---|---|
| **Scale to zero** | Workers scale down when idle | Requires always-on computer |
| **Multi-tenant** | Single bot, per-channel/DM isolation | One instance per setup |
| **Multi-platform** | Slack, Telegram, WhatsApp, REST API | [15+ chat platforms](https://openclaw.ai/integrations) |
| **Runtime** | OpenClaw engine (sandboxed/proxied) | Native OpenClaw runtime |
| **User onboarding** | Configure page with OAuth login per provider | CLI setup required |
| **MCP access** | Proxied through gateway, secrets isolated | Direct from agent |
| **Network isolation** | Workers sandboxed, domain-filtered egress | No built-in isolation |
| **Deployment** | K8s, Docker | Single node |

## Security and Privacy

- [**No direct worker egress**](docs/SECURITY.md#network-egress) — all traffic routes through the gateway proxy.
- [**Secrets stay in gateway**](docs/SECURITY.md#mcp-oauth-and-credentials) — MCP OAuth, provider credentials, and `${env:}` substitution.
- [**Defense-in-depth on K8s**](docs/SECURITY.md#kubernetes) — NetworkPolicies, RBAC, and optional gVisor/Kata runtimes.
- [**Nix system packages**](docs/SECURITY.md#skills-and-policy) — per-agent reproducible tooling and skills policy enforcement.

## Support & Consultancy

Lobu is designed for high-stakes, persistent agents. While the platform is open-source, the true value of an agent lies in its **soul, identity, and integration**.

If you want to deploy agents for your organization but need expert implementation and infrastructure maintenance, I provide end-to-end support for:

*   **Employee AI Assistants** — Deploy persistent, sandboxed agents across Slack/Telegram that have access to your internal tools and documentation.
*   **Automated Customer Support** — Build agents that handle complex, multi-step support tickets autonomously while keeping a human in the loop.
*   **Autonomous Workflows** — Use Lobu to automate background tasks that require persistent state, long-running execution, and scheduled cron jobs.
*   **Infrastructure Maintenance** — Let me manage your private Lobu deployment on your own Kubernetes cluster, ensuring 99.9% uptime, security updates, and automated scaling.
*   **Custom Tooling & Skills** — I build specialized MCP servers, Nix-powered runtimes, and OpenClaw skills tailored to your business needs.

---

**Expert Implementation.** I'm a second-time technical founder. Previously, I founded [rakam.io](https://rakam.io), an enterprise analytics PaaS acquired by [LiveRamp](https://liveramp.com) (NYSE: RAMP). I help organizations move beyond chatbots by building the secure, scalable infrastructure required for production-grade autonomous agents.

> [!TIP]
> **Interested in launching persistent agents for your team or customers?** I'm happy to help you architect a reliable deployment for your specific use case. [🗓️ **Talk to Founder**](https://calendar.app.google/LwAk3ecptkJQaYr87) or [reach out on **X/Twitter**](https://x.com/bu7emba).
