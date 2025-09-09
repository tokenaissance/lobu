# Community Kubernetes Deployment

This deployment is provider-agnostic and works with any Kubernetes cluster. The Terraform configuration in this directory provisions infrastructure on Hetzner Cloud, but the application deployment itself works on any Kubernetes.

## Helm Values Configuration

The deployment uses **`charts/peerbot/values-community.yaml`** which includes:

- **Ingress**: Configured for Traefik (K3s default)
- **Storage**: Uses Hetzner CSI driver (`hcloud-volumes` storage class)
- **Database**: PostgreSQL with 10Gi persistent volume
- **Redis**: For caching/queuing with 2Gi persistent volume
- **Resources**: Conservative limits suitable for community deployment

## Secrets Required

The workflow pulls secrets from GitHub Secrets and injects them into Helm:

### Infrastructure Secrets (Required)
- `HCLOUD_TOKEN` - Hetzner Cloud API token
- `R2_BUCKET_NAME` - Cloudflare R2 bucket for Terraform state
- `R2_ACCESS_KEY_ID` - R2 access key
- `R2_SECRET_ACCESS_KEY` - R2 secret key
- `R2_ENDPOINT` - Auto-generated from account ID

### Application Secrets (Optional but recommended)
- `GITHUB_CLIENT_ID` - GitHub OAuth app client ID
- `GITHUB_CLIENT_SECRET` - GitHub OAuth app secret
- `ENCRYPTION_KEY` - For encrypting sensitive data
- `SLACK_BOT_TOKEN` - Slack bot user OAuth token (xoxb-...)
- `SLACK_APP_TOKEN` - Slack app-level token (xapp-...)
- `SLACK_SIGNING_SECRET` - For verifying Slack requests
- `SLACK_CLIENT_ID` - Slack OAuth client ID
- `SLACK_CLIENT_SECRET` - Slack OAuth client secret
- `SLACK_STATE_SECRET` - Random string for OAuth state

## Quick Setup

```bash
# 1. Run the setup script to configure all secrets
./scripts/setup-github-secrets.sh

# 2. Deploy from main branch
gh workflow run deploy-community.yml

# 3. Or deploy from specific branch
gh workflow run deploy-community.yml --ref your-branch
```

## Customizing Domain

Edit `charts/peerbot/values-community.yaml` and update:
- `ingress.hosts[0].host` - Your domain
- `ingress.tls[0].hosts[0]` - Your domain
- `config.ingressUrl` - Your full URL

## Files Explained

- **kube.tf** - Terraform configuration for infrastructure (Hetzner-specific)
- **values-community.yaml** - Helm values for community deployment (Kubernetes-agnostic)
- **deploy-community.yml** - GitHub Actions workflow (works with any Kubernetes)
- **setup-github-secrets.sh** - Interactive script to set GitHub secrets (provider-agnostic)
- **hcloud-microos-snapshots.pkr.hcl** - OPTIONAL: Packer config for custom OS images (Hetzner-specific, not needed)

## Monitoring

After deployment:
```bash
# Get kubeconfig from Terraform
terraform output -raw kubeconfig > kubeconfig.yaml
export KUBECONFIG=$(pwd)/kubeconfig.yaml

# Check pods
kubectl get pods -n peerbot

# Check services
kubectl get svc -n peerbot

# View logs
kubectl logs -n peerbot deployment/peerbot-dispatcher
kubectl logs -n peerbot deployment/peerbot-worker
```