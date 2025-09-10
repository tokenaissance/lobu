# Hetzner K3s Infrastructure for PeerBot Community

This directory contains Terraform configuration for deploying a K3s Kubernetes cluster on Hetzner Cloud for the PeerBot community deployment.

## Architecture

- **3 Control Plane Nodes**: High availability across different regions (FSN1, NBG1, HEL1)
- **1 Worker Node**: For running application workloads
- **1 Egress Node**: Dedicated node with floating IP for outbound traffic
- **Load Balancer**: For distributing traffic to control plane nodes
- **Private Network**: Secure communication between nodes

## Files to Commit

✅ **COMMIT these files:**
- `kube.tf` - Main Terraform configuration
- `.gitignore` - Prevents sensitive files from being committed
- `README.md` - This documentation
- `hcloud-microos-snapshots.pkr.hcl` - Packer configuration (if using custom images)

❌ **NEVER COMMIT these files:**
- `*.tfstate` - Contains sensitive infrastructure state
- `*.tfstate.*` - Terraform state backups
- `.terraform/` - Provider plugins directory
- `.env` - Environment variables with secrets
- `*kubeconfig.yaml` - Kubernetes credentials
- `*.tfvars` - Variable files that may contain secrets

## CI/CD Setup

### Prerequisites

1. **Hetzner Cloud Account**: Get an API token from Hetzner Cloud Console
2. **S3-Compatible Storage**: For Terraform state (options below)
3. **GitHub Repository**: With Actions enabled

### S3 Backend Options for Terraform State

Choose one of these S3-compatible services:

- **Backblaze B2** (Recommended - 10GB free)
  - Endpoint: `s3.us-west-002.backblaze.com`
  - Region: `us-west-002`

- **Wasabi** (Cheap, no egress fees)
  - Endpoint: `s3.eu-central-003.wasabisys.com`
  - Region: `eu-central-003`

- **DigitalOcean Spaces**
  - Endpoint: `fra1.digitaloceanspaces.com`
  - Region: `fra1`

### About hcloud-microos-snapshots.pkr.hcl

This Packer file is **optional** and only needed if you want to build custom MicroOS images. The Terraform configuration already uses pre-built MicroOS snapshots, so you can ignore this file for normal deployments.

### Setting up GitHub Secrets

Run the setup script:
```bash
./scripts/setup-github-secrets.sh
```

This will configure the following secrets via gh CLI:

- `HCLOUD_TOKEN` - Hetzner Cloud API token
 

### Deployment Workflow

1. **Commit infrastructure files** (to any branch):
   ```bash
   git add charts/peerbot/provider/hetzner/kube.tf
   git add charts/peerbot/provider/hetzner/.gitignore
   git add charts/peerbot/provider/hetzner/README.md
   git add .github/workflows/deploy-community.yml
   git add scripts/setup-github-secrets.sh
   git commit -m "Add Hetzner K3s infrastructure"
   git push origin main
   ```

2. **Trigger deployment manually**:
   ```bash
   # Deploy from main branch
   gh workflow run deploy-community.yml
   
   # Deploy from a specific branch
   gh workflow run deploy-community.yml --ref your-branch
   
   # Or via repository dispatch
   gh api repos/OWNER/REPO/dispatches \
     --raw-field event_type=deploy-community \
     --raw-field client_payload='{"branch":"main"}'
   ```

3. **Monitor deployment**:
   ```bash
   gh run watch
   ```

### Workflow Stages

The GitHub Actions workflow (`deploy-community.yml`) performs:

1. **Terraform Stage**:
   - Initializes Terraform with S3 backend
   - Plans infrastructure changes
   - Applies changes (only on push to `community-prod`)
   - Manages K3s cluster lifecycle

2. **Build & Deploy Stage**:
   - Builds Docker images for all services
   - Pushes to GitHub Container Registry
   - Deploys to K3s using Helm
   - Verifies deployment status

## Local Development

To work with the infrastructure locally:

1. **Export Hetzner token**:
   ```bash
   export HCLOUD_TOKEN="your-token-here"
   ```

2. **Initialize Terraform**:
   ```bash
   terraform init
   ```

3. **Plan changes**:
   ```bash
   terraform plan
   ```

4. **Apply changes**:
   ```bash
   terraform apply
   ```

5. **Get kubeconfig**:
   ```bash
   terraform output -raw kubeconfig > kubeconfig.yaml
   export KUBECONFIG=$(pwd)/kubeconfig.yaml
   ```

## Managing the Cluster

### Access the cluster:
```bash
kubectl --kubeconfig=kubeconfig.yaml get nodes
```

### Scale nodes:
Edit `kube.tf` and adjust the `agent_nodepools` configuration, then apply changes.

### Destroy infrastructure:
```bash
terraform destroy
```

## Security Considerations

- All nodes use private networking
- Firewall rules restrict access to necessary ports only
- SSH keys are managed by Terraform
- Secrets are stored in GitHub Secrets, never in code
- Terraform state is encrypted in S3 backend

## Troubleshooting

### Kustomization fails
The kured manifest URL sometimes fails. This is handled in the workflow but can be manually fixed by:
```bash
ssh root@<control-plane-ip> "sed -i '/kured.*yaml/d' /var/post_install/kustomization.yaml && kubectl apply -k /var/post_install"
```

### State lock issues
If Terraform state is locked, check for running workflows and wait for completion or manually unlock if needed.

## Cost Estimation

Monthly costs (approximate):
- 3x CPX11 (Control Plane): ~€12
- 1x CPX11 (Worker): ~€4
- 1x CX11 (Egress): ~€4
- Load Balancer: ~€6
- Floating IP: ~€1
- **Total**: ~€27/month

## Support

For issues or questions, please open an issue in the GitHub repository.
