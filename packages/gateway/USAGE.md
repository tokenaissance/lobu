# Gateway Environment Variables

This document describes all environment variables used by the Peerbot Gateway.

## Required Variables

### `QUEUE_URL`
**Description**: Redis connection string for job queues
**Format**: `redis://host:port/db`
**Example**: `redis://redis:6379/0`
**Used by**: Queue management, worker orchestration

### `SLACK_BOT_TOKEN`
**Description**: Slack Bot User OAuth Token
**Format**: Starts with `xoxb-`
**Example**: `xoxb-123456789-abcdefghijk`
**Used by**: Slack API authentication

## Authentication Variables

### `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN`
**Description**: Anthropic API key for Claude (system-wide fallback). Users can alternatively authenticate via OAuth in Slack home tab.
**Format**: Starts with `sk-ant-`
**Example**: `sk-ant-api03-xxx`
**Used by**: Claude API calls
**Note**: Optional if users authenticate via OAuth

### `ENCRYPTION_KEY`
**Description**: 32-byte base64-encoded key for encrypting sensitive credentials
**Format**: Base64-encoded string
**Example**: Generate with `openssl rand -base64 32`
**Used by**: MCP OAuth credential storage, user environment variables

## Slack Configuration

### `SLACK_APP_TOKEN`
**Description**: Slack App-Level Token for Socket Mode
**Format**: Starts with `xapp-`
**Example**: `xapp-1-A123456-789-abc`
**Required**: Only if `SLACK_HTTP_MODE` is not `true`
**Used by**: Socket Mode WebSocket connection

### `SLACK_SIGNING_SECRET`
**Description**: Slack signing secret for request verification
**Format**: Alphanumeric string
**Example**: `a1b2c3d4e5f6g7h8i9j0`
**Used by**: Slack request signature verification

### `SLACK_HTTP_MODE`
**Description**: Use HTTP mode instead of Socket Mode
**Format**: `true` or `false`
**Default**: `false` (Socket Mode)
**Used by**: Connection mode selection

### `SLACK_BOT_USER_ID`
**Description**: Bot user ID (optional, auto-detected if not provided)
**Format**: Starts with `U`
**Example**: `U0123456789`
**Used by**: Message filtering

### `SLACK_API_URL`
**Description**: Slack API base URL (for testing/proxies)
**Format**: URL
**Default**: `https://slack.com/api`
**Used by**: Slack API client

## MCP (Model Context Protocol) Configuration

### `PEERBOT_MCP_SERVERS_URL`
**Description**: Path to MCP servers configuration file
**Format**: File path (relative to project root)
**Example**: `file:///app/.peerbot/mcp.config.json` or `.peerbot/mcp.config.json`
**Used by**: MCP server discovery and OAuth configuration

### `PUBLIC_GATEWAY_URL`
**Description**: Public URL where gateway is accessible (required for MCP OAuth callbacks)
**Format**: URL without trailing slash
**Example**: `https://peerbot.example.com`
**Default**: `http://localhost:8080`
**Used by**: OAuth callback URL generation

### OAuth Secrets for MCP Servers
**Description**: Client secrets for MCP OAuth integrations (referenced in mcp.config.json)
**Format**: Environment variable name pattern: `${env:VAR_NAME}`
**Example**: `GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_SECRET`
**Used by**: MCP OAuth flows

## Deployment Configuration

### `DEPLOYMENT_MODE`
**Description**: Worker deployment engine
**Values**: `docker` | `kubernetes`
**Default**: Auto-detected (Docker if Docker socket accessible, otherwise Kubernetes)
**Used by**: Orchestrator initialization

### `NODE_ENV`
**Description**: Environment mode
**Values**: `development` | `production`
**Default**: `production`
**Used by**: Hot reload, security defaults, logging behavior

### `COMPOSE_PROJECT_NAME`
**Description**: Docker Compose project name (Docker mode only)
**Format**: Alphanumeric string
**Default**: `peerbot`
**Used by**: Docker network name resolution (`${COMPOSE_PROJECT_NAME}_peerbot-network`)

## Worker Configuration

### Worker Image

#### `WORKER_IMAGE_REPOSITORY`
**Description**: Worker Docker image repository
**Default**: `buremba/peerbot-worker`
**Used by**: Worker container deployment

#### `WORKER_IMAGE_TAG`
**Description**: Worker Docker image tag
**Default**: `latest`
**Used by**: Worker container deployment

#### `WORKER_IMAGE_PULL_POLICY`
**Description**: Image pull policy for Kubernetes
**Values**: `Always` | `IfNotPresent` | `Never`
**Default**: `IfNotPresent`
**Used by**: Kubernetes worker deployment

### Worker Resources

#### `WORKER_CPU_REQUEST`
**Description**: CPU request for worker containers
**Format**: Kubernetes CPU format (e.g., `100m`, `1`, `1.5`)
**Default**: `100m`
**Used by**: Resource scheduling

#### `WORKER_CPU_LIMIT`
**Description**: CPU limit for worker containers
**Format**: Kubernetes CPU format
**Default**: `2000m` (2 CPUs)
**Used by**: Resource limits

#### `WORKER_MEMORY_REQUEST`
**Description**: Memory request for worker containers
**Format**: Kubernetes memory format (e.g., `128Mi`, `1Gi`)
**Default**: `256Mi`
**Used by**: Resource scheduling

#### `WORKER_MEMORY_LIMIT`
**Description**: Memory limit for worker containers
**Format**: Kubernetes memory format
**Default**: `2Gi`
**Used by**: Resource limits

#### `WORKER_STORAGE_SIZE`
**Description**: Persistent volume size per worker (Kubernetes)
**Format**: Kubernetes storage format
**Default**: `1Gi`
**Used by**: PVC creation

### Worker Lifecycle

#### `WORKER_IDLE_CLEANUP_MINUTES`
**Description**: Minutes of inactivity before scaling worker to zero
**Format**: Integer
**Default**: `15`
**Used by**: Worker cleanup scheduler

#### `WORKER_STALE_TIMEOUT_MINUTES`
**Description**: Minutes of inactivity before considering worker connection stale
**Format**: Integer
**Default**: `10`
**Used by**: Worker connection health monitoring

#### `WORKER_RUNTIME_CLASS_NAME`
**Description**: Kubernetes RuntimeClass for enhanced isolation (e.g., gVisor)
**Format**: RuntimeClass name
**Default**: `""` (empty, uses default runtime)
**Used by**: Kubernetes Pod spec

### Worker Security (Docker Mode)

#### `WORKER_VOLUME_MOUNTS`
**Description**: Additional volume mounts for worker containers (development mode only)
**Format**: Semicolon-separated mount specs
**Placeholders**: `${PWD}` (project root), `${WORKSPACE_DIR}` (thread-specific workspace)
**Example**: `${PWD}/examples/my-tool:/workspace/my-tool:ro;${PWD}/data:/data:rw`
**Used by**: Docker bind mounts in development mode

#### `PEERBOT_DEV_PROJECT_PATH` (Internal - Development Only)
**Description**: Host project path for mounting into worker containers (internal use, set automatically in docker-compose.dev.yml)
**Format**: Absolute host path
**Example**: `/Users/username/Code/peerbot`
**Note**: Only needed in development mode when gateway runs in Docker and needs to mount host directories into workers
**Used by**: Docker bind mounts for hot reload

#### `WORKER_READONLY_ROOTFS`
**Description**: Enable read-only root filesystem for workers
**Format**: `true` | `false`
**Default**: `true` (enabled for security)
**Note**: Workers can still write to `/workspace`, `/tmp`, and `/home/bun/.cache`
**Used by**: Docker security configuration

#### `WORKER_CAPABILITIES`
**Description**: Linux capabilities to add to worker containers
**Format**: Comma-separated capability names
**Default**: `""` (empty, no capabilities added - all dropped)
**Example**: `NET_ADMIN,SYS_PTRACE`
**Used by**: Docker CapAdd configuration
**Warning**: Only add capabilities if absolutely necessary

#### `WORKER_SECCOMP_PROFILE`
**Description**: Path to custom seccomp profile JSON
**Format**: Absolute path to JSON file
**Default**: Docker's default seccomp profile (recommended)
**Example**: `/etc/docker/seccomp/worker-profile.json`
**Used by**: Docker SecurityOpt configuration

#### `WORKER_APPARMOR_PROFILE`
**Description**: AppArmor profile name for workers
**Format**: Profile name
**Default**: Docker's default AppArmor profile (recommended)
**Example**: `docker-peerbot-worker`
**Used by**: Docker SecurityOpt configuration

#### `WORKER_USERNS_MODE`
**Description**: User namespace mode for workers
**Format**: `host` | `""` (empty for daemon default)
**Default**: `""` (uses Docker daemon's userns-remap config)
**Used by**: Docker user namespace remapping
**Note**: Requires Docker daemon configured for user namespace remapping

## Claude Agent Configuration

### `ALLOWED_TOOLS`
**Description**: Comma-separated list of allowed Claude tools
**Format**: Tool names separated by commas
**Example**: `bash,read,write,edit`
**Default**: All tools allowed
**Used by**: Worker tool filtering

### `AGENT_DEFAULT_MODEL`
**Description**: Default Claude model to use
**Format**: Model identifier
**Example**: `claude-3-5-sonnet-20241022`
**Default**: Latest Sonnet model
**Used by**: Claude API calls

### `TIMEOUT_MINUTES`
**Description**: Maximum execution time for agent tasks
**Format**: Integer (minutes)
**Default**: No timeout
**Example**: `30`
**Used by**: Worker timeout enforcement

### `ANTHROPIC_BASE_URL`
**Description**: Custom Anthropic API base URL (for proxies/testing)
**Format**: URL
**Default**: `https://api.anthropic.com`
**Used by**: Claude API client

### `CLAUDE_ALLOWED_TOOLS`
**Description**: Alternative to ALLOWED_TOOLS (passed to worker)
**Format**: Comma-separated tool names
**Used by**: Worker tool filtering

### `CLAUDE_TIMEOUT_MINUTES`
**Description**: Alternative to TIMEOUT_MINUTES (passed to worker)
**Format**: Integer (minutes)
**Used by**: Worker timeout enforcement

## Queue Configuration

### `QUEUE_DIRECT_MESSAGE`
**Description**: Queue name for direct messages
**Default**: `peerbot:queue:direct-message`
**Used by**: Message routing

### `QUEUE_MESSAGE_QUEUE`
**Description**: Queue name for channel messages
**Default**: `peerbot:queue:message-queue`
**Used by**: Message routing

### `QUEUE_RETRY_LIMIT`
**Description**: Maximum retry attempts for failed jobs
**Format**: Integer
**Default**: `3`
**Used by**: Queue retry logic

### `QUEUE_RETRY_DELAY`
**Description**: Delay between retries (seconds)
**Format**: Integer
**Default**: `5`
**Used by**: Queue retry logic

### `QUEUE_EXPIRE_HOURS`
**Description**: Job expiration time (hours)
**Format**: Integer
**Default**: `24`
**Used by**: Job cleanup

## Session & Health Configuration

### `SESSION_TIMEOUT_MINUTES`
**Description**: Session inactivity timeout
**Format**: Integer
**Default**: `60`
**Used by**: Session cleanup

### `LOG_LEVEL`
**Description**: Logging verbosity
**Values**: `debug` | `info` | `warn` | `error`
**Default**: `info`
**Used by**: Logger configuration

### `PORT`
**Description**: HTTP server port (HTTP mode only)
**Format**: Integer
**Default**: `3000`
**Used by**: Express server binding

## Kubernetes-Specific Variables

### `KUBERNETES_SERVICE_HOST`
**Description**: Kubernetes API server host (auto-set by Kubernetes)
**Used by**: Kubernetes client configuration

### `KUBECONFIG`
**Description**: Path to kubeconfig file (for local development)
**Format**: File path
**Example**: `~/.kube/config`
**Used by**: Kubernetes client configuration

### `DISPATCHER_SERVICE_NAME`
**Description**: Kubernetes service name for gateway (for worker callbacks)
**Format**: Kubernetes service name
**Default**: `peerbot-dispatcher`
**Used by**: Worker-to-gateway communication

## Health Monitoring

### `SOCKET_HEALTH_CHECK_INTERVAL_MS`
**Description**: Interval between Socket Mode health checks (milliseconds)
**Format**: Integer
**Default**: `60000` (1 minute)
**Used by**: Socket Mode health monitoring

### `SOCKET_STALE_THRESHOLD_MS`
**Description**: Time without Socket Mode events before considering connection stale (milliseconds)
**Format**: Integer
**Default**: `900000` (15 minutes)
**Used by**: Socket Mode health monitoring

### `SOCKET_PROTECT_ACTIVE_WORKERS`
**Description**: Wait for active workers to finish before restarting on stale connection
**Format**: `true` | `false`
**Default**: `true`
**Used by**: Socket Mode health monitoring

## Summary of Minimal Required Configuration

For basic setup, you only need:

```bash
# Required
QUEUE_URL=redis://redis:6379/0
SLACK_BOT_TOKEN=xoxb-your-token
SLACK_APP_TOKEN=xapp-your-token  # Only if using Socket Mode
SLACK_SIGNING_SECRET=your-secret
ENCRYPTION_KEY=$(openssl rand -base64 32)

# Recommended
ANTHROPIC_API_KEY=sk-ant-your-key  # Or use per-user OAuth
PUBLIC_GATEWAY_URL=https://your-domain.com  # Required for MCP OAuth
```

All other variables have sensible defaults and are optional.
