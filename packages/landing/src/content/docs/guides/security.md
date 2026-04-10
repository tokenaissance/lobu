---
title: Security
description: Isolation, network policy, credentials, and MCP proxy behavior.
---

Lobu is built so a compromised worker session cannot leak secrets or reach arbitrary networks. Secrets and outbound policy live on the gateway; workers run sandboxed with no ambient trust.

## Core Model

- **Per-session workers** — each conversation runs in its own sandboxed worker (pod in Kubernetes, container in Docker). Workspaces and state do not cross sessions.
- **Gateway is the control plane** — all outbound HTTP, credential resolution, tool policy, and MCP calls route through it.
- **Workers never see real secrets** — provider credentials are replaced with opaque placeholder tokens; the gateway's secret proxy swaps them back before forwarding to upstream APIs.

## Network Isolation

Workers have no direct route to the internet.

- **Docker**: two networks — `lobu-public` (gateway ingress) and `lobu-internal` (worker ↔ gateway only). The internal network is marked `internal: true`, so no egress route exists at the Docker layer.
- **Kubernetes**: `NetworkPolicies` restrict worker egress to the gateway. Optional runtime hardening via **gVisor**, **Kata Containers**, or **Firecracker** microVMs when the cluster supports it.

All worker outbound HTTP goes through the gateway's HTTP proxy on port **8118** (`HTTP_PROXY=http://gateway:8118`). Domain access is controlled by env vars:

| Variable | Behavior |
|---|---|
| `WORKER_ALLOWED_DOMAINS` | unset/empty → no access (default). `*` → unrestricted. Otherwise a comma-separated allowlist. |
| `WORKER_DISALLOWED_DOMAINS` | Blocklist, applied when `WORKER_ALLOWED_DOMAINS=*`. |

Domain format: exact (`api.example.com`) or wildcard (`.example.com` matches all subdomains).

## Credentials

- **Provider credentials** (Anthropic, OpenAI, Bedrock, …) are stored on the gateway. Workers receive opaque placeholder tokens; the gateway secret proxy swaps them into real values only for outbound requests. A compromised worker cannot exfiltrate the underlying credential.
- **Integration auth** (GitHub, Google, Linear, …) is handled by [Owletto](https://github.com/lobu-ai/owletto). Workers call these APIs through Owletto MCP tools and never touch OAuth tokens directly.
- **Per-user MCP credentials** are collected via the device-auth flow and injected by the gateway MCP proxy per call.

## MCP Proxy

- Workers discover MCP tools through the gateway and call them with their own JWT token scoped to the agent.
- The proxy enforces **SSRF protection**: upstream MCP URLs that resolve to internal or private IP ranges are blocked.
- **Destructive tool approval**: per the MCP spec, tools without `readOnlyHint: true` or `destructiveHint: false` require user approval in-thread (`Allow once / 1h / 24h / Always / Deny`). The user's choice is recorded in the grant store.
- **Operator override**: `[agents.<id>.tools]` in `lobu.toml` accepts a `pre_approved` list of grant patterns (e.g. `/mcp/gmail/tools/list_messages`, `/mcp/linear/tools/*`) that bypass the approval card. This is operator-only — skills cannot set it — so the escape hatch is always visible in code review. See [Tool Policy](/guides/tool-policy/) and the [`lobu.toml` reference](/reference/lobu-toml/).

## Further Reading

See [docs/SECURITY.md](https://github.com/lobu-ai/lobu/blob/main/docs/SECURITY.md) for the detailed threat model and per-runtime controls.
