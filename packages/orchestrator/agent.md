# Orchestrator Agent Instructions

## Package Overview
Worker deployment and lifecycle management. Handles Docker/Kubernetes orchestration.

## Core Files & Responsibilities

### Deployment Managers (`src/base/`, `src/docker/`, `src/k8s/`)
- `BaseDeploymentManager.ts`: Abstract deployment interface
- `DockerDeploymentManager.ts`: Docker Compose deployments (local dev)
- `K8sDeploymentManager.ts`: Kubernetes deployments (production)

### Secret Management
- `BaseSecretManager.ts`: Abstract secret interface
- `PostgresSecretManager.ts`: Database-backed secrets (encrypted)
- `K8sSecretManager.ts`: Kubernetes native secrets

### Queue Processing (`src/task-queue-consumer.ts`)
- Consumes `worker_deployment` queue from dispatcher
- Creates worker deployments with consistent naming
- Reports deployment status back via queues

## PostgreSQL Tables
- `users`: Platform user isolation via RLS
- `user_environ`: Encrypted environment variables for workers

## Critical Architecture Rules
- **One thread = One worker**: Creates `peerbot-worker-{userId}-{threadId}` deployments
- Workers get persistent volumes at `/workspace` for session continuity
- Auto-cleanup idle workers to prevent resource leaks

## Environment Variables
- `DATABASE_URL`: PostgreSQL connection
- `DEPLOYMENT_MODE`: Force docker/kubernetes mode
- `KUBERNETES_NAMESPACE`: K8s deployment namespace
- `WORKER_IMAGE_*`: Worker container configuration
- `WORKER_IDLE_CLEANUP_MINUTES`: Cleanup interval