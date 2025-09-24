# Dispatcher Agent Instructions

## Package Overview
Slack event router and communication hub. Entry point for all Slack interactions.

## Core Files & Responsibilities

### Event Handlers (`src/slack/event-handlers/`)
- `message-handlers.ts`: Routes messages to workers, ensures one thread = one worker
- `block-actions.ts`: Handles buttons, menus, interactive components
- `file-handlers.ts`: Processes file uploads and attachments  
- `form-handlers.ts`: Manages modal submissions
- `user-handlers.ts`: User authentication and setup

### Queue Integration (`src/queue/`)
- `task-queue-producer.ts`: Publishes to `worker_deployment` and `thread_message_{deploymentId}` queues
- `slack-thread-processor.ts`: Consumes `thread_response` queue, updates Slack messages

### GitHub Integration (`src/github/`)
- `repository-manager.ts`: OAuth flows, repository access, token encryption

## PostgreSQL Tables
- `users`: Platform user data with RLS isolation
- `user_environ`: Environment variables (channel/repository scoped)

## Critical Architecture Rules
- **One thread = One worker**: All messages in a Slack thread go to same worker deployment
- Use `targetThreadId` for consistent worker naming: `peerbot-worker-{userId}-{threadId}`
- Never use message timestamps for worker identification

## Environment Variables
- `SLACK_BOT_TOKEN`: Slack API access
- `DATABASE_URL`: PostgreSQL connection 
- `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET`: OAuth
- `ANTHROPIC_API_KEY`: API proxy