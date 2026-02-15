# Architecture

Lobu is a multi-tenant, sandbox-first architecture for running agent runtimes (OpenClaw runtime, Claude Code CLI) behind a hardened gateway.

## Components

### Gateway

Responsibilities:
- Ingest Slack events (and other platform events).
- Resolve the correct agent context for a message (channel/DM/thread to an `agentId`/configuration).
- Enforce policy (tool allow/deny, network allowlist, runtime selection).
- Orchestrate workers (Docker or Kubernetes).
- Provide the HTTP proxy used for worker egress filtering.
- Broker MCP OAuth flows and credential storage.

### Orchestrator

Deployment-mode specific worker lifecycle manager:
- **Docker Compose mode**: uses Docker to create per-session worker containers.
- **Kubernetes mode**: creates per-session worker pods + PVCs and cleans them up on inactivity.

### Workers

Per-session sandboxes that run the selected runtime:
- **OpenClaw runtime** (embedded runtime for tools/sessions/skills)
- **Claude Code CLI** (subscription-friendly runtime via OAuth)

Workers:
- are not exposed publicly
- do not make direct outbound network requests (egress goes through the gateway proxy)
- write all state into their isolated workspace

## Multi-Tenancy Model

Multi-tenant in Lobu means there is no "single bot computer" that everyone implicitly shares.

Each context (channel, DM, thread) can have:
- its own runtime/model
- its own skill set
- its own environment (Nix flake or package list)
- its own credentials (scoped and managed through the gateway)

This enables teams to run the same gateway instance with safe separation between environments.

## Nix Environments

Workers support Nix as a reproducible environment mechanism. Typical patterns:
- Provide a Nix flake URL for a devShell.
- Provide a list of Nix packages to install.
- Detect `flake.nix`, `shell.nix`, or `.nix-packages` in a workspace repo.

The goal is to avoid baking every tool into worker images while still keeping environments repeatable.

## Skills

Skills are a structured way to extend an agent's behavior/tooling.

In Lobu, skills are treated as first-class configuration:
- the gateway fetches curated skill options
- workers receive the skill instructions/assets inside the session workspace
- security policy still applies (tools and network)

## Data Flow (Slack)

High level:
1. Slack event arrives at the gateway.
2. Gateway resolves context (tenant/session) and queues the work.
3. Orchestrator ensures a worker exists for the session (create/resume).
4. Worker runs the selected runtime and streams results back.
5. Gateway posts responses back to Slack.
