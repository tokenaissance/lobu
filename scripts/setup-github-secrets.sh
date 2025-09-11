#!/bin/bash

# Setup GitHub Secrets for OVH Kubernetes Deployment
# This script configures GitHub repository secrets needed for deployment

set -e

# Check if gh CLI is installed
if ! command -v gh &> /dev/null; then
    echo "❌ GitHub CLI (gh) is not installed. Please install it first:"
    echo "   brew install gh"
    exit 1
fi

# Check if authenticated
if ! gh auth status &> /dev/null; then
    echo "❌ Not authenticated with GitHub. Please run:"
    echo "   gh auth login"
    exit 1
fi

# Load environment variables
if [ -f .env ]; then
    source .env
else
    echo "❌ .env file not found. Please run 'make setup' first."
    exit 1
fi

# Get repository name
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
if [ -z "$REPO" ]; then
    echo "❌ Could not determine repository. Make sure you're in a git repository."
    exit 1
fi

echo "🔧 Setting up GitHub secrets for repository: $REPO"
echo ""

# Function to set secret
set_secret() {
    local name=$1
    local value=$2
    local environment=$3
    
    if [ -z "$value" ]; then
        echo "⚠️  Skipping $name (empty value)"
        return
    fi
    
    if [ -n "$environment" ]; then
        echo "   Setting $name in environment: $environment"
        echo "$value" | gh secret set "$name" --env "$environment" -R "$REPO" 2>/dev/null || {
            echo "   ⚠️  Failed to set $name - environment might not exist"
        }
    else
        echo "   Setting $name"
        echo "$value" | gh secret set "$name" -R "$REPO"
    fi
}

echo "📦 Setting up repository-level secrets (non-sensitive)..."

# Docker Hub credentials (needed for docker-publish workflow)
set_secret "DOCKER_USERNAME" "${DOCKER_USERNAME:-peerbot}"
set_secret "DOCKER_PASSWORD" "$DOCKER_PASSWORD"

echo ""
echo "📦 Setting up environment-specific secrets (community)..."

# Kubeconfig (base64 encoded) - only in community environment
if [ -f /tmp/kubeconfig-base64.txt ]; then
    KUBE_CONFIG=$(cat /tmp/kubeconfig-base64.txt)
else
    echo "⚠️  Kubeconfig not found. Encoding from Downloads..."
    if [ -f ~/Downloads/kubeconfig.yml ]; then
        KUBE_CONFIG=$(cat ~/Downloads/kubeconfig.yml | base64 | tr -d '\n')
    else
        echo "❌ No kubeconfig found. Please add it manually."
        KUBE_CONFIG=""
    fi
fi

if [ -n "$KUBE_CONFIG" ]; then
    set_secret "KUBE_CONFIG" "$KUBE_CONFIG" "community"
fi

# All sensitive secrets go only in the community environment
set_secret "SLACK_BOT_TOKEN" "$SLACK_BOT_TOKEN" "community"
set_secret "SLACK_APP_TOKEN" "$SLACK_APP_TOKEN" "community"
set_secret "SLACK_SIGNING_SECRET" "$SLACK_SIGNING_SECRET" "community"
set_secret "GH_TOKEN_PEERBOT" "$GITHUB_TOKEN" "community"
set_secret "CLAUDE_CODE_OAUTH_TOKEN" "$CLAUDE_CODE_OAUTH_TOKEN" "community"
set_secret "POSTGRESQL_PASSWORD" "${POSTGRESQL_PASSWORD:-peerbot123}" "community"

# Optional: GitHub OAuth (if configured)
if [ -n "$GITHUB_CLIENT_ID" ]; then
    set_secret "GH_CLIENT_ID" "$GITHUB_CLIENT_ID" "community"
fi

if [ -n "$GITHUB_CLIENT_SECRET" ]; then
    set_secret "GH_CLIENT_SECRET" "$GITHUB_CLIENT_SECRET" "community"
fi

# Optional: Encryption key
if [ -n "$ENCRYPTION_KEY" ]; then
    set_secret "ENCRYPTION_KEY" "$ENCRYPTION_KEY" "community"
fi

echo ""
echo "✅ GitHub secrets configuration complete!"
echo ""
echo "📝 Next steps:"
echo "1. Verify secrets are set correctly:"
echo "   gh secret list -R $REPO"
echo ""
echo "2. If you have environments configured, set them up:"
echo "   gh secret list --env community -R $REPO"
echo ""
echo "3. Trigger deployment workflow:"
echo "   gh workflow run deploy-community.yml"
echo ""
echo "4. Or push to main branch to trigger automatic deployment"
echo ""

# Clean up temporary file
rm -f /tmp/kubeconfig-base64.txt