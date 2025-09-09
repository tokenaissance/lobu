#!/bin/bash

# Quick script to upload tfstate to R2

set -e

cd charts/peerbot/provider/hetzner

echo "📦 Uploading Terraform state to R2"
echo "=================================="
echo ""
echo "R2 Configuration:"
echo "  Bucket: peerbot-tfstate"
echo "  Endpoint: https://6acfafe8702c88f6bc71bc5b1e67f654.r2.cloudflarestorage.com"
echo ""
echo "Enter your R2 credentials (same as GitHub secrets):"
read -p "R2 Access Key ID: " AWS_ACCESS_KEY_ID
read -s -p "R2 Secret Access Key: " AWS_SECRET_ACCESS_KEY
echo ""

export AWS_ACCESS_KEY_ID
export AWS_SECRET_ACCESS_KEY
export AWS_DEFAULT_REGION="auto"

echo ""
echo "📤 Uploading..."

# Upload with retry
for i in {1..3}; do
    if aws s3 cp terraform.tfstate s3://peerbot-tfstate/hetzner/terraform.tfstate \
        --endpoint-url https://6acfafe8702c88f6bc71bc5b1e67f654.r2.cloudflarestorage.com \
        --no-verify-ssl 2>/dev/null; then
        echo "✅ Upload successful!"
        break
    else
        echo "Attempt $i failed, retrying..."
        sleep 2
    fi
done

# Upload backup too
if [ -f terraform.tfstate.backup ]; then
    aws s3 cp terraform.tfstate.backup s3://peerbot-tfstate/hetzner/terraform.tfstate.backup \
        --endpoint-url https://6acfafe8702c88f6bc71bc5b1e67f654.r2.cloudflarestorage.com \
        --no-verify-ssl 2>/dev/null || true
fi

echo ""
echo "📋 Verifying..."
aws s3 ls s3://peerbot-tfstate/hetzner/ \
    --endpoint-url https://6acfafe8702c88f6bc71bc5b1e67f654.r2.cloudflarestorage.com \
    --no-verify-ssl 2>/dev/null || echo "Listing skipped"

echo ""
echo "✨ Done! You can now run:"
echo "gh workflow run deploy-community.yml --ref main"