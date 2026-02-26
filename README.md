# Lobu

![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue)

**Lobu** is a platform for deploying **persistent, autonomous agents**. It provides a unified gateway for programmatic agent creation and multi-platform access (Slack, Telegram, WhatsApp), backed by a hardened, sandboxed execution environment.

**Batteries included.** Lobu bundles sandboxed execution, MCP proxy with OAuth, and network isolation — no external sandbox providers, no third-party MCP gateways. One deployment, everything included.

---

> [!TIP]
> **Launch your agents with the Lobu team.** Whether you're looking to automate support, empower your employees with persistent AI, or need enterprise-grade infrastructure maintenance, we can help. [🗓️ **Book an Agent Strategy Call**](https://calendar.app.google/LwAk3ecptkJQaYr87)

---

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

## Built-in Agent Tools

Every Lobu agent comes equipped with a suite of tools for autonomous execution and persistence:

*   **Autonomous Scheduling** — Agents can schedule themselves for one-time or recurring execution via **cron expressions** (`ScheduleReminder`).
*   **Human-in-the-Loop** — Pause execution to ask the user a question with button options (`AskUserQuestion`) and resume when they respond.
*   **Full Linux Toolbox** — Sandboxed `bash` access, atomic file editing (`read`/`write`/`edit`), and advanced searching (`grep`/`find`).
*   **File & Media Delivery** — Generate and share charts, reports, or documents (`UploadUserFile`) and voice messages (`GenerateAudio`).
*   **Self-Expansion** — Search for and dynamically install new capabilities, skills, and MCP servers (`SearchExtensions`, `InstallExtension`).
*   **Managed MCP Proxy** — Securely connect to any [Model Context Protocol](https://modelcontextprotocol.io) server with gateway-level OAuth and secret injection.

### Key Concepts

**Gateway as single egress.** All worker traffic — internet and MCP — routes through the gateway. Workers have no direct network access. Domain filtering controls which external services workers can reach.

**MCP Proxy.** Workers call MCP tools via the gateway. The gateway handles OAuth, injects scoped tokens, and resolves `${env:VAR}` secrets. Workers never see client secrets.

**Multi-platform, multi-tenant.** One bot instance serves Slack, Telegram, WhatsApp, and REST API. Each channel/DM gets its own isolated runtime, model, tools, credentials, and Nix packages.

**OpenClaw runtime.** Workers run [OpenClaw Pi Agent](https://openclaw.ai/), with per-agent model selection via the settings page. Supports OpenClaw skills, `IDENTITY.md`, `SOUL.md`, and `USER.md` workspace files.

**Multi-provider auth.** Claude (OAuth), ChatGPT (device-code flow), and API-key providers (Gemini, NVIDIA, etc.) via pluggable `ModelProviderModule`.

## Enterprise & Implementation

Lobu is designed for high-stakes, persistent agents. While the platform is open-source, the true value of an agent lies in its **soul, identity, and integration**.

If you want to deploy agents for your organization but need expert implementation and infrastructure maintenance, we provide end-to-end support for:

*   **Employee AI Assistants** — Deploy persistent, sandboxed agents across Slack/Telegram that have access to your internal tools and documentation.
*   **Automated Customer Support** — Build agents that handle complex, multi-step support tickets autonomously while keeping a human in the loop.
*   **Autonomous Workflows** — Use Lobu to automate background tasks that require persistent state, long-running execution, and scheduled cron jobs.
*   **Infrastructure Maintenance** — Let us manage your private Lobu deployment on your own Kubernetes cluster, ensuring 99.9% uptime, security updates, and automated scaling.
*   **Custom Tooling & Skills** — We build specialized MCP servers, Nix-powered runtimes, and OpenClaw skills tailored to your business needs.

> [!TIP]
> **Need help architecting your agent workforce?** [🗓️ **Book a Strategy Call**](https://calendar.app.google/LwAk3ecptkJQaYr87)

## How Lobu Differs

This project started in **July 2025** and was first published under [peerbot.ai](https://peerbot.ai). After OpenClaw was released, I added its runtime as the primary agent runtime — Lobu has its own gateway system that replaces the OpenClaw gateway.

| | Lobu | OpenClaw |
|---|---|---|
| **Scale to zero** | Workers scale down when idle | Requires always-on computer |
| **Multi-tenant** | Single bot, per-channel/DM isolation | One instance per setup |
| **Multi-platform** | Slack, Telegram, WhatsApp, REST API | [15+ chat platforms](https://openclaw.ai/integrations) |
| **Runtime** | OpenClaw Pi Agent via gateway | OpenClaw standalone |
| **User onboarding** | Configure page with OAuth login per provider | CLI setup required |
| **MCP access** | Proxied through gateway, secrets isolated | Direct from agent |
| **Network isolation** | Workers sandboxed, domain-filtered egress | No built-in isolation |
| **Deployment** | K8s, Docker | Single node |

## Security and Privacy

- **No direct worker egress** — all traffic through gateway proxy ([details](docs/SECURITY.md#network-egress))
- **Secrets stay in gateway** — MCP OAuth, provider creds, `${env:}` substitution ([details](docs/SECURITY.md#mcp-oauth-and-credentials))
- **Defense-in-depth on K8s** — NetworkPolicies, RBAC, optional gVisor/Kata runtimes ([details](docs/SECURITY.md#kubernetes))
- **Nix system packages** — per-agent reproducible tooling via settings page ([details](docs/SECURITY.md#skills-and-policy))
- **Skills policy enforcement** ([details](docs/SECURITY.md#skills-and-policy))

## License

Business Source License 1.1 (`BUSL-1.1`). See [LICENSE](LICENSE).

---

Follow along: https://x.com/bu7emba
