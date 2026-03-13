---
title: MCP Proxy
description: How the gateway proxies MCP requests and handles OAuth for integrations and MCP servers.
---

Workers never hold real credentials. The gateway resolves them at request time and proxies every outbound MCP and integration call.

## Request flow

Every MCP URL a worker receives points back to the gateway with an `X-Mcp-Id` header identifying the upstream server.

1. Worker sends a JSON-RPC request to the gateway proxy.
2. Gateway authenticates the worker JWT, extracts `agentId` / `userId`.
3. Looks up credentials for that user — auto-refreshes expired tokens.
4. Injects the `Authorization` header, forwards to the upstream MCP.
5. Response flows back to the worker.

Workers call `tools/list` and `tools/call` — credential handling is invisible.

## Configuration sources

MCP servers come from two sources, merged per agent:

1. **Skills registry** (`config/system-skills.json`) — global MCPs available to every agent.
2. **Per-agent settings** — MCPs added through the settings page or agent-driven install.

Global MCPs take precedence when IDs collide.

## OAuth for MCP servers

1. User clicks "Login" for an unauthenticated MCP.
2. Gateway redirects to the OAuth provider.
3. User grants permissions, provider redirects to `/api/v1/auth/mcp/callback`.
4. Gateway exchanges the code for tokens, stores them in Redis keyed by `(agentId, mcpId)`.
5. Future proxy requests inject the token automatically.

If an MCP has no static OAuth config, the gateway tries RFC 8414 discovery (`/.well-known/oauth-authorization-server`) and RFC 7591 dynamic client registration.

## OAuth integrations

Integrations (Google, GitHub, Microsoft 365, etc.) use the same proxy pattern with extras:

- **Incremental auth** — only requests new scopes, preserves existing grants.
- **Multi-account** — users can connect multiple accounts per integration.
- **Thread resumption** — after auth completes, the gateway notifies the agent's thread so it can retry.

### How the agent triggers auth

1. Worker calls the gateway's internal integration endpoint.
2. If credentials exist, gateway injects them and proxies the request.
3. If not, returns an auth-required response — agent sends the user a connect button.
4. After OAuth, agent is notified and retries.

### Scopes

Each integration declares `default` and `available` scopes in `system-skills.json`. Agents request from the `available` list; the settings page shows users exactly what's being requested.

## Agent-driven installation

Agents can add MCPs at runtime:

1. Agent calls `SearchSkills` / `InstallSkill` (with a capability `id`).
2. Gateway generates a prefilled settings link.
3. User reviews and approves — MCP is active immediately.

## Configuration reference

### Adding an MCP to the skills registry

```json
{
  "id": "my-mcp",
  "name": "My MCP Server",
  "description": "What this MCP does",
  "mcpServers": [
    {
      "id": "my-mcp",
      "name": "My MCP",
      "url": "https://mcp.example.com",
      "type": "sse"
    }
  ]
}
```

With OAuth:

```json
{
  "id": "my-mcp",
  "name": "My MCP",
  "url": "https://mcp.example.com",
  "type": "sse",
  "oauth": {
    "authUrl": "https://provider.com/oauth/authorize",
    "tokenUrl": "https://provider.com/oauth/token",
    "clientId": "YOUR_CLIENT_ID",
    "clientSecret": "${env:MY_CLIENT_SECRET}",
    "scopes": ["read", "write"]
  }
}
```

Client secrets support `${env:VAR_NAME}` substitution so secrets stay in environment variables.

### Environment variables

| Variable | Purpose |
|----------|---------|
| `PUBLIC_GATEWAY_URL` | Public URL for OAuth callbacks |
| `*_CLIENT_ID` / `*_CLIENT_SECRET` | Per-provider OAuth credentials via `${env:...}` |

OAuth callback URL: `${PUBLIC_GATEWAY_URL}/api/v1/auth/mcp/callback`.
