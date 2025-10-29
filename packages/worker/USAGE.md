# Worker Environment Variables

This document describes all environment variables used by Peerbot Workers. Most of these are automatically set by the Gateway orchestrator and should not be manually configured.

## Gateway-Managed Variables (Auto-Set)

These variables are automatically set by the Gateway when deploying worker containers. **Do not manually configure these.**

### `DISPATCHER_URL`
**Description**: Gateway URL for worker-to-gateway communication
**Format**: HTTP URL
**Example**: `http://gateway:8080/worker/stream`
**Set by**: Gateway orchestrator
**Used by**: SSE connection to gateway, progress updates, session management

### `WORKER_TOKEN`
**Description**: Authentication token for worker-gateway communication
**Format**: JWT token or user-specific token
**Set by**: Gateway orchestrator
**Used by**: Worker authentication, Anthropic API proxy authentication

### `DEPLOYMENT_NAME`
**Description**: Unique identifier for this worker deployment
**Format**: `peerbot-worker-{user}-{timestamp}-{random}`
**Example**: `peerbot-worker-u123abc-284-707819`
**Set by**: Gateway orchestrator
**Used by**: Deployment identification, logging

### `USER_ID`
**Description**: Platform-specific user identifier
**Format**: Platform-dependent (e.g., Slack user ID starts with `U`)
**Example**: `U0123456789`
**Set by**: Gateway orchestrator (updated on first message)
**Used by**: User-specific credential lookup, session management

### `THREAD_ID`
**Description**: Platform thread identifier for conversation context
**Format**: Platform-dependent
**Example**: `1234567890.123456`
**Set by**: Gateway orchestrator
**Used by**: Workspace isolation, session continuity

### `WORKSPACE_DIR`
**Description**: Worker workspace directory path
**Format**: Absolute path
**Default**: `/workspace`
**Set by**: Worker initialization
**Used by**: File operations, MCP process working directory

### `HOME`
**Description**: Home directory for worker processes
**Format**: Absolute path
**Default**: `/workspace` (to persist Claude CLI sessions)
**Set by**: Gateway orchestrator
**Used by**: Claude CLI session storage (`.claude/` directory)

### `HOSTNAME`
**Description**: Container hostname (fallback for DEPLOYMENT_NAME)
**Format**: Alphanumeric string
**Set by**: Container runtime
**Used by**: Deployment identification if DEPLOYMENT_NAME not set

## Queue Configuration

### `QUEUE_URL`
**Description**: Redis connection string for job queues
**Format**: `redis://host:port/db`
**Example**: `redis://redis:6379/0`
**Set by**: Gateway orchestrator (passed from gateway config)
**Used by**: Queue connection (if worker needs direct queue access)

## Database Configuration (Platform-Specific)

### `PEERBOT_DATABASE_HOST`
**Description**: PostgreSQL host for platform-specific storage
**Format**: Hostname or IP
**Example**: `postgres`, `host.docker.internal`
**Set by**: Gateway orchestrator (passed from gateway config)
**Used by**: Database connections for platform data

### `PEERBOT_DATABASE_PORT`
**Description**: PostgreSQL port
**Format**: Integer
**Default**: `5432`
**Set by**: Gateway orchestrator
**Used by**: Database connections

### `PEERBOT_DATABASE_NAME`
**Description**: PostgreSQL database name
**Format**: String
**Set by**: Gateway orchestrator
**Used by**: Database connections

### `PEERBOT_DATABASE_USER`
**Description**: PostgreSQL username
**Format**: String
**Set by**: Gateway orchestrator
**Used by**: Database authentication

### `PEERBOT_DATABASE_PASSWORD`
**Description**: PostgreSQL password
**Format**: String
**Set by**: Gateway orchestrator
**Used by**: Database authentication

## Claude Configuration (Optional Overrides)

These can be set in the Gateway configuration and will be passed to workers:

### `CLAUDE_ALLOWED_TOOLS`
**Description**: Comma-separated list of allowed Claude Code tools
**Format**: Tool names separated by commas
**Example**: `bash,read,write,edit`
**Set by**: Gateway orchestrator (from gateway config)
**Used by**: Tool filtering in Claude CLI

### `CLAUDE_DISALLOWED_TOOLS`
**Description**: Comma-separated list of disallowed Claude Code tools
**Format**: Tool names separated by commas
**Example**: `exec,rm`
**Set by**: Gateway orchestrator (from gateway config)
**Used by**: Tool filtering in Claude CLI

### `CLAUDE_TIMEOUT_MINUTES`
**Description**: Maximum execution time for Claude tasks
**Format**: Integer (minutes)
**Example**: `30`
**Set by**: Gateway orchestrator (from gateway config)
**Used by**: Task timeout enforcement

## MCP Configuration

### `MCP_PROCESS_MANAGER_PORT`
**Description**: Port for internal MCP process manager server
**Format**: Integer
**Default**: `3001`
**Set by**: Worker (optional override)
**Used by**: Inter-process MCP communication

### `MCP_SERVER_CONFIG`
**Description**: JSON configuration for MCP servers (auto-generated)
**Format**: JSON string
**Set by**: Worker initialization (from user credentials)
**Used by**: MCP server initialization

## Development/Debugging Variables

### `DEBUG`
**Description**: Enable debug logging
**Format**: `1` or any truthy value
**Example**: `DEBUG=1`
**Set by**: Gateway orchestrator in development mode
**Used by**: Enhanced logging, crash debugging

### `NODE_ENV`
**Description**: Environment mode
**Values**: `development` | `production`
**Set by**: Gateway orchestrator
**Used by**: Logging verbosity, error handling

## Internal Variables (Do Not Set)

These are used internally by the worker and should **never** be manually configured:

### `ANTHROPIC_API_KEY` (Internal Use Only)
**Description**: Set internally to WORKER_TOKEN for Anthropic proxy authentication
**Set by**: Worker SDK adapter
**Used by**: Claude Code CLI authentication to gateway's Anthropic proxy
**Warning**: This is NOT a real Anthropic API key - it's the worker authentication token

## Container Runtime Variables

These are automatically set by the container runtime:

### Read-Only Root Filesystem
**Default**: Enabled (`WORKER_READONLY_ROOTFS=true` in gateway)
**Writable paths**:
- `/workspace` - Worker workspace (persistent via volume)
- `/tmp` - Temporary files (100MB tmpfs)
- `/home/bun/.cache` - Bun cache (200MB tmpfs)

### Security Configuration
**Capabilities**: All dropped by default (CapDrop: ALL)
**Privilege Escalation**: Disabled (no-new-privileges)
**Seccomp**: Docker's default profile
**AppArmor**: Docker's default profile

## Summary

**For normal operation, workers require NO manual environment configuration.** The Gateway orchestrator automatically sets all necessary variables when deploying worker containers.

### Minimal Auto-Set Variables (by Gateway):
```bash
DISPATCHER_URL=http://gateway:8080/worker/stream
WORKER_TOKEN=<auto-generated>
DEPLOYMENT_NAME=peerbot-worker-<user>-<timestamp>
HOME=/workspace
```

### Optional Gateway-Passed Variables:
```bash
CLAUDE_ALLOWED_TOOLS=bash,read,write,edit
CLAUDE_TIMEOUT_MINUTES=30
DEBUG=1  # Development only
```

All other configuration is handled automatically by the worker based on gateway-provided context.
