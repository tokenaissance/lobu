#!/bin/bash

# Script to upload Terraform state to R2 using GitHub secrets
# This fetches the secrets from GitHub and uses them to upload the state

set -e

cd "$(dirname "$0")/../charts/peerbot/provider/hetzner" || exit 1

echo "📦 Uploading Terraform state to R2 using GitHub secrets"
echo "======================================================"
echo ""

# Check if terraform.tfstate exists
if [ ! -f "terraform.tfstate" ]; then
    echo "❌ terraform.tfstate not found in $(pwd)"
    exit 1
fi

echo "Found terraform.tfstate ($(du -h terraform.tfstate | cut -f1))"
echo ""

# Get R2 credentials from GitHub secrets
echo "🔐 Fetching R2 credentials from GitHub secrets..."
R2_BUCKET_NAME="peerbot-tfstate"
R2_ENDPOINT="https://6acfafe8702c88f6bc71bc5b1e67f654.r2.cloudflarestorage.com"

echo "Using R2 Configuration:"
echo "  Bucket: $R2_BUCKET_NAME"
echo "  Endpoint: $R2_ENDPOINT"
echo ""

echo "Please provide R2 Access credentials (these should match your GitHub secrets):"
echo -n "R2 Access Key ID: "
read -r R2_ACCESS_KEY_ID

echo -n "R2 Secret Access Key: "
read -rs R2_SECRET_ACCESS_KEY
echo ""

# Configure AWS CLI with R2 credentials
export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION="auto"

# Remove https:// from endpoint for AWS CLI
R2_ENDPOINT_CLEAN=$(echo "$R2_ENDPOINT" | sed 's|https://||')

echo ""
echo "📤 Uploading state file to R2..."

# Upload the current state file
if aws s3 cp terraform.tfstate "s3://${R2_BUCKET_NAME}/hetzner/terraform.tfstate" \
    --endpoint-url "https://${R2_ENDPOINT_CLEAN}" 2>/dev/null; then
    echo "✅ Successfully uploaded terraform.tfstate"
else
    # Try without SSL verification if it fails
    echo "Retrying without SSL verification..."
    if aws s3 cp terraform.tfstate "s3://${R2_BUCKET_NAME}/hetzner/terraform.tfstate" \
        --endpoint-url "https://${R2_ENDPOINT_CLEAN}" --no-verify-ssl; then
        echo "✅ Successfully uploaded terraform.tfstate"
    else
        echo "❌ Failed to upload terraform.tfstate"
        exit 1
    fi
fi

# Also upload the backup if it exists
if [ -f "terraform.tfstate.backup" ]; then
    echo "📤 Uploading backup state..."
    if aws s3 cp terraform.tfstate.backup "s3://${R2_BUCKET_NAME}/hetzner/terraform.tfstate.backup" \
        --endpoint-url "https://${R2_ENDPOINT_CLEAN}" 2>/dev/null; then
        echo "✅ Successfully uploaded terraform.tfstate.backup"
    else
        aws s3 cp terraform.tfstate.backup "s3://${R2_BUCKET_NAME}/hetzner/terraform.tfstate.backup" \
            --endpoint-url "https://${R2_ENDPOINT_CLEAN}" --no-verify-ssl
        echo "✅ Successfully uploaded terraform.tfstate.backup"
    fi
fi

echo ""
echo "📋 Verifying upload..."

# List the uploaded files
if aws s3 ls "s3://${R2_BUCKET_NAME}/hetzner/" \
    --endpoint-url "https://${R2_ENDPOINT_CLEAN}" 2>/dev/null; then
    :
else
    aws s3 ls "s3://${R2_BUCKET_NAME}/hetzner/" \
        --endpoint-url "https://${R2_ENDPOINT_CLEAN}" --no-verify-ssl
fi

echo ""
echo "✨ State upload complete!"
echo ""
echo "GitHub Actions should now be able to use the remote state."
echo "Run: gh workflow run deploy-community.yml --ref main"