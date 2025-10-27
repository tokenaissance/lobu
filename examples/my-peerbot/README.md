# my-peerbot

Peerbot instance created with `@peerbot/cli` v2.0.0

## Quick Start

```bash
# Start the services
docker compose up -d

# View logs
docker compose logs -f

# Stop the services
docker compose down
```

## Configuration

### Environment Variables

Edit `.env` to configure:
- `SLACK_BOT_TOKEN` - Your Slack bot token
- `SLACK_APP_TOKEN` - Your Slack app token
- `SLACK_SIGNING_SECRET` - Your Slack signing secret
- `ANTHROPIC_API_KEY` - Your Anthropic API key (optional if users provide their own)
- `PUBLIC_GATEWAY_URL` - Public URL for OAuth callbacks

### Worker Customization

Edit `Dockerfile.worker` to add custom tools and dependencies.

Example customizations:
```dockerfile
# Add system packages
RUN apt-get update && apt-get install -y postgresql-client

# Add Python packages
RUN pip install pandas matplotlib

# Add Node.js packages
RUN bun add @octokit/rest
```

When you modify `Dockerfile.worker` or context files, rebuild the worker image:
```bash
docker compose build worker
```

The gateway will automatically pick up the latest worker image.

## Services

The docker-compose.yml defines these services:
- **redis** - Redis cache and queue
- **gateway** - Slack integration and worker orchestration
- **worker** - Claude worker (build-only, spawned dynamically)

## Learn More

- [Peerbot Documentation](https://github.com/buremba/peerbot)
- [CLI Reference](https://github.com/buremba/peerbot/tree/main/packages/cli)
- [Examples](https://github.com/buremba/peerbot/tree/main/examples)

## Support

- [GitHub Issues](https://github.com/buremba/peerbot/issues)
