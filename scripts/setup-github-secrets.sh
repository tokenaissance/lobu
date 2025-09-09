#!/bin/bash

# Generic script to setup GitHub secrets for Kubernetes deployments
# Provider-agnostic - works with any Kubernetes infrastructure

set -e

echo "🚀 Setting up GitHub secrets for Kubernetes deployment"
echo "======================================================"

# Check if gh CLI is installed
if ! command -v gh &> /dev/null; then
    echo "❌ GitHub CLI (gh) is not installed. Please install it first:"
    echo "   brew install gh"
    exit 1
fi

# Check if authenticated
if ! gh auth status &> /dev/null; then
    echo "❌ Please authenticate with GitHub first:"
    echo "   gh auth login"
    exit 1
fi

# Get current repository
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner || echo "")
if [ -z "$REPO" ]; then
    echo "❌ Could not determine repository. Make sure you're in a git repository."
    exit 1
fi

echo "📦 Repository: $REPO"
echo ""

# Infrastructure Provider Selection
echo "☁️  Select your infrastructure provider:"
echo "1) Hetzner Cloud"
echo "2) AWS"
echo "3) Google Cloud"
echo "4) Azure"
echo "5) DigitalOcean"
echo "6) Other/Custom"
read -p "Enter choice [1-6]: " PROVIDER_CHOICE

case $PROVIDER_CHOICE in
    1)
        echo ""
        echo "🔑 Hetzner Cloud Configuration"
        echo "=============================="
        echo "Enter your Hetzner Cloud API token:"
        read -s HCLOUD_TOKEN
        echo ""
        gh secret set HCLOUD_TOKEN --body "$HCLOUD_TOKEN" --repo "$REPO"
        echo "✅ Set HCLOUD_TOKEN"
        ;;
    2|3|4|5|6)
        echo ""
        echo "ℹ️  For other providers, configure infrastructure secrets manually"
        echo "   or add provider-specific configuration to this script"
        ;;
    *)
        echo "Invalid choice"
        exit 1
        ;;
esac

# Terraform State Backend (Optional)
echo ""
echo "📦 Terraform State Backend (Optional)"
echo "====================================="
echo "Do you need to configure Terraform state backend? (y/n)"
read -n 1 CONFIGURE_BACKEND
echo ""

if [ "$CONFIGURE_BACKEND" = "y" ]; then
    echo "Select backend type:"
    echo "1) Cloudflare R2"
    echo "2) AWS S3"
    echo "3) Azure Blob Storage"
    echo "4) Google Cloud Storage"
    echo "5) Other S3-compatible"
    read -p "Enter choice [1-5]: " BACKEND_CHOICE
    
    case $BACKEND_CHOICE in
        1)
            echo "Enter your Cloudflare account ID:"
            read CLOUDFLARE_ACCOUNT_ID
            R2_ENDPOINT="https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com"
            
            echo "Enter R2 bucket name:"
            read R2_BUCKET_NAME
            
            echo "Enter R2 Access Key ID:"
            read R2_ACCESS_KEY_ID
            
            echo "Enter R2 Secret Access Key:"
            read -s R2_SECRET_ACCESS_KEY
            echo ""
            
            gh secret set R2_BUCKET_NAME --body "$R2_BUCKET_NAME" --repo "$REPO"
            gh secret set R2_ACCESS_KEY_ID --body "$R2_ACCESS_KEY_ID" --repo "$REPO"
            gh secret set R2_SECRET_ACCESS_KEY --body "$R2_SECRET_ACCESS_KEY" --repo "$REPO"
            gh secret set R2_ENDPOINT --body "$R2_ENDPOINT" --repo "$REPO"
            echo "✅ Configured Cloudflare R2 backend"
            ;;
        *)
            echo "ℹ️  Configure other backends manually in GitHub Secrets"
            ;;
    esac
fi

# Application Secrets
echo ""
echo "🔐 Application Secrets"
echo "====================="
echo "Configure application-specific secrets (press Enter to skip any):"
echo ""

# GitHub OAuth
echo "GitHub OAuth Client ID:"
read GITHUB_CLIENT_ID
if [ -n "$GITHUB_CLIENT_ID" ]; then
    gh secret set GITHUB_CLIENT_ID --body "$GITHUB_CLIENT_ID" --repo "$REPO"
    echo "✅ Set GITHUB_CLIENT_ID"
fi

echo "GitHub OAuth Client Secret:"
read -s GITHUB_CLIENT_SECRET
echo ""
if [ -n "$GITHUB_CLIENT_SECRET" ]; then
    gh secret set GITHUB_CLIENT_SECRET --body "$GITHUB_CLIENT_SECRET" --repo "$REPO"
    echo "✅ Set GITHUB_CLIENT_SECRET"
fi

# Encryption Key
echo "Encryption Key (for encrypting sensitive data):"
read -s ENCRYPTION_KEY
echo ""
if [ -n "$ENCRYPTION_KEY" ]; then
    gh secret set ENCRYPTION_KEY --body "$ENCRYPTION_KEY" --repo "$REPO"
    echo "✅ Set ENCRYPTION_KEY"
fi

# Slack Configuration
echo ""
echo "📱 Slack Configuration (optional)"
echo "================================="
echo "Configure Slack integration? (y/n)"
read -n 1 CONFIGURE_SLACK
echo ""

if [ "$CONFIGURE_SLACK" = "y" ]; then
    echo "Slack Bot Token (xoxb-...):"
    read -s SLACK_BOT_TOKEN
    echo ""
    if [ -n "$SLACK_BOT_TOKEN" ]; then
        gh secret set SLACK_BOT_TOKEN --body "$SLACK_BOT_TOKEN" --repo "$REPO"
        echo "✅ Set SLACK_BOT_TOKEN"
    fi
    
    echo "Slack App Token (xapp-...):"
    read -s SLACK_APP_TOKEN
    echo ""
    if [ -n "$SLACK_APP_TOKEN" ]; then
        gh secret set SLACK_APP_TOKEN --body "$SLACK_APP_TOKEN" --repo "$REPO"
        echo "✅ Set SLACK_APP_TOKEN"
    fi
    
    echo "Slack Signing Secret:"
    read -s SLACK_SIGNING_SECRET
    echo ""
    if [ -n "$SLACK_SIGNING_SECRET" ]; then
        gh secret set SLACK_SIGNING_SECRET --body "$SLACK_SIGNING_SECRET" --repo "$REPO"
        echo "✅ Set SLACK_SIGNING_SECRET"
    fi
    
    echo "Slack Client ID:"
    read SLACK_CLIENT_ID
    if [ -n "$SLACK_CLIENT_ID" ]; then
        gh secret set SLACK_CLIENT_ID --body "$SLACK_CLIENT_ID" --repo "$REPO"
        echo "✅ Set SLACK_CLIENT_ID"
    fi
    
    echo "Slack Client Secret:"
    read -s SLACK_CLIENT_SECRET
    echo ""
    if [ -n "$SLACK_CLIENT_SECRET" ]; then
        gh secret set SLACK_CLIENT_SECRET --body "$SLACK_CLIENT_SECRET" --repo "$REPO"
        echo "✅ Set SLACK_CLIENT_SECRET"
    fi
    
    echo "Slack State Secret (random string for OAuth):"
    read -s SLACK_STATE_SECRET
    echo ""
    if [ -n "$SLACK_STATE_SECRET" ]; then
        gh secret set SLACK_STATE_SECRET --body "$SLACK_STATE_SECRET" --repo "$REPO"
        echo "✅ Set SLACK_STATE_SECRET"
    fi
fi

echo ""
echo "✨ Secret configuration complete!"
echo ""
echo "📋 Next Steps:"
echo "=============="
echo ""
echo "1. Deploy using GitHub Actions:"
echo "   gh workflow run deploy-community.yml"
echo ""
echo "2. Or trigger via repository dispatch:"
echo "   gh api repos/$REPO/dispatches \\"
echo "     --raw-field event_type=deploy-community \\"
echo "     --raw-field client_payload='{\"branch\":\"main\"}'"
echo ""
echo "3. Monitor deployment:"
echo "   gh run watch"