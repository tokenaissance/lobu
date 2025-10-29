#!/bin/bash
set -e

# Container entrypoint script for Claude Worker
echo "🚀 Starting Peerbot Worker..."

# Function to handle cleanup on exit
cleanup() {
    echo "📦 Container shutting down, performing cleanup..."
    
    # Kill any background processes
    jobs -p | xargs -r kill || true
    
    # Give processes time to exit gracefully
    sleep 2
    
    echo "✅ Cleanup completed"
    exit 0
}

# Setup signal handlers for graceful shutdown
trap cleanup SIGTERM SIGINT

echo "🔍 Environment variables provided by orchestrator:"
echo "  - USER_ID: ${USER_ID:-not set}" 
echo "  - CHANNEL_ID: ${CHANNEL_ID:-not set}"
echo "  - REPOSITORY_URL: ${REPOSITORY_URL:-not set}"
echo "  - DEPLOYMENT_NAME: ${DEPLOYMENT_NAME:-not set}"

# Basic validation for critical variables
if [[ -z "${USER_ID:-}" ]]; then
    echo "❌ Error: USER_ID is required"
    exit 1
fi

if [[ -z "${DEPLOYMENT_NAME:-}" ]]; then
    echo "❌ Error: DEPLOYMENT_NAME is required"
    exit 1
fi

# Setup workspace directory
echo "📁 Setting up workspace directory..."
WORKSPACE_DIR="/workspace"
mkdir -p "$WORKSPACE_DIR"

# Fix permissions for bind-mounted workspace
# This is needed because bind mounts inherit host permissions
if [ -d "$WORKSPACE_DIR" ] && [ "$(stat -c %U "$WORKSPACE_DIR")" = "root" ]; then
    echo "🔧 Fixing workspace permissions (bind mount detected)..."
    sudo chown -R claude:claude "$WORKSPACE_DIR" 2>/dev/null || echo "⚠️  Could not change workspace ownership"
    chmod 755 "$WORKSPACE_DIR" 2>/dev/null || echo "⚠️  Could not change workspace permissions"
fi

cd "$WORKSPACE_DIR"

echo "✅ Workspace directory ready: $WORKSPACE_DIR"

# Log container information
echo "📊 Container Information:"
echo "  - Session Key: $SESSION_KEY"
echo "  - Repository: $REPOSITORY_URL"
echo "  - Working Directory: $(pwd)"
echo "  - Container Hostname: $(hostname)"
echo "  - Container Memory Limit: $(cat /sys/fs/cgroup/memory.max 2>/dev/null || echo 'unknown')"
echo "  - Container CPU Limit: $(cat /sys/fs/cgroup/cpu.max 2>/dev/null || echo 'unknown')"

# Setup git global configuration
echo "⚙️ Setting up git configuration..."
git config --global user.name "Peerbot Worker"
git config --global user.email "peerbot@noreply.github.com"
git config --global init.defaultBranch main
git config --global pull.rebase false
git config --global safe.directory '*'

# In development mode, ensure core package can find its dependencies
# The packages/ dir is mounted as a volume which may contain node_modules from host
if [ "${NODE_ENV}" = "development" ]; then
    # Remove any existing node_modules that aren't symlinks
    if [ -e "/app/packages/core/node_modules" ] && [ ! -L "/app/packages/core/node_modules" ]; then
        echo "🗑️  Removing host node_modules from /app/packages/core/"
        rm -rf /app/packages/core/node_modules
    fi
    if [ ! -e "/app/packages/core/node_modules" ]; then
        echo "🔗 Creating symlink for core package dependencies..."
        ln -sf /app/node_modules /app/packages/core/node_modules
        echo "✅ Symlink created: /app/packages/core/node_modules -> /app/node_modules"
    fi

    # Also for worker package if needed
    if [ -e "/app/packages/worker/node_modules" ] && [ ! -L "/app/packages/worker/node_modules" ]; then
        rm -rf /app/packages/worker/node_modules
    fi
    if [ ! -e "/app/packages/worker/node_modules" ]; then
        ln -sf /app/node_modules /app/packages/worker/node_modules
    fi
fi

# Start the worker process
echo "🚀 Executing Claude Worker..."
# Check if we're already in the worker directory
if [ "$(pwd)" != "/app/packages/worker" ]; then
    cd /app/packages/worker || { echo "❌ Failed to cd to /app/packages/worker"; exit 1; }
fi

# In development mode, run from source to avoid path resolution issues with modules
if [ "${NODE_ENV}" = "development" ]; then
    echo "📝 Running in development mode from source..."
    exec bun run src/index.ts
else
    exec bun run dist/index.js
fi