# Using @lobu/worker with Custom Base Images

This guide explains how to install and run the Lobu worker in your own Docker base image.

## Why Use a Custom Base Image?

- **Compliance Requirements**: Use your company's approved/hardened base images
- **Security**: Control exactly what's in your container
- **Optimization**: Use Alpine for smaller images, or distroless for minimal attack surface
- **GPU Support**: Use CUDA-enabled base images for GPU workloads
- **Custom OS**: Use specific distributions required by your tools

## System Requirements

The Lobu worker requires these system dependencies:

| Dependency | Version | Required For |
|------------|---------|--------------|
| Node.js or Bun | >= 18.0 | Worker runtime |
| Docker CLI | >= 20.10 | Optional: spawning sub-containers |
| Claude CLI | Latest | AI interactions |
| Git | >= 2.30 | Code operations |
| Python | >= 3.9 | Optional: Python tools |
| curl/wget | Any | Installation scripts |

## Installation Methods

### Method 1: Using npm/bun

```dockerfile
FROM node:20-alpine

# Install system dependencies
RUN apk add --no-cache \
    docker-cli \
    git \
    python3 \
    py3-pip \
    curl

# Install Claude CLI
RUN curl -L https://claude.ai/install.sh | sh

# Install worker package
RUN npm install -g @lobu/worker@^0.1.0

# Set up workspace
WORKDIR /workspace

# Run worker
CMD ["lobu-worker"]
```

### Method 2: Using Bun (Recommended)

```dockerfile
FROM oven/bun:1.2.9-alpine

# Install system dependencies
RUN apk add --no-cache \
    docker-cli \
    git \
    python3 \
    py3-pip

# Install Claude CLI
RUN curl -L https://claude.ai/install.sh | sh

# Install worker
RUN bun add -g @lobu/worker@^0.1.0

# Run worker
CMD ["lobu-worker"]
```

### Method 3: Company Approved Base

```dockerfile
# Use your company's golden image
FROM company-registry.example.com/ubuntu:22.04

# Install Node.js
RUN apt-get update && apt-get install -y \
    nodejs \
    npm \
    docker.io \
    git \
    python3 \
    python3-pip \
    curl

# Install Claude CLI
RUN curl -L https://claude.ai/install.sh | sh

# Install worker
RUN npm install -g @lobu/worker@^0.1.0

# Your company's security/monitoring agents
RUN /company/install-security-agents.sh

CMD ["lobu-worker"]
```

### Method 4: Distroless (Minimal Attack Surface)

```dockerfile
# Build stage
FROM node:20-alpine AS builder

RUN apk add --no-cache git curl python3

# Install Claude CLI
RUN curl -L https://claude.ai/install.sh | sh

# Install worker
RUN npm install -g @lobu/worker@^0.1.0

# Runtime stage (minimal)
FROM gcr.io/distroless/nodejs20-debian12

# Copy only runtime files from builder
COPY --from=builder /usr/local/bin/lobu-worker /usr/local/bin/
COPY --from=builder /usr/local/bin/claude /usr/local/bin/
COPY --from=builder /usr/local/lib/node_modules/@lobu/worker /usr/local/lib/node_modules/@lobu/worker

CMD ["lobu-worker"]
```

## Environment Variables

The worker requires these environment variables at runtime:

```bash
# Required
USER_ID=U123456789              # Slack user ID
DEPLOYMENT_NAME=worker-name     # Unique deployment identifier
DISPATCHER_URL=http://gateway:8080  # Gateway URL
WORKER_TOKEN=secret-token       # Authentication token

# Optional
WORKSPACE_DIR=/workspace        # Working directory (default: /workspace)
ANTHROPIC_API_KEY=sk-ant-...   # If not proxied through gateway
ANTHROPIC_BASE_URL=...         # Custom API endpoint
```

## Example: Alpine + Custom Tools

```dockerfile
FROM alpine:3.19

# Install runtime + system deps
RUN apk add --no-cache \
    nodejs \
    npm \
    docker-cli \
    git \
    python3 \
    py3-pip \
    postgresql-client \
    redis \
    curl

# Install Claude CLI
RUN curl -L https://claude.ai/install.sh | sh

# Install worker
RUN npm install -g @lobu/worker@^0.1.0

# Install Python tools
RUN pip3 install --break-system-packages \
    pandas \
    matplotlib \
    requests

# Install Node tools
RUN npm install -g \
    @octokit/rest \
    typescript

# Copy custom scripts
COPY ./scripts /workspace/scripts
RUN chmod +x /workspace/scripts/*.sh

WORKDIR /workspace
CMD ["lobu-worker"]
```

## Troubleshooting

### Worker won't start

**Error:** `lobu-worker: command not found`
- **Solution:** Ensure npm/bun installed the package globally, or use full path

**Error:** `claude: command not found`
- **Solution:** Install Claude CLI: `curl -L https://claude.ai/install.sh | sh`

### Missing system dependencies

**Error:** `git command not found`
- **Solution:** Install git in your base image: `apk add git` (Alpine) or `apt-get install git` (Ubuntu)

**Error:** `docker: command not found`
- **Solution:** Install Docker CLI: `apk add docker-cli` or `apt-get install docker.io`

### Permission issues

**Error:** `EACCES: permission denied`
- **Solution:** Run as root or add user to docker group:
  ```dockerfile
  RUN addgroup -S lobu && adduser -S lobu -G lobu
  RUN addgroup lobu docker
  USER lobu
  ```

## Compatibility Matrix

| Base Image | Tested | Notes |
|------------|--------|-------|
| `node:20-alpine` | ✅ | Recommended for small size |
| `node:20-slim` | ✅ | Debian-based, moderate size |
| `oven/bun:1.2.9` | ✅ | Best performance |
| `ubuntu:22.04` | ✅ | Most compatible |
| `ubuntu:24.04` | ✅ | Latest LTS |
| `gcr.io/distroless/nodejs20` | ⚠️ | Requires multi-stage build |
| `alpine:3.19` | ✅ | Must install Node separately |

## Migration from Base Image

If you're currently using `FROM buremba/lobu-worker-base`, here's how to migrate:

**Before:**
```dockerfile
FROM buremba/lobu-worker-base:0.1.0
RUN pip install pandas
```

**After:**
```dockerfile
FROM node:20-alpine

# Install system deps
RUN apk add --no-cache git docker-cli python3 py3-pip curl

# Install Claude CLI
RUN curl -L https://claude.ai/install.sh | sh

# Install worker
RUN npm install -g @lobu/worker@^0.1.0

# Your customizations (same as before!)
RUN pip3 install pandas

CMD ["lobu-worker"]
```

## Getting Help

- [GitHub Issues](https://github.com/lobu-ai/lobu/issues)
- [Compatibility Matrix](./compatibility-matrix.md)
- [Base Image Quick Start](../README.md) (if custom base isn't needed)
