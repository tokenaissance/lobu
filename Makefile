# Development Makefile for Peerbot

.PHONY: help setup build compile dev prod test clean logs restart deploy down build-packages check-build watch-packages

# Default target
help:
	@echo "Available commands:"
	@echo "  peerbot setup                              - Interactive setup for Slack bot development"
	@echo "  peerbot build-packages                     - Build all TypeScript packages (core, gateway, worker)"
	@echo "  peerbot check-build                        - Check if packages need rebuilding"
	@echo "  peerbot watch-packages                     - Watch packages and rebuild on changes (for development)"
	@echo "  peerbot dev                                - Start development with Docker Compose (hot reload)"
	@echo "  peerbot prod                               - Start production with Docker Compose"
	@echo "  peerbot down                               - Stop all services including dynamic workers"
	@echo "  peerbot logs                               - View Docker Compose service logs"
	@echo "  peerbot deploy                             - Deploy to K8s using values-local.yaml"
	@echo "  peerbot deploy --target=production         - Deploy to K8s using values-production.yaml"
	@echo "  peerbot deploy --target=path/to/values.yaml - Deploy to K8s using custom values file"
	@echo "  peerbot test                               - Run test bot"
	@echo "  peerbot clean                              - Stop all services and clean up all resources"

# Build all TypeScript packages in dependency order
build-packages:
	@echo "📦 Building all TypeScript packages..."
	@echo "   1️⃣  Building packages/core..."
	@cd packages/core && bun run build
	@echo "   2️⃣  Building packages/github..."
	@cd packages/github && bun run build
	@echo "   3️⃣  Building packages/gateway..."
	@cd packages/gateway && bun run build
	@echo "   4️⃣  Building packages/worker..."
	@cd packages/worker && bun run build
	@echo "✅ All packages built successfully!"

# Check if packages need rebuilding
check-build:
	@./scripts/check-build-status.sh

# Watch packages and rebuild on changes (for active development)
watch-packages:
	@./scripts/watch-packages.sh

# Start local development with Docker Compose in foreground
dev:
	@if [ ! -f .env ]; then \
		echo "❌ .env file not found!"; \
		echo ""; \
		echo "Please run setup first:"; \
		echo "  make setup"; \
		echo ""; \
		exit 1; \
	fi
	@echo "ℹ️  Loading environment overrides from .env"
	@echo ""
	@echo "📦 Step 1/2: Building TypeScript packages..."
	@$(MAKE) build-packages
	@echo ""
	@echo "🚀 Step 2/2: Starting local development mode with Docker Compose..."
	@echo "   This will:"
	@echo "   - Build all services including worker image"
	@echo "   - Start services with hot reload"
	@echo "   - Mount source code for live changes"
	@echo ""
	@echo "🔨 Building all services..."
	@DETACH_FLAG=""; [ "$(DETACH)" = "1" ] && DETACH_FLAG="-d"; \
	if [ -n "$$DETACH_FLAG" ]; then echo "🧩 Running in detached mode"; fi; \
	COMPOSE_DOCKER_CLI_BUILD=1 DOCKER_BUILDKIT=1 docker compose -f docker-compose.dev.yml up $$DETACH_FLAG --build gateway redis

# Build the worker image on demand
build-worker:
	@echo "📦 Building worker image..."
	@COMPOSE_DOCKER_CLI_BUILD=1 DOCKER_BUILDKIT=1 docker compose -f docker-compose.dev.yml build worker

# Convenience alias for detached dev
.PHONY: dev-d dev-detached
dev-d dev-detached:
	@$(MAKE) dev DETACH=1

# Catch-all target to prevent errors when passing arguments
%:
	@:

# Run test bot
test:
	@./scripts/test-bot.sh "@me test from make command"
# Deploy to Kubernetes
# Usage: make deploy [--target=environment]
deploy:
	@# Skip .env check in CI environment
	@if [ -z "$$GITHUB_ACTIONS" ] && [ ! -f .env ]; then \
		echo "❌ .env file not found!"; \
		echo ""; \
		echo "Please run setup first:"; \
		echo "  make setup"; \
		echo ""; \
		exit 1; \
	fi
	@# Use TARGET environment variable or make variable
	@if [ -n "$$TARGET" ] || [ -n "$(TARGET)" ]; then \
		TARGET_PATH="$${TARGET:-$(TARGET)}"; \
		if [ -f "$$TARGET_PATH" ]; then \
			VALUES_FILE="$$TARGET_PATH"; \
			echo "📋 Using custom values file: $$VALUES_FILE"; \
		elif [ -f "charts/peerbot/values-$$TARGET_PATH.yaml" ]; then \
			VALUES_FILE="charts/peerbot/values-$$TARGET_PATH.yaml"; \
			echo "📋 Using environment file: $$VALUES_FILE"; \
		else \
			echo "❌ Values file not found: $$TARGET_PATH"; \
			echo "❌ Also tried: charts/peerbot/values-$$TARGET_PATH.yaml"; \
			exit 1; \
		fi; \
	elif [ -f "charts/peerbot/values-local.yaml" ]; then \
		VALUES_FILE="charts/peerbot/values-local.yaml"; \
		echo "📋 Using existing $$VALUES_FILE"; \
	else \
		VALUES_FILE="charts/peerbot/values-local.yaml"; \
		echo "🔄 Creating $$VALUES_FILE from .env and base values.yaml..."; \
		cp "charts/peerbot/values.yaml" "$$VALUES_FILE"; \
		./bin/sync-env-to-values.sh local; \
	fi; \
	echo "🎯 Deploying using $$VALUES_FILE"; \
	echo "🚀 Building and deploying to K8s..."; \
	if [ -z "$$GITHUB_ACTIONS" ]; then \
		echo "📦 Building Docker images..."; \
		docker build -f Dockerfile.gateway -t peerbot-gateway:latest .; \
		docker build -f Dockerfile.worker -t peerbot-worker:latest .; \
	else \
		echo "📦 Using pre-built Docker images from registry..."; \
	fi; \
	if command -v kind >/dev/null 2>&1 && kind get clusters 2>/dev/null | grep -q kind; then \
		echo "📦 Loading images into kind..."; \
		kind load docker-image peerbot-gateway:latest; \
		kind load docker-image peerbot-worker:latest; \
	fi; \
	echo "🔧 Deploying with Helm..."; \
	if [ -z "$$GITHUB_ACTIONS" ]; then \
		set -a; source .env; set +a; \
	fi; \
	echo "📋 Final values file: $$VALUES_FILE"; \
	if [ -n "$$GITHUB_ACTIONS" ]; then \
		IMAGE_REPO="$${DOCKER_NAMESPACE:-peerbot}"; \
		IMAGE_TAG="$${IMAGE_TAG:-latest}"; \
		IMAGE_OVERRIDES="--set gateway.image.repository=$$IMAGE_REPO/peerbot-gateway \
			--set gateway.image.tag=$$IMAGE_TAG \
			--set worker.image.repository=$$IMAGE_REPO/peerbot-worker \
			--set worker.image.tag=$$IMAGE_TAG"; \
	else \
		IMAGE_OVERRIDES=""; \
	fi; \
	helm upgrade --install "$${DEPLOYMENT_NAME:-peerbot}" charts/peerbot/ \
		--dependency-update \
		--create-namespace \
		--namespace "$${NAMESPACE:-peerbot}" \
		-f "$$VALUES_FILE" \
		$$IMAGE_OVERRIDES \
		--set secrets.encryptionKey="$$ENCRYPTION_KEY" \
		--set secrets.slackBotToken="$$SLACK_BOT_TOKEN" \
		--set secrets.slackSigningSecret="$$SLACK_SIGNING_SECRET" \
		--set secrets.slackAppToken="$$SLACK_APP_TOKEN" \
		--set secrets.claudeCodeOAuthToken="$$CLAUDE_CODE_OAUTH_TOKEN" \
		--wait \
		--timeout "$${HELM_TIMEOUT:-10m}"
	@echo "✅ Deployed to K8s. Check status with:"
	@echo "  kubectl get pods -n $${NAMESPACE:-peerbot}"
	@echo "  kubectl logs -f deployment/$${DEPLOYMENT_NAME:-peerbot}-gateway -n $${NAMESPACE:-peerbot}"

# View logs based on deployment mode
logs:
	@# Read DEPLOYMENT_MODE from .env file
	@if [ -f .env ]; then \
		DEPLOYMENT_MODE=$$(grep "^DEPLOYMENT_MODE=" .env | cut -d'=' -f2 | tr -d ' '); \
	else \
		DEPLOYMENT_MODE="docker"; \
	fi; \
	if [ "$$DEPLOYMENT_MODE" = "kubernetes" ] || [ "$$DEPLOYMENT_MODE" = "k8s" ]; then \
		echo "☸️  Viewing Kubernetes logs..."; \
		echo "Select a pod to view logs:"; \
		kubectl get pods -n peerbot; \
		echo ""; \
		echo "View logs with:"; \
		echo "  kubectl logs -f <pod-name> -n peerbot"; \
	elif docker compose -f docker-compose.dev.yml ps --services 2>/dev/null | grep -q .; then \
		docker compose -f docker-compose.dev.yml logs -f; \
	else \
		docker compose logs -f; \
	fi

# Stop all services without removing volumes
down:
	@echo "🛑 Stopping all peerbot services and workers..."
	@# Stop and remove all containers with the peerbot project label (includes dynamic workers)
	@docker ps -q --filter "label=com.docker.compose.project=peerbot" | xargs -r docker stop 2>/dev/null || true
	@docker ps -aq --filter "label=com.docker.compose.project=peerbot" | xargs -r docker rm 2>/dev/null || true
	@# Use docker compose to clean up networks and remaining resources
	@docker compose -f docker-compose.dev.yml down --remove-orphans 2>/dev/null || true
	@docker compose down --remove-orphans 2>/dev/null || true
	@echo "✅ All peerbot services stopped"

# Clean up everything including volumes
clean:
	@# Load deployment mode from .env
	@if [ -f .env ]; then \
		DEPLOYMENT_MODE=$$(grep "^DEPLOYMENT_MODE=" .env | cut -d'=' -f2 | tr -d ' '); \
	else \
		DEPLOYMENT_MODE="docker"; \
	fi; \
	echo "🧹 Cleaning up peerbot resources (mode: $$DEPLOYMENT_MODE)..."; \
	if [ "$$DEPLOYMENT_MODE" = "kubernetes" ] || [ "$$DEPLOYMENT_MODE" = "k8s" ]; then \
		echo "☸️  Cleaning Kubernetes resources..."; \
		helm uninstall peerbot -n peerbot 2>/dev/null || true; \
		kubectl delete namespace peerbot --wait=false 2>/dev/null || true; \
		echo "✅ Kubernetes resources cleaned up"; \
	else \
		echo "🐳 Cleaning Docker Compose resources..."; \
		docker ps -q --filter "label=com.docker.compose.project=peerbot" | xargs -r docker stop 2>/dev/null || true; \
		docker ps -aq --filter "label=com.docker.compose.project=peerbot" | xargs -r docker rm 2>/dev/null || true; \
		docker ps -q --filter "label=app.kubernetes.io/component=worker" | xargs -r docker stop 2>/dev/null || true; \
		docker ps -aq --filter "label=app.kubernetes.io/component=worker" | xargs -r docker rm 2>/dev/null || true; \
		docker compose -f docker-compose.dev.yml down -v --remove-orphans 2>/dev/null || true; \
		docker compose down -v --remove-orphans 2>/dev/null || true; \
		echo "✅ Docker containers and volumes cleaned up"; \
	fi

clean-workers:
	@# Load deployment mode from .env
	@if [ -f .env ]; then \
		DEPLOYMENT_MODE=$$(grep "^DEPLOYMENT_MODE=" .env | cut -d'=' -f2 | tr -d ' '); \
	else \
		DEPLOYMENT_MODE="docker"; \
	fi; \
	echo "🧹 Removing worker containers (mode: $$DEPLOYMENT_MODE)..."; \
	if [ "$$DEPLOYMENT_MODE" = "kubernetes" ] || [ "$$DEPLOYMENT_MODE" = "k8s" ]; then \
		echo "☸️  Removing Kubernetes worker pods..."; \
		kubectl delete pods -n peerbot -l app.kubernetes.io/component=worker --wait=false 2>/dev/null || true; \
		echo "✅ Kubernetes worker pods removed"; \
	else \
		echo "🐳 Removing Docker worker containers..."; \
		docker ps -a --filter "label=app.kubernetes.io/component=worker" -q | xargs docker rm -f 2>/dev/null || true; \
		echo "✅ Docker worker containers removed"; \
	fi; \
	echo "✅ New workers will use updated code"
