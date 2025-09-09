# Peerbot Message Handling Design

This document describes how Peerbot handles user messages in different thread and worker states.

## Overview

Peerbot uses a queue-based architecture where the dispatcher receives Slack messages and routes them to workers through PostgreSQL queues. Each thread has a unique session key and can have an associated worker deployment.

## Key Concepts

- **Thread**: A Slack conversation thread identified by `threadTs`
- **Session Key**: Generated from `platform:channelId:userId:threadTs:messageTs`
- **Worker Deployment**: A Docker container running Claude Code for a specific thread
- **Claude Session**: A persistent conversation session with Claude within a worker

## Message Handling Scenarios

### 1. New Thread + No Worker

**Scenario**: User sends first message in a new thread

**Flow**:

1. Dispatcher receives message
2. Generates new session key and Claude session ID (UUID)
3. Adds "👀" reaction to user message
4. Enqueues `WorkerDeploymentPayload` to `messages` queue
5. Orchestrator creates new worker deployment
6. Worker starts and processes the message
7. Worker sends "💻 Setting up workspace..." to thread_response queue (new workspace)
8. ThreadResponseConsumer creates **first bot message** and caches timestamp
9. All subsequent updates from worker **update the same bot message**
10. Final reaction changes to "✅"

**Result**: New worker created, new bot message thread started

### 2. Existing Thread + No Worker

**Scenario**: User continues conversation in existing thread but worker was terminated

**Flow**:

1. Dispatcher finds existing session with stored Claude session ID
2. Adds "👀" reaction to user message
3. Enqueues `WorkerDeploymentPayload` with `resumeSessionId` instead of `sessionId`
4. Orchestrator creates new worker deployment
5. Worker resumes Claude session using `--resume` functionality
6. Worker sends "💻 Resuming workspace..." to thread_response queue (existing workspace)
7. Worker continues conversation in existing thread
8. **Creates new bot message** (no cached timestamp for this worker instance)
9. Updates proceed normally

**Result**: New worker created, conversation resumed in existing thread

### 3. Existing Thread + Worker Exists + No Active Session

**Scenario**: User sends message to thread with idle worker

**Flow**:

1. Dispatcher finds existing session and active worker
2. Adds "👀" reaction to user message
3. Enqueues `ThreadMessagePayload` to thread-specific queue (`thread_message_<deployment-name>`)
4. Existing worker processes message immediately
5. Worker resumes Claude session
6. **Uses cached bot message timestamp** if available, otherwise creates new message
7. Updates proceed normally

**Result**: Existing worker processes message, conversation continues

### 4. Existing Thread + Worker Exists + Active Session Running

**Scenario**: User sends message while Claude is actively processing previous message

**Flow**:

1. Dispatcher adds "👀" reaction to new message
2. Enqueues `ThreadMessagePayload` to thread-specific queue
3. Worker receives message and **queues it internally**
4. Current Claude session completes
5. Worker **combines queued messages** into single prompt for next Claude session
6. Worker processes combined messages as one session
7. **Cog reaction moves to the last user message** being processed
8. **Same bot message continues to be updated**

**Result**: Messages queued and processed together, single bot response updated

## Bot Message Management

### Single Bot Message Per Session

- Each thread maintains **one bot message** that gets updated throughout the Claude session
- ThreadResponseConsumer tracks bot messages using `sessionKey = userId:threadTs`
- First response creates new bot message, subsequent responses update the same message

### Message Update Flow

```
Worker → thread_response queue → ThreadResponseConsumer → Slack API update
```

### Reaction Management

- User message reactions indicate processing state:
  - 👀 = Acknowledged, queuing
  - ⚙️ = Worker actively processing
  - ✅ = Completed successfully
  - ❌ = Error occurred

## Queue Architecture

### Primary Queues

1. **`messages`** - New deployment requests and first messages
2. **`thread_message_<deployment-name>`** - Messages for specific worker deployments
3. **`thread_response`** - Worker responses back to Slack

### Message Types

1. **`WorkerDeploymentPayload`** - Creates new worker deployment
2. **`ThreadMessagePayload`** - Routes to existing worker
3. **`ThreadResponsePayload`** - Worker output to be sent to Slack

## Session Management

### Claude Session Continuity

- Each thread has a unique Claude session ID (UUID)
- Sessions persist across worker restarts using `--resume` functionality
- Messages in same thread continue the same Claude conversation

### Worker Lifecycle

- Workers are created per thread on first message
- Workers persist until idle timeout or manual termination
- Workers can be scaled to 0 and restarted while preserving session state

## Message Combining Logic

When multiple messages arrive while Claude is processing:

1. **Queuing**: New messages are queued in worker's internal queue
2. **Combining**: When Claude session completes, all queued messages are combined with `\n\n` separator
3. **Processing**: Combined message sent to Claude as single prompt
4. **Response**: Single bot message updated with Claude's response to all messages

This ensures efficient processing and maintains conversation context while avoiding spam.

## Error Handling

### Worker Failures

- If worker crashes during processing, orchestrator can restart it
- Session state preserved in persistent volume
- Bot message shows error state, can be resumed

### Queue Failures

- PgBoss provides retry logic for failed queue operations
- ThreadResponseConsumer handles Slack API errors gracefully
- Failed messages logged for debugging

## Development vs Production

### Local Development (Docker)

- Uses Docker containers for workers
- Hot reload for dispatcher/orchestrator changes
- Direct PostgreSQL connection

### Production (Kubernetes)

- Uses Kubernetes deployments for workers
- Persistent volumes for session data
- Secrets management for credentials

## Thread Cleanup

- Inactive workers are cleaned up after idle timeout
- Bot message timestamps cached in memory (cleared on restart)
- Session mappings persist until dispatcher restart
- Workspace data preserved in persistent volumes

## Workspace Setup Behavior

Even for existing threads, workspace setup is required because each worker is a **new Docker container**:

### New Threads (First Message)

- Shows "💻 Setting up workspace..."
- Full repository clone (30-180 seconds)
- Creates session branch
- Sets up git configuration

### Existing Threads (Resumed Sessions)

- Shows "💻 Resuming workspace..."
- Repository already exists in persistent volume
- Quick `git fetch origin` (2-5 seconds)
- Checks out session branch
- Sets up git configuration (needed for new container)

### Why Setup Is Always Needed

1. **Fresh Container** - Each worker deployment is a new Docker container
2. **Git Configuration** - Must be configured in the new container environment
3. **Repository Sync** - Fetches latest changes from remote
4. **Branch Checkout** - Ensures correct session branch is active
5. **Working Directory** - Prepares workspace for Claude operations

The persistent volume preserves the repository and session data, but container initialization is still required.

## GitHub OAuth Integration

### Overview

Peerbot supports GitHub OAuth authentication to allow users to work with their own repositories and use their personal GitHub tokens instead of the system token.

### Authentication Flow

1. **Login Button**: Users see "Login with GitHub" button in Slack home tab
2. **OAuth Redirect**: Button redirects to `/api/github/oauth/authorize` endpoint
3. **State Encryption**: State parameter encrypted with AES-256-GCM for security
4. **GitHub Authorization**: User authorizes app on GitHub
5. **Callback Processing**: `/api/github/oauth/callback` exchanges code for token
6. **Token Storage**: OAuth token stored in `user_environ` table
7. **Home Tab Refresh**: Slack home tab automatically refreshes to show connected state

### Repository Selection

Repository selection follows a hierarchical system:

#### 1. Environment Variable Override (Highest Priority)
- If `GITHUB_REPOSITORY` is set, all users use this fixed repository
- No user override possible
- Used for single-project teams

#### 2. User-Selected Repository
- Users can select repositories via modal in Slack home tab
- Selection stored in `user_environ` as `SELECTED_REPOSITORY`
- Repository list fetched using user's OAuth token
- External select with autocomplete for easy searching

#### 3. Default Repository Creation
- If `GITHUB_ORGANIZATION` is set, creates `user-[username]` repository
- Falls back to authenticated user's account if org not available
- Auto-creates repository with README and initial structure

### Token Hierarchy

When spawning workers, tokens are selected in this order:

1. **User's OAuth Token** (if logged in via GitHub)
2. **System GITHUB_TOKEN** (fallback for non-authenticated users)

This allows authenticated users to work with private repositories while maintaining backward compatibility.

### Database Schema

User tokens and settings stored in `user_environ` table:

```sql
-- GitHub OAuth token
name: 'GITHUB_TOKEN'
value: 'gho_xxxxx'
type: 'user'
user_id: [user.id]

-- GitHub username
name: 'GITHUB_USER'  
value: 'username'
type: 'user'
user_id: [user.id]

-- Selected repository
name: 'SELECTED_REPOSITORY'
value: 'https://github.com/owner/repo'
type: 'system'
user_id: [user.id]
```

### UI Components

#### Home Tab
- Shows GitHub connection status
- Displays current repository as `owner/repo` format
- "Change Repository" button opens selection modal
- README.md content displayed if repository has one
- Login/Logout buttons for authentication

#### Repository Modal
- External select dropdown with autocomplete
- Optional manual URL input field
- Lists all accessible repositories for the user
- Filters repositories as user types

### OAuth Endpoints

Dispatcher exposes OAuth endpoints on port 8080:

- `GET /api/github/oauth/authorize` - Initiates OAuth flow
- `GET /api/github/oauth/callback` - Handles GitHub callback
- `POST /api/github/oauth/logout` - Revokes user token

### Security Considerations

1. **State Parameter Encryption**: Uses AES-256-GCM with 32-byte key
2. **Token Storage**: Tokens stored encrypted in database
3. **Secure Redirects**: Validates redirect URLs
4. **Session Isolation**: Each user's tokens isolated by user ID
5. **Token Revocation**: Logout removes tokens from database

### Development Setup

For local development with GitHub OAuth:

1. Create GitHub OAuth App at https://github.com/settings/developers
2. Set Authorization callback URL to `http://localhost:8080/api/github/oauth/callback`
3. Add credentials to `.env`:
   ```
   GITHUB_CLIENT_ID=Ov23xxxxx
   GITHUB_CLIENT_SECRET=xxxxx
   ```
4. Use `INGRESS_URL=http://localhost:8080` for local testing

### Hot Reload Configuration

Development mode supports hot reload for rapid iteration:

1. **Docker Compose Dev**: Uses `docker-compose.dev.yml` for development
2. **Volume Mounts**: Source code mounted as volumes in containers
3. **Bun Watch Mode**: Dispatcher runs with `bun --watch src/index.ts`
4. **Auto Restart**: File changes trigger automatic service restart
5. **NODE_ENV**: Set to `development` for dev features

To enable hot reload:
```bash
make dev  # Uses docker-compose.dev.yml with volume mounts
```

Package.json configuration:
```json
"dev": "bun --watch src/index.ts"  // Enables file watching
```
