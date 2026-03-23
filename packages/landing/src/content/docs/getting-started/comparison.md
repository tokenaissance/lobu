---
title: Comparison
description: How Lobu differs from OpenClaw and why we built a separate gateway.
---

See also: [Capabilities](/getting-started/capabilities/) and [Skills](/getting-started/skills/).

Lobu and OpenClaw are complementary, but they solve different layers of the problem.

- **OpenClaw** provides the agent runtime — the AI execution engine that runs tools, manages sessions, and talks to LLM providers.
- **Lobu** provides deployment, orchestration, isolation, and multi-platform delivery around that runtime.

## Why Not Just Use OpenClaw Directly?

OpenClaw is a powerful runtime (~800k lines of code), but it was designed as a **single-tenant, single-user system** — by design. The creator of OpenClaw, Peter Steinberger, has been explicit about this:

<blockquote class="twitter-tweet"><p lang="en" dir="ltr">Since I spend my night again sifting through security advisories, folks, security researches, slop clankers, PLEASE - read <a href="https://t.co/Y6PYY4zg5W">https://t.co/Y6PYY4zg5W</a> and <a href="https://t.co/FSsm4M4FSq">https://t.co/FSsm4M4FSq</a><br><br>The security model of OpenClaw is that it&#39;s your PERSONAL assistant (one user - 1...many agents).<br><br>IT IS…</p>&mdash; Peter Steinberger 🦞 (@steipete) <a href="https://twitter.com/steipete/status/2026092642623201379?ref_src=twsrc%5Etfw">February 24, 2026</a></blockquote>
<script async src="https://platform.twitter.com/widgets.js" charset="utf-8"></script>

OpenClaw assumes one user runs one agent on their own machine. That's great for local development, but production deployments need:

- **Multi-tenant isolation** — every user gets their own sandboxed worker, not a shared process.
- **Platform routing** — messages arrive from Slack, Telegram, WhatsApp, or REST API and need to reach the right worker.
- **Credential separation** — workers must never see real API keys. The gateway proxies all provider calls and injects credentials at the edge.
- **Network control** — workers run on an isolated internal network with no direct internet access. The gateway is the single egress point with domain-level allowlists.
- **Scale-to-zero** — idle workers shut down and wake on demand, so you only pay for active compute.

OpenClaw doesn't have opinions about any of this. Lobu does.

## What Lobu Built from Scratch

The Lobu gateway is an entirely separate codebase — not a fork or wrapper around OpenClaw's server. It handles:

1. **Platform adapters** — Slack (Events API + Socket Mode), Telegram (Grammy long-polling), WhatsApp (Cloud API webhooks), and a REST endpoint for programmatic access.
2. **Worker lifecycle** — spawning, routing, health checks, idle timeouts, persistent volumes, and cleanup.
3. **Auth & secrets** — device-code auth for MCP servers, provider key resolution by agent ID, and a settings UI per user. Third-party API auth is handled by Owletto.
4. **Proxy layer** — an HTTP proxy (port 8118) that enforces domain allowlists at the network layer. Workers send all outbound traffic through this proxy.
5. **Skills registry** — a curated catalog of MCP servers and LLM providers that workers can use, managed via `lobu.toml` and the settings page.

OpenClaw runs inside each worker as the agent execution engine. Everything outside the worker boundary is Lobu.

## How Lobu Uses OpenClaw Runtime

Inside each worker, Lobu runs OpenClaw sessions and tool execution.

1. Gateway receives user messages (Slack/Telegram/WhatsApp/API).
2. Gateway routes jobs to isolated worker instances.
3. Worker executes with OpenClaw using Lobu's tool policy and workspace model.
4. Gateway streams responses and manages auth/secrets. Integration OAuth is handled by Owletto.

## Lobu vs OpenClaw

| Capability | Lobu | OpenClaw |
|---|---|---|
| Runtime engine | Uses OpenClaw in workers | Native runtime |
| Architecture | Multi-tenant gateway + isolated workers | Single-tenant, single-user |
| Platform delivery | Slack, Telegram, WhatsApp, REST API | CLI and API |
| Worker isolation | Sandboxed containers, no direct internet | Runs on host |
| Secret handling | Gateway proxy injects credentials | Direct env vars |
| Egress control | Domain allowlists via HTTP proxy | Host network |
| Scale-to-zero | Built-in idle timeout and wake | Always running |
| Deployment | Docker Compose or Kubernetes | Single process |

## Why This Split Matters

Using Lobu with OpenClaw gives you:

- OpenClaw's agent runtime capabilities (tool use, sessions, LLM integration)
- Lobu's production concerns: isolation, routing, persistence, multi-tenant operations, and controlled network/auth boundaries

You get the full power of the OpenClaw runtime without having to build the infrastructure to run it safely for multiple users.
