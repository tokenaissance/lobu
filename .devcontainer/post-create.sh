#!/bin/bash
set -e

echo "🚀 Setting up Peerbot development environment..."

# Fix permissions for node_modules volume
sudo chown -R node:node /workspace/node_modules || true

# Install dependencies as node user
echo "📦 Installing dependencies with Bun..."
sudo -u node bun install

# Build packages as node user
echo "🔨 Building packages..."
sudo -u node bash -c "cd packages/shared && bun run build"
sudo -u node bash -c "cd packages/worker && bun run build"
sudo -u node bash -c "cd packages/dispatcher && bun run build"
sudo -u node bash -c "cd packages/orchestrator && bun run build"

# Setup shell environment
echo "🔧 Setting up shell environment..."
cat >> /home/node/.bashrc << 'EOF'

# Peerbot Development Environment
export PATH="/usr/local/bun/bin:$PATH"
export BUN_INSTALL="/usr/local/bun"
export PATH="/home/node/.npm-global/bin:$PATH"

# Kubernetes aliases
alias k="kubectl"
alias kp="kubectl get pods"
alias kl="kubectl logs"
alias kd="kubectl describe"
alias ka="kubectl apply -f"
alias kx="kubectl exec -it"

# Skaffold aliases
alias sk="skaffold"
alias skd="skaffold dev"
alias skb="skaffold build"
EOF

# Setup npm global directory as node user
sudo -u node npm config set prefix /home/node/.npm-global
sudo -u node mkdir -p /home/node/.npm-global

# Setup Claude Code MCP configuration
echo "🤖 Setting up Claude Code MCP server..."
if [ -f "/workspace/packages/worker/mcp-config.json" ]; then
    mkdir -p /home/node/.claude
    cp /workspace/packages/worker/mcp-config.json /home/node/.claude/settings.mcp.json
    echo "✅ MCP server configuration deployed"
fi

# Setup k3s if needed (only if not in Docker-in-Docker)
if command -v k3s &> /dev/null; then
    echo "☸️ Setting up k3s..."
    sudo k3s server --write-kubeconfig-mode 644 --disable traefik --disable metrics-server &
    sleep 10
    sudo cp /etc/rancher/k3s/k3s.yaml /home/node/.kube/config
    sudo chown node:node /home/node/.kube/config
    echo "✅ k3s is running"
fi

# Create namespace if kubectl is available
if command -v kubectl &> /dev/null; then
    echo "📊 Creating peerbot namespace..."
    kubectl create namespace peerbot 2>/dev/null || true
fi

# Setup environment files
echo "🔧 Setting up environment files..."
if [ ! -f ".env" ] && [ -f ".env.example" ]; then
    cp .env.example .env
    echo "✅ Created .env from .env.example"
fi

if [ ! -f ".env.qa" ] && [ -f ".env.qa.example" ]; then
    cp .env.qa.example .env.qa
    echo "✅ Created .env.qa from .env.qa.example"
fi

# Create CLAUDE.md if it doesn't exist
if [ ! -f "CLAUDE.md" ]; then
    cat > CLAUDE.md << 'EOF'
# CLAUDE.md - DevContainer Environment

This is a development environment for the Peerbot running in a VS Code DevContainer.

## Available Commands

- `make dev` - Start Skaffold development mode with hot reload
- `make k3s-setup` - Setup k3s cluster (if needed)
- `make k3s-install` - Install the application to k3s
- `./test-bot.js "message"` - Test the bot with a message

## Environment

- Bun package manager installed
- Claude Code CLI available globally
- Kubernetes tools (kubectl, helm, skaffold) installed
- PostgreSQL client available
- MCP Process Manager server configured

## MCP Server

The MCP process manager server is available with these tools:
- start_process
- stop_process
- restart_process
- get_process_status
- get_process_logs

EOF
    echo "✅ Created CLAUDE.md"
fi

# Display helpful information
echo ""
echo "✨ DevContainer setup complete!"
echo ""
echo "📚 Quick Start Guide:"
echo "  1. Configure your .env file with Slack and GitHub tokens"
echo "  2. Run 'make dev' to start development with Skaffold"
echo "  3. Use './test-bot.js \"your message\"' to test the bot"
echo ""
echo "🛠️ Available Tools:"
echo "  - Claude Code CLI: $(claude --version 2>/dev/null || echo 'Run: npm install -g @anthropic-ai/claude-code')"
echo "  - Bun: $(bun --version)"
echo "  - Node: $(node --version)"
echo "  - Kubectl: $(kubectl version --client --short 2>/dev/null || echo 'Not available')"
echo "  - Skaffold: $(skaffold version 2>/dev/null || echo 'Not available')"
echo ""
echo "💡 Tips:"
echo "  - The MCP process manager is configured for Claude Code"
echo "  - Use 'k' as alias for kubectl (k get pods, k logs, etc.)"
echo "  - Ports 3000-3002, 5432-5433, 8080-8081 are forwarded"
echo ""