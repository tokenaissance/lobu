# create-peerbot

CLI tool for initializing Peerbot projects with Docker Compose.

## Installation

### Standalone

```bash
npm install -g create-peerbot

mkdir my-peerbot
cd my-peerbot
npm create peerbot my-peerbot
docker compose up -d
```

### npx/npm create (Recommended)

```bash
npm create peerbot my-peerbot
cd my-peerbot
docker compose up -d
```

## Worker Deployment Options

Peerbot supports two deployment patterns for workers:

### Option 1: Base Image (Day 0 - Quick Start)

**Best for:** Beginners, tutorials, quick prototypes

```dockerfile
# Extends our curated base image
FROM buremba/peerbot-worker-base:0.1.0

# Add your customizations
RUN pip install pandas
RUN apt-get install postgresql-client
```

**Pros:**
- ✅ Turnkey experience - just works
- ✅ All dependencies pre-installed
- ✅ Predictable environment

**Cons:**
- ❌ Stuck with our base OS choice
- ❌ May not meet compliance requirements

---

### Option 2: Package Installation (Day 2 - Advanced)

**Best for:** Enterprise, compliance-heavy environments, custom requirements

```dockerfile
# Use YOUR approved base image
FROM company-registry/ubuntu:22.04

# Install system dependencies
RUN apt-get update && apt-get install -y \
    nodejs npm git docker.io python3 curl

# Install Claude CLI
RUN curl -L https://claude.ai/install.sh | sh

# Install Peerbot worker as a package
RUN npm install -g @peerbot/worker@^0.1.0

# Your customizations
COPY ./scripts /workspace/scripts

CMD ["peerbot-worker"]
```

**Pros:**
- ✅ Full control over base OS
- ✅ Use company-approved images
- ✅ Smaller images (Alpine, Distroless)
- ✅ Meet security/compliance requirements

**Cons:**
- ❌ More setup required
- ❌ Must install system dependencies yourself

See [Worker Package Documentation](../worker/docs/custom-base-image.md) for details.

---

## Commands

### `create-peerbot`

Initialize a new Peerbot project in the current directory.

**Interactive prompts:**
- **Worker mode:** Base image vs Package installation
- Slack credentials
- Anthropic API key
- Public gateway URL (for OAuth)

**Generates:**
- `docker-compose.yml` - Service definitions (redis, gateway, worker)
- `.env` - Credentials
- `Dockerfile.worker` - Worker customization via Dockerfile
- `.gitignore`, `README.md`

**If docker-compose.yml exists**, you'll be prompted for an alternative filename.

## Usage

After running `npm create peerbot`:

```bash
# Start services
docker compose up -d

# View logs
docker compose logs -f

# Stop services
docker compose down

# Rebuild worker after changes
docker compose build worker
```

## Configuration

### Dockerfile.worker (Base Image Mode)

```dockerfile
FROM buremba/peerbot-worker-base:0.1.0

# Add system packages
RUN apt-get update && apt-get install -y postgresql-client

# Add Python packages
RUN pip install pandas matplotlib

# Add Node.js packages
RUN bun add @octokit/rest

# Copy custom scripts
COPY ./scripts /workspace/scripts
```

### Dockerfile.worker (Package Mode)

```dockerfile
# Bring your own base
FROM node:20-alpine

# Install required system dependencies
RUN apk add --no-cache git docker-cli python3 py3-pip curl

# Install Claude CLI
RUN curl -L https://claude.ai/install.sh | sh

# Install worker package
RUN npm install -g @peerbot/worker@^0.1.0

# Your customizations
RUN pip3 install pandas matplotlib

CMD ["peerbot-worker"]
```

## Development Workflow

```bash
# 1. Create project
mkdir my-bot
cd my-bot
npm create peerbot

# 2. Choose worker mode during init
#    - Base image (recommended)
#    - Package installation (advanced)

# 3. Customize worker (optional)
# Edit Dockerfile.worker

# 4. Start services
docker compose up -d

# 5. View logs
docker compose logs -f

# 6. Rebuild after changes
docker compose build worker

# 7. Stop services
docker compose down
```

## Version Locking

The CLI version locks to base image versions:

- CLI `0.1.0` → `buremba/peerbot-worker-base:0.1.0`
- CLI `0.2.0` → `buremba/peerbot-worker-base:0.2.0`

This ensures compatibility between CLI and runtime images.

## Distribution Strategy

Peerbot uses a dual distribution pattern:

**Day 0 (Quick Start):**
- Use `buremba/peerbot-worker-base` Docker image
- Extend with Dockerfile
- Perfect for learning, prototypes

**Day 2+ (Production):**
- Install `@peerbot/worker` npm package
- Use your own base image
- Perfect for enterprise, compliance

## Published Artifacts

**Docker Hub:**
```bash
# For production (gateway)
docker pull buremba/peerbot-gateway:0.1.0

# For quick start (extend this)
docker pull buremba/peerbot-worker-base:0.1.0

# For production workers
docker pull buremba/peerbot-worker:0.1.0
```

**NPM Registry:**
```bash
# CLI tool
npm install -g create-peerbot@0.1.0

# Worker runtime (for custom base images)
npm install -g @peerbot/worker@0.1.0
```

## Architecture

```
User creates project
        ↓
mkdir my-bot && cd my-bot
        ↓
npm create peerbot
        ↓
Choose: Base image or Package?
        ↓
┌───────────────┴────────────────┐
│ Base Image Mode                │ Package Mode
│                                 │
│ FROM peerbot-worker-base       │ FROM your-company/base
│ RUN pip install pandas         │ RUN npm install -g @peerbot/worker
│                                 │ RUN pip install pandas
└───────────────┬────────────────┘
                ↓
    CLI generates docker-compose.yml
                ↓
        User runs: docker compose up -d
                ↓
        Docker builds worker:latest
                ↓
        Gateway spawns workers dynamically
```

## Contributing

Peerbot CLI generates Docker Compose configurations. To modify the generated setup, see `src/commands/init.ts`.

## License

MIT
