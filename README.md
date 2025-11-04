# Peerbot

**Claude Code as a custom Slack bot.** Create your own custom sandboxedagents that works directly in Slack threads.

## Quick Start

```bash
# Create a new bot (interactive setup)
npm create peerbot my-slack-bot

# Start the bot
cd my-slack-bot
npm run dev
```

That's it! Your bot is now running and ready to help in Slack.

## What You Need

1. **Slack App** with Socket Mode enabled ([Setup Guide](https://api.slack.com/apps))
   - Bot Token (xoxb-...)
   - App Token (xapp-...)

2. **Docker Compose** installed and running

## Features

- 💬 **Thread-based conversations** - Each Slack thread = dedicated AI session in a sandboxed environment
- 🔄 **Persistent memory** - Full conversation history across interactions
- 🛠️ **Customizable workers** - Add Python packages, system tools, custom scripts
- 🔐 **MCP OAuth** - Authenticate external services via Slack home tab

## Worker Customization

Peerbot supports two modes for customizing your AI workers:

### Quick Start Mode (Recommended)
Extend our base image with your tools:
```dockerfile
FROM buremba/peerbot-worker-base:0.1.0

# Add Python packages
RUN pip install pandas matplotlib

# Add system tools
RUN apt-get update && apt-get install -y postgresql-client
```

### Advanced Mode (Bring Your Own Base)
Install the worker package in any base image:
```dockerfile
FROM your-company/approved-base:latest

RUN npm install -g @peerbot/worker@^0.1.0
RUN pip install pandas
```


## Commands

```bash
npm run dev      # Start the bot
npm run logs     # View logs
npm run down     # Stop the bot
npm run rebuild  # Rebuild worker image
```

## Architecture

```
Slack Thread → Gateway → Worker Pod → Claude Code
                  ↓
              Redis (state)
```

- **Gateway**: Manages Slack connections and worker orchestration
- **Worker**: Isolated Claude Code environment per user/thread
- **Redis**: Stores conversation state and OAuth credentials

## Deployment

### Local Development
```bash
npm run dev  # Uses Docker Compose
```

## Contributing

This is a monorepo managed by Bun workspaces.

```bash
# Install dependencies
bun install

# Build packages
bun run build

# Run locally
make dev

# Test bot
curl -X POST http://localhost:8080/api/messaging/send \
  -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"platform":"slack","channel":"test-channel","message":"@me test prompt"}'
```

## Published Packages

**NPM:**
- [`create-peerbot`](https://www.npmjs.com/package/create-peerbot) - Deployment CLI
- [`@peerbot/worker`](https://www.npmjs.com/package/@peerbot/worker) - Worker runtime

**Docker Hub:**
- [`buremba/peerbot-gateway`](https://hub.docker.com/r/buremba/peerbot-gateway)
- [`buremba/peerbot-worker-base`](https://hub.docker.com/r/buremba/peerbot-worker-base)