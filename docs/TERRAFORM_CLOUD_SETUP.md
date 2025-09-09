# Terraform Cloud Setup for State Management

Due to TLS compatibility issues between GitHub Actions and Cloudflare R2, we recommend using Terraform Cloud for state management.

## Why Terraform Cloud?

1. **Free tier**: Up to 500 resources per month
2. **No TLS issues**: Works seamlessly with GitHub Actions
3. **State locking**: Built-in state locking prevents conflicts
4. **State history**: Keeps history of all state changes
5. **Secure**: Encrypted state storage

## Setup Steps

### 1. Create Terraform Cloud Account

1. Go to [app.terraform.io](https://app.terraform.io/signup/account)
2. Sign up for a free account
3. Create an organization (e.g., `your-org-name`)

### 2. Create Workspace

1. Create a new workspace
2. Choose "CLI-driven workflow"
3. Name it `peerbot-hetzner`

### 3. Generate API Token

1. Go to User Settings > Tokens
2. Create an API token
3. Save it securely

### 4. Configure GitHub Secrets

```bash
# Set Terraform Cloud token in GitHub
gh secret set TF_API_TOKEN --body "your-terraform-cloud-token" --repo owner/repo
```

### 5. Update Backend Configuration

The GitHub Actions workflow will use:

```hcl
terraform {
  cloud {
    organization = "your-org-name"
    
    workspaces {
      name = "peerbot-hetzner"
    }
  }
}
```

## Alternative: GitHub as State Backend

If you prefer to keep everything in GitHub, you can use a GitHub repository as a state backend:

1. Create a private repository for state (e.g., `peerbot-tfstate`)
2. Use GitHub Actions to read/write state as artifacts
3. Implement locking using GitHub Actions concurrency

## Alternative: Use S3 (non-R2)

If you have AWS access, standard S3 works without TLS issues:

```hcl
terraform {
  backend "s3" {
    bucket = "your-s3-bucket"
    key    = "hetzner/terraform.tfstate"
    region = "us-east-1"
  }
}
```

## Decision Matrix

| Backend | Pros | Cons | Recommended for |
|---------|------|------|-----------------|
| Terraform Cloud | Free, reliable, no TLS issues | External dependency | Production use |
| GitHub Artifacts | No external deps, free | Complex setup | GitHub-only teams |
| AWS S3 | Battle-tested, reliable | AWS account required | AWS users |
| Cloudflare R2 | S3-compatible, Cloudflare integration | TLS issues with GitHub Actions | Local development only |

## Recommendation

For production use with GitHub Actions, we recommend **Terraform Cloud** due to:
- Zero configuration TLS issues
- Free tier sufficient for small infrastructures
- Professional state management features
- Easy integration with GitHub Actions