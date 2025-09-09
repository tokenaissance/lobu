## Project Structure & Module Organization
- Monorepo managed by Bun workspaces: `packages/dispatcher`, `packages/orchestrator`, `packages/worker`, `packages/shared`.
- Top-level tooling and ops: `Makefile`, `bin/` (CLI and setup scripts), `docker-compose*.yml`, `charts/peerbot` (Helm), `workspaces/` (local volumes), `.env*`.
- TypeScript sources under `packages/*/src`. Tests live in `packages/*/src/__tests__` and `packages/shared/tests`.
- **ALWAYS use `bun` commands, NEVER use `npm`** - npm is incompatible with workspace protocol

## Instructions
- You MUST only do what has been asked; nothing more, nothing less.
- For comprehensive QA and E2E testing, see `.claude/commands/qa.md` for detailed testing procedures and examples. You can directly run `.claude/commands/test-e2e-slack-bot.sh "Your prompt"` if there is no specific testing asked, otherwise use `./slack-qa-bot.js` to test the bot.
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

- **Docker Compose**: Run `make dev` to start all services with hot reload enabled
- **Logs**: View logs with `make logs` or `docker compose logs -f [service]`
- **Hot Reload**: Source code changes are automatically detected when NODE_ENV=development
- **Database**: PostgreSQL runs in Docker Compose, accessible on port 5432

## Deployment Instructions

When making changes to the Slack bot:
1. **Development**: Use `make dev` for Docker Compose with hot reload
2. **Kubernetes deployment**: Use `make deploy` for production deployment

## Development Configuration

- Rate limiting is disabled in local development
- Worker image is built automatically when running `make dev`

## k3s Setup

For k3s clusters, you can install cri-dockerd and configure k3s to use Docker daemon for local images.

## Persistent Storage

Worker pods now use persistent volumes for data storage:

1. **Persistent Volumes**: Each worker pod mounts a persistent volume at `/workspace` to preserve data across pod restarts
2. **Auto-Resume**: The worker automatically resumes conversations using Claude CLI's built-in `--resume` functionality when continuing a thread in the same persistent volume
3. **Data Persistence**: All workspace data is preserved in the persistent volume, eliminating the need for conversation file syncing

## Testing with slack-qa-bot.js

**See `.claude/commands/qa.md` for comprehensive testing documentation with examples.**

Basic usage:

```bash
# Simple test
./slack-qa-bot.js "Hello bot"

# JSON output for automation
./slack-qa-bot.js --json "Create a function" | jq -r .thread_ts

# Comprehensive E2E testing
./.claude/commands/test-e2e-slack-bot.sh
```
