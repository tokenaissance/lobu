## Project Structure & Module Organization
- Monorepo managed by Bun workspaces: `packages/gateway`, `packages/orchestrator`, `packages/worker`, `packages/shared`.
- Top-level tooling and ops: `Makefile`, `bin/` (CLI and setup scripts), `docker-compose*.yml`, `charts/peerbot` (Helm), `workspaces/` (local volumes), `.env*`.
- TypeScript sources under `packages/*/src`. Tests live in `packages/*/src/__tests__` and `packages/shared/tests`.
- **ALWAYS prefer `bun` commands over `npm`**
- When fixing unused parameter errors, remove the parameter entirely if possible rather than prefixing with underscore
- Worker prompt delivery: Claude CLI reads prompts from stdin via direct pipe from prompt file (no named pipes used)

## Instructions
- You MUST only do what has been asked; nothing more, nothing less.
- When you are in planning mode and you're not fully sure, you need to ask 'codex exec "YOUR_QUESTION" --config model_reasoning_effort="high"'
- For comprehensive QA and E2E testing, see `.claude/commands/qa.md` for detailed testing procedures and examples.
- When you make changes to worker code (`packages/worker/*`), run `make clean-workers` to ensure new workers use the updated code.
- Anytime you make changes in the code, you MUST:

1. Have the bot running via `make dev` running in the background for development. This uses Docker Compose with hot reload enabled when NODE_ENV=development.
2. Run ./slack-qa-bot.js "Relevant prompt" --timeout [based on complexity change by default 10] and make sure it works properly. If the script fails (including getting stuck at "Starting environment setup"), you MUST fix it.
3. Check logs using `docker compose logs` or `make logs` to verify the bot works properly.

- If you create ephemeral files, you MUST delete them when you're done with them.
- Use Docker to build and run the Slack bot in development mode, K8S for production.
- NEVER create files unless they're absolutely necessary for achieving your goal. Instead try to run the code on the fly for testing reasons.
- NEVER proactively create documentation files (\*.md) or README files. Only create documentation files if explicitly requested by the User. If you need to remember something, add it to CLAUDE.md as a a single sentence.
- ALWAYS ignore `/dist/` directories when analyzing code - these contain compiled artifacts, not source
- If you're referencing Slack threads or users in your response, add their direct links as well.

## Development Mode

- **Docker Compose**: Run `make dev` to start all services with hot reload enabled (uses docker-compose.dev.yml)
- **Logs**: View logs with `make logs` or `docker compose -f docker-compose.dev.yml logs -f [service]`
- **Hot Reload**: Source code changes are automatically detected when NODE_ENV=development
  - **Gateway**: Source files are mounted as volumes and Bun runs with `--watch` flag
    - Changes to `packages/gateway/src/`, `packages/core/src/`, or `packages/github/src/` trigger immediate restart
    - Built dependencies (`packages/core/dist/`, `packages/github/dist/`) are also mounted
    - Just save the file and watch logs for "Restarting..." message
  - **Worker**: Worker image is rebuilt automatically in Docker mode (no rebuild needed for code changes)
  - If hot reload isn't working, verify you're using `make dev` not `docker compose up`

## Deployment Instructions

When making changes to the Slack bot:
1. **Development**: Use `make dev` to start the server if it's not running. Use docker compose (for docker mode) or kubectl (for kubernetes mode) to pull the logs.
2. **Kubernetes deployment**: Use `make deploy` for production deployment

## Development Configuration

- Rate limiting is disabled in local development
- Worker image is built automatically when running `make dev`

## Socket Mode Health Monitoring

Gateway automatically detects zombie Socket Mode connections and triggers restart:
- Monitors Socket Mode WebSocket event activity (not message activity)
- Default: triggers restart if no events for 15 minutes (Socket Mode normally sends heartbeats every 30-60s)
- Protects active workers by default - waits for them to finish before restarting
- Gateway exits with code 0 → Docker/K8s automatically restarts the container
- Workers automatically reconnect when gateway comes back online
- Configure via env vars: `SOCKET_HEALTH_CHECK_INTERVAL_MS`, `SOCKET_STALE_THRESHOLD_MS`, `SOCKET_PROTECT_ACTIVE_WORKERS`

## Persistent Storage

Worker pods now use persistent volumes for data storage:

1. **Persistent Volumes**: Each worker pod mounts a persistent volume at `/workspace` to preserve data across pod restarts
2. **Auto-Resume**: The worker automatically resumes conversations using Claude CLI's built-in `--resume` functionality when continuing a thread in the same persistent volume
3. **Data Persistence**: All workspace data is preserved in the persistent volume, eliminating the need for conversation file syncing

## MCP OAuth Authentication

MCP (Model Context Protocol) servers can be authenticated via OAuth. Users authenticate through the Slack home tab.

### Configuration

1. **Set public gateway URL** (required for OAuth callbacks):
```bash
# For Tailscale users:
PEERBOT_PUBLIC_GATEWAY_URL=https://buraks-macbook-pro.brill-kanyu.ts.net

# For other deployments:
PEERBOT_PUBLIC_GATEWAY_URL=https://your-domain.com
```

2. **Configure OAuth callback URL** in your OAuth provider:
```
https://buraks-macbook-pro.brill-kanyu.ts.net/mcp/oauth/callback
```

3. **Configure MCP servers** with OAuth (two options):

**Option A: Full OAuth2 Configuration (Recommended)**
```json
{
  "mcpServers": {
    "github": {
      "url": "https://github-mcp.example.com",
      "oauth": {
        "authUrl": "https://github.com/login/oauth/authorize",
        "tokenUrl": "https://github.com/login/oauth/access_token",
        "clientId": "YOUR_GITHUB_CLIENT_ID",
        "clientSecret": "${env:GITHUB_CLIENT_SECRET}",
        "scopes": ["repo", "read:user"],
        "grantType": "authorization_code",
        "responseType": "code"
      }
    },
    "google": {
      "url": "https://google-mcp.example.com",
      "oauth": {
        "authUrl": "https://accounts.google.com/o/oauth2/v2/auth",
        "tokenUrl": "https://oauth2.googleapis.com/token",
        "clientId": "YOUR_GOOGLE_CLIENT_ID",
        "clientSecret": "${env:GOOGLE_CLIENT_SECRET}",
        "scopes": ["https://www.googleapis.com/auth/userinfo.profile"]
      }
    }
  }
}

**Option B: Simple Login URL (Basic)**
```json
{
  "mcpServers": {
    "custom": {
      "url": "https://custom-mcp.example.com",
      "loginUrl": "https://custom-mcp.example.com/oauth/authorize?client_id=YOUR_CLIENT_ID"
    }
  }
}
```

4. **Set client secrets in environment variables**:
```bash
export GITHUB_CLIENT_SECRET=your_github_client_secret
export GOOGLE_CLIENT_SECRET=your_google_client_secret
```

### User Authentication Flow

1. User opens Slack app home tab
2. Sees "Login" button for unauthenticated MCPs
3. Clicks "Login" → receives DM with OAuth link
4. Completes OAuth on MCP provider's site
5. Redirected back to callback → credentials stored
6. Home tab updates to show "Connected" with logout button

### Credential Storage

- Stored in Redis: `mcp:credential:{userId}:{mcpId}`
- Contains: accessToken, tokenType, expiresAt, refreshToken, metadata
- OAuth state stored temporarily (5 min TTL) for CSRF protection

### Edge Cases

**Active conversations when user logs out:**
- Worker receives 401 from MCP proxy
- Shows message: "Authentication required. Visit Home tab to reconnect."
- Worker continues running - user can still use non-MCP features

**Token expiration during conversation:**
- MCP proxy checks expiry before proxying
- Attempts automatic refresh if refreshToken exists
- If refresh fails, shows reauthentication message

## Testing with slack-qa-bot.js

**See `.claude/commands/qa.md` for comprehensive testing documentation with examples.**

Basic usage:

```bash
# Simple test
./slack-qa-bot.js "Hello bot"

# JSON output for automation
./slack-qa-bot.js --json "Create a function" | jq -r .thread_ts

# Comprehensive E2E testing
./slack-qa-bot.js
```
