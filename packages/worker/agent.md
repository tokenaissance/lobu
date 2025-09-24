# Worker Agent Instructions

## Package Overview
Claude Code execution environment. Processes user requests in isolated containers.

## Core Files & Responsibilities

### Core Execution (`src/core/`)
- `claude-session-executor.ts`: Manages Claude CLI session lifecycle
- `session-manager.ts`: Handles workspace persistence and session recovery
- `prompt-generation.ts`: Formats user inputs for Claude processing
- `types.ts`: Worker configuration and type definitions

### Queue Integration (`src/queue/`, `src/task-queue-integration.ts`)
- `queue-consumer.ts`: Listens to `thread_message_{deploymentId}` queue 
- `task-queue-integration.ts`: Sends responses to `thread_response` queue

### Worker Types
- `claude-worker.ts`: Basic Claude worker implementation
- `persistent-task-worker.ts`: Queue-based worker with session management
- `index.ts`: Main entry point, detects thread ID from deployment name

### Process Management (`src/process-manager-integration.ts`, `mcp/`)
- MCP server integration for enhanced tool access
- Subprocess execution and resource cleanup

## Critical Architecture Rules
- **One worker per thread**: Each worker serves exactly one Slack thread
- **Workspace persistence**: Uses `/workspace` volume for session continuity
- **Auto-resume**: Claude CLI `--resume` flag maintains conversation context
- **Thread isolation**: Workers only process messages for their assigned thread

## Environment Variables  
- `USER_ID`: Slack user ID for session association
- `TARGET_THREAD_ID`: Thread ID extracted from deployment name
- `WORKSPACE_DIR`: Persistent workspace path (`/workspace`)
- `DATABASE_URL`: PostgreSQL for queue operations
- `ANTHROPIC_API_KEY`: Claude API access
- `ALLOWED_TOOLS`: Comma-separated allowed Claude tools