#!/bin/bash
set -e

# Container entrypoint script for Claude Worker
echo "🚀 Starting Claude Code Worker container..."

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
echo "  - SESSION_KEY: ${SESSION_KEY:-not set}"
echo "  - USER_ID: ${USER_ID:-not set}" 
echo "  - CHANNEL_ID: ${CHANNEL_ID:-not set}"
echo "  - REPOSITORY_URL: ${REPOSITORY_URL:-not set}"
echo "  - DEPLOYMENT_NAME: ${DEPLOYMENT_NAME:-not set}"

# Basic validation for critical variables
if [[ -z "${SESSION_KEY:-}" ]]; then
    echo "❌ Error: SESSION_KEY is required"
    exit 1
fi

echo "✅ Critical environment variables are set"

# Setup Google Cloud credentials if provided
if [[ -n "${GOOGLE_APPLICATION_CREDENTIALS:-}" ]]; then
    echo "🔑 Setting up Google Cloud credentials..."
    
    # Ensure the credentials file exists
    if [[ -f "$GOOGLE_APPLICATION_CREDENTIALS" ]]; then
        echo "✅ Google Cloud credentials file found"
        
        # Set proper permissions
        chmod 600 "$GOOGLE_APPLICATION_CREDENTIALS"
        
        # Test credentials
        if command -v gcloud >/dev/null 2>&1; then
            echo "🧪 Testing Google Cloud credentials..."
            if gcloud auth application-default print-access-token >/dev/null 2>&1; then
                echo "✅ Google Cloud credentials are valid"
            else
                echo "⚠️ Warning: Google Cloud credentials test failed"
            fi
        fi
    else
        echo "⚠️ Warning: Google Cloud credentials file not found at $GOOGLE_APPLICATION_CREDENTIALS"
    fi
fi

# Setup workspace directory
echo "📁 Setting up workspace directory..."
WORKSPACE_DIR="/workspace"
mkdir -p "$WORKSPACE_DIR"
cd "$WORKSPACE_DIR"

# Set proper permissions for workspace
chmod 755 "$WORKSPACE_DIR"

echo "✅ Workspace directory ready: $WORKSPACE_DIR"

# Log container information
echo "📊 Container Information:"
echo "  - Session Key: $SESSION_KEY"
echo "  - Username: $USERNAME"
echo "  - Repository: $REPOSITORY_URL"
echo "  - Recovery Mode: ${RECOVERY_MODE:-false}"
echo "  - Working Directory: $(pwd)"
echo "  - Container Hostname: $(hostname)"
echo "  - Container Memory Limit: $(cat /sys/fs/cgroup/memory.max 2>/dev/null || echo 'unknown')"
echo "  - Container CPU Limit: $(cat /sys/fs/cgroup/cpu.max 2>/dev/null || echo 'unknown')"

# Check available tools
echo "🔧 Checking available tools..."
tools_to_check=(
    "node"
    "bun" 
    "git"
    "claude"
    "curl"
    "jq"
)

for tool in "${tools_to_check[@]}"; do
    if command -v "$tool" >/dev/null 2>&1; then
        version=$(timeout 5 "$tool" --version 2>/dev/null | head -1 || echo "unknown")
        echo "  ✅ $tool: $version"
    else
        echo "  ❌ $tool: not available"
    fi
done

# Check Claude CLI specifically
echo "🤖 Checking Claude CLI installation..."
if command -v claude >/dev/null 2>&1; then
    claude_version=$(timeout 10 claude --version 2>/dev/null || echo "unknown")
    echo "  ✅ Claude CLI: $claude_version"
    
    # Test Claude CLI basic functionality
    if timeout 10 claude --help >/dev/null 2>&1; then
        echo "  ✅ Claude CLI is functional"
    else
        echo "  ⚠️ Warning: Claude CLI help test failed"
    fi
    
    # Setup MCP server configuration for Claude Code
    echo "🔧 Configuring MCP servers for Claude Code..."
    if [ -f "/app/packages/worker/mcp-config.json" ]; then
        mkdir -p /home/claude/.claude
        cp /app/packages/worker/mcp-config.json /home/claude/.claude/settings.mcp.json
        echo "  ✅ MCP server configuration deployed to /home/claude/.claude/settings.mcp.json"
        
        # Also ensure the MCP server is executable
        if [ -f "/app/packages/worker/dist/mcp/process-manager-server.mjs" ]; then
            chmod +x /app/packages/worker/dist/mcp/process-manager-server.mjs
            echo "  ✅ MCP server made executable"
        fi
    else
        echo "  ⚠️ Warning: MCP config file not found"
    fi
else
    echo "  ❌ Error: Claude CLI not found in PATH"
    echo "  PATH: $PATH"
    exit 1
fi

# Setup git global configuration
echo "⚙️ Setting up git configuration..."
git config --global user.name "Claude Code Worker"
git config --global user.email "claude-code-worker@noreply.github.com"
git config --global init.defaultBranch main
git config --global pull.rebase false
git config --global safe.directory '*'

echo "✅ Git configuration completed"

# Display final status
echo "🎯 Starting worker execution..."
echo "  - Session: ${SESSION_KEY:-unknown}"
echo "  - User ID: ${USER_ID:-unknown}"  
echo "  - Timeout: 5 minutes (managed by orchestrator)"
echo "  - Recovery: ${RECOVERY_MODE:-false}"

# Make scripts executable
chmod +x /app/scripts/*.sh 2>/dev/null || true

# Setup MCP server
/app/packages/worker/scripts/setup-mcp-server.sh || echo "⚠️  MCP server setup failed or not found"

# Check if we need to build (dev mode or if dist does not exist)
if [ "${BUILD_MODE:-prod}" = "dev" ] || [ ! -d "/app/packages/worker/dist" ]; then
    echo "Building packages..."
    cd /app/packages/shared && bun run build
    cd /app/packages/worker && bun run build
    chmod +x /app/packages/worker/dist/mcp/process-manager-server.mjs 2>/dev/null || true
fi

# Start the worker process
echo "🚀 Executing Claude Worker..."
cd /app/packages/worker
exec bun run dist/index.js