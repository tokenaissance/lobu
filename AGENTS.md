## Project Structure & Module Organization

### Package Architecture
- **`packages/core`**: Shared code between gateway and worker (interfaces, utils, types). Any code reused by both must live here.
- **`packages/gateway`**: Platform-agnostic gateway. Slack code under `src/slack/`. Future chat platforms (Discord, Teams) will live alongside as separate modules in dispatcher pattern.
- **`packages/worker`**: Claude-specific logic in `src/claude/`. Worker talks only to gateway and agent (Claude CLI). No Slack/platform knowledge.
- **`packages/orchestrator`**: Deployment engine only. Talks to compute (Docker/K8s) and Redis queues. No platform knowledge.

### Module Boundaries
- Gateway: Slack → `src/slack/`, future platforms → `src/dispatcher/{platform}/`
- Worker: Platform-agnostic, Claude logic isolated to `src/claude/`
- Core: Shared interfaces, utils, types for gateway+worker
- Orchestrator: Compute engine (Docker/K8s) + Redis only

### Repository Layout
- Monorepo managed by Bun workspaces: `packages/gateway`, `packages/orchestrator`, `packages/worker`, `packages/core`.
- Top-level: `Makefile`, `bin/` (CLI/setup), `docker-compose*.yml`, `charts/peerbot` (Helm), `workspaces/`, `.env*`.
- TypeScript sources under `packages/*/src`. Tests in `packages/*/src/__tests__` and `packages/core/tests`.
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

Worker deployments use persistent volumes for session continuity across scale-to-zero:

1. **Per-Deployment PVC**: Each worker deployment gets its own PersistentVolumeClaim (1 thread = 1 PVC) mounted at `/workspace`
2. **Session Storage**: Claude SDK sessions are stored in `/workspace/.claude/` (via `HOME=/workspace` environment variable)
3. **Auto-Resume**: When a worker scales back up, it automatically detects existing sessions in `/workspace/.claude/` and uses Claude CLI's `--continue` flag to resume
4. **Cleanup**: PVCs are automatically deleted when deployments are cleaned up after thread inactivity
5. **Docker Mode**: Uses host directory mounts at `./workspaces/{threadId}/` for equivalent persistence

## MCP OAuth Authentication

MCP (Model Context Protocol) servers can be authenticated via OAuth. Users authenticate through the Slack home tab.

### Configuration

1. **Set public gateway URL** (required for OAuth callbacks):
```bash
PUBLIC_GATEWAY_URL=https://your-domain.com
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

# Test thread continuity
./slack-qa-bot.js "2+3" --timeout 20 --json | jq -r '.thread_ts' | xargs -I {} ./slack-qa-bot.js "add 1 to that number, only answer the number" --thread-ts {} --timeout 25

# Comprehensive E2E testing
./slack-qa-bot.js
```
