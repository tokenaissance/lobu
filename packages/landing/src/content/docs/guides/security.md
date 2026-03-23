---
title: Security
description: Core security model, secrets handling, and MCP proxy behavior.
---

Lobu is designed so agent execution is isolated while sensitive auth and network control stay centralized.

## Security Model

- Worker execution is isolated per conversation/session.
- Gateway is the control plane for routing, auth, and policy.
- Outbound traffic is policy-controlled through the gateway proxy.

For deeper details, see the repository security document: [docs/SECURITY.md](https://github.com/lobu-ai/lobu/blob/main/docs/SECURITY.md).

## Secrets

- Provider credentials are managed on the gateway side. Integration auth (GitHub, Google, etc.) is handled by Owletto.
- Workers should not depend on long-lived raw credentials in their runtime context.
- Device-code auth flows and settings links are used to collect/refresh auth safely.

## MCP Proxy

- Workers access MCP capabilities through gateway-managed MCP config/proxy paths.
- Per-user credentials are resolved via the device-auth flow and injected by the gateway proxy.
- This keeps tool access extensible without exposing global secrets directly to workers.

## Permissions Section

Permissions are managed as domain-level policies (for example `Always`, `Session`, or time-limited access):

![Permissions section from homepage demo](/images/docs/security-permissions-section.png)
