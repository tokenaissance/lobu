# MCP OAuth Configuration Guide

This directory contains examples for configuring MCP (Model Context Protocol) servers with OAuth authentication in Peerbot.

## Overview

Peerbot supports multiple MCP authentication patterns:

1. **Automatic OAuth Discovery** - MCP server advertises OAuth endpoints (RFC 8414/9728)
2. **Dynamic Client Registration** - Automatic OAuth app creation (RFC 7591)
3. **Manual OAuth Configuration** - Pre-configured OAuth credentials
4. **Input-based Authentication** - User provides credentials via Slack modal
5. **Simple Login URLs** - Basic OAuth redirect links

## Configuration Patterns

### 1. Automatic OAuth Discovery (Recommended)

**Best for:** MCP servers that support OAuth metadata discovery (like Sentry)

The system automatically discovers OAuth endpoints and registers a client (if supported).

```json
{
  "mcpServers": {
    "sentry": {
      "url": "https://mcp.sentry.dev/mcp"
    }
  }
}
```

**How it works:**
- System probes `.well-known/oauth-authorization-server` (RFC 8414)
- Falls back to `WWW-Authenticate` header inspection (RFC 9728)
- If `registration_endpoint` exists, automatically registers OAuth client (RFC 7591)
- No manual setup required!

**Requirements:**
- MCP server must support OAuth discovery
- For full automation, server must support dynamic client registration

**Example servers:**
- Sentry MCP (`https://mcp.sentry.dev/mcp`)

---

### 2. Manual OAuth Configuration

**Best for:** Services requiring pre-created OAuth apps (like GitHub)

You manually create an OAuth app and provide the credentials.

```json
{
  "mcpServers": {
    "github": {
      "url": "https://api.githubcopilot.com/mcp/",
      "oauth": {
        "authUrl": "https://github.com/login/oauth/authorize",
        "tokenUrl": "https://github.com/login/oauth/access_token",
        "clientId": "YOUR_GITHUB_CLIENT_ID",
        "clientSecret": "${env:GITHUB_CLIENT_SECRET}",
        "scopes": ["repo", "read:user"],
        "grantType": "authorization_code",
        "responseType": "code"
      }
    }
  }
}
```

**Setup steps:**

1. **Create OAuth App:**
   - GitHub: https://github.com/settings/developers
   - Google: https://console.cloud.google.com/apis/credentials
   - Other providers: Check their developer documentation

2. **Configure callback URL:**
   ```
   http://your-domain.com/mcp/oauth/callback
   ```

   For local development:
   ```
   http://buraks-macbook-pro.brill-kanyu.ts.net:8080/mcp/oauth/callback
   ```

3. **Set environment variable:**
   ```bash
   # In your .env file
   GITHUB_CLIENT_SECRET=your_client_secret_here
   ```

4. **Add to docker-compose:**
   ```yaml
   environment:
     GITHUB_CLIENT_SECRET: ${GITHUB_CLIENT_SECRET}
   ```

**OAuth Configuration Fields:**

| Field | Required | Description |
|-------|----------|-------------|
| `authUrl` | Yes | OAuth authorization endpoint |
| `tokenUrl` | Yes | OAuth token exchange endpoint |
| `clientId` | Yes | Your OAuth app client ID |
| `clientSecret` | Yes | Your OAuth app client secret (use `${env:VAR}`) |
| `scopes` | No | OAuth scopes to request (default: `[]`) |
| `grantType` | No | OAuth grant type (default: `"authorization_code"`) |
| `responseType` | No | OAuth response type (default: `"code"`) |

---

### 3. Input-based Authentication

**Best for:** API keys, personal access tokens, or custom credentials

Users enter credentials via a Slack modal instead of OAuth flow.

```json
{
  "mcpServers": {
    "custom-api": {
      "url": "https://custom-api.example.com/mcp",
      "inputs": [
        {
          "type": "promptString",
          "id": "api_key",
          "description": "Your API Key"
        }
      ],
      "headers": {
        "Authorization": "Bearer ${input:api_key}"
      }
    }
  }
}
```

**How it works:**
- User clicks "Configure" button in Slack home tab
- Slack modal appears with input fields
- Credentials stored securely in Redis
- Gateway injects credentials when proxying MCP requests

**Input Configuration:**

| Field | Required | Description |
|-------|----------|-------------|
| `type` | Yes | Always `"promptString"` |
| `id` | Yes | Unique identifier for this input |
| `description` | Yes | User-visible label in Slack modal |

---

### 4. Simple Login URLs

**Best for:** Quick OAuth redirects without full configuration

Minimal setup - just provide a login URL.

```json
{
  "mcpServers": {
    "simple-oauth": {
      "url": "https://simple-mcp.example.com",
      "loginUrl": "https://simple-mcp.example.com/oauth/authorize?client_id=YOUR_CLIENT_ID&redirect_uri=http://your-domain.com/mcp/oauth/callback"
    }
  }
}
```

**Limitations:**
- No automatic token exchange
- No token refresh support
- Best for services with very simple OAuth flows

---

## Environment Variable Substitution

All string fields in MCP configuration support `${env:VAR_NAME}` syntax for environment variable substitution.

**Examples:**

```json
{
  "mcpServers": {
    "example": {
      "url": "${env:MCP_SERVER_URL}",
      "oauth": {
        "authUrl": "${env:OAUTH_AUTH_URL}",
        "tokenUrl": "${env:OAUTH_TOKEN_URL}",
        "clientId": "${env:OAUTH_CLIENT_ID}",
        "clientSecret": "${env:OAUTH_CLIENT_SECRET}"
      },
      "headers": {
        "X-API-Key": "${env:API_KEY}",
        "X-Custom-Header": "${env:CUSTOM_HEADER}"
      }
    }
  }
}
```

**Also supports input substitution:**

```json
{
  "headers": {
    "Authorization": "Bearer ${input:api_token}",
    "X-User-Id": "${input:user_id}"
  }
}
```

**Format:**
- Environment variables: `${env:VARIABLE_NAME}`
- User inputs: `${input:INPUT_ID}`

## OAuth Callback URL

All OAuth flows redirect back to the gateway's callback endpoint.

**Format:**
```
{PUBLIC_GATEWAY_URL}/mcp/oauth/callback
```

---

## Testing Your Configuration

1. **Restart the gateway:**
   ```bash
   make dev
   # or
   docker compose -f docker-compose.dev.yml restart gateway
   ```

2. **Check discovery logs:**
   ```bash
   docker compose -f docker-compose.dev.yml logs gateway | grep "Discovery"
   ```

   Expected output:
   ```
   ✅ Discovered OAuth for sentry: https://mcp.sentry.dev
   ✅ Successfully registered client for sentry
   ```

3. **Open Slack home tab:**
   - Should see MCP connection status
   - Click "Login" or "Configure" buttons
   - Test the authentication flow

4. **Verify credentials stored:**
   ```bash
   docker compose -f docker-compose.dev.yml exec redis redis-cli KEYS "mcp:credential:*"
   ```

---

## Troubleshooting

### "OAuth client not registered for this MCP"

**Cause:** MCP doesn't support automatic client registration.

**Solution:** Add manual OAuth configuration:
```json
{
  "oauth": {
    "clientId": "YOUR_CLIENT_ID",
    "clientSecret": "${env:CLIENT_SECRET}"
    // ... other OAuth fields
  }
}
```

### "Client secret could not be resolved"

**Cause:** Environment variable not set or incorrect syntax.

**Check:**
1. Verify `.env` file contains the variable:
   ```bash
   grep CLIENT_SECRET .env
   ```

2. Verify docker-compose passes it:
   ```yaml
   environment:
     MY_CLIENT_SECRET: ${MY_CLIENT_SECRET}
   ```

3. Use correct syntax in config:
   ```json
   "clientSecret": "${env:MY_CLIENT_SECRET}"
   ```

### "Invalid or expired token"

**Cause:** OAuth state token expired (5 minute TTL).

**Solution:** Click the login button again to generate a new token.

### Discovery finds nothing

**Cause:** MCP server doesn't support OAuth discovery.

**Solution:** Use manual OAuth configuration or input-based authentication.

---

## Security Best Practices

1. **Never commit secrets:**
   ```bash
   # .gitignore should contain:
   .env
   .env.local
   *.secret
   ```

2. **Use environment variables:**
   ```json
   ✅ "clientSecret": "${env:CLIENT_SECRET}"
   ❌ "clientSecret": "actual_secret_here"
   ```

3. **Rotate credentials regularly:**
   - Especially for production environments
   - Update both OAuth app and environment variables

4. **Use HTTPS in production:**
   ```bash
   PUBLIC_GATEWAY_URL=https://your-domain.com
   ```

5. **Limit OAuth scopes:**
   ```json
   "scopes": ["read:user"]  // Only request what you need
   ```

---

## Additional Resources

- **RFC 8414:** OAuth 2.0 Authorization Server Metadata
- **RFC 7591:** OAuth 2.0 Dynamic Client Registration Protocol
- **RFC 9728:** OAuth 2.0 Protected Resource Metadata
- **MCP Specification:** https://spec.modelcontextprotocol.io/