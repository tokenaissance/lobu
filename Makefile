# Development Makefile for Peerbot

.PHONY: help setup build compile dev prod test clean logs restart deploy down

# Default target
help:
	@echo "Available commands:"
	@echo "  peerbot setup                              - Interactive setup for Slack bot development"
	@echo "  peerbot dev                                - Start development with Docker Compose (hot reload)"
	@echo "  peerbot prod                               - Start production with Docker Compose"
	@echo "  peerbot down                               - Stop all services including dynamic workers"
	@echo "  peerbot logs                               - View Docker Compose service logs"
	@echo "  peerbot deploy                             - Deploy to K8s using values-local.yaml"
	@echo "  peerbot deploy --target=production         - Deploy to K8s using values-production.yaml"
	@echo "  peerbot deploy --target=path/to/values.yaml - Deploy to K8s using custom values file"
	@echo "  peerbot test                               - Run test bot"
	@echo "  peerbot clean                              - Stop all services and clean up all resources"

# Interactive setup for development
setup:
	@echo "🚀 Starting PeerBot development setup..."
	@./scripts/setup-local-dev.sh

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
	@echo "🚀 Starting local development mode with Docker Compose..."
	@echo "   This will:"
	@echo "   - Build all services including worker image"
	@echo "   - Start services with hot reload"
	@echo "   - Start PostgreSQL database"
	@echo "   - Mount source code for live changes"
	@echo ""
	@echo "🔨 Building all services..."
	@# Support detached via variable (DETACH=1) or alias targets; note: `make -d` is a make debug flag, not detach
	@DETACH_FLAG=""; [ "$(DETACH)" = "1" ] && DETACH_FLAG="-d"; \
	if [ -n "$$DETACH_FLAG" ]; then echo "🧩 Running in detached mode"; fi; \
	COMPOSE_DOCKER_CLI_BUILD=1 DOCKER_BUILDKIT=1 docker compose -f docker-compose.dev.yml up $$DETACH_FLAG --build dispatcher orchestrator postgres

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
	@echo "🧪 Running test bot..."
	@source .env && node slack-qa-bot.js --qa
# Deploy to Kubernetes
# Usage: make deploy [--target=environment]
deploy:
	@if [ ! -f .env ]; then \
		echo "❌ .env file not found!"; \
		echo ""; \
		echo "Please run setup first:"; \
		echo "  make setup"; \
		echo ""; \
		exit 1; \
	fi
	@# Parse target argument
	@TARGET_PATH=""; \
	for arg in $(MAKECMDGOALS); do \
		case $$arg in \
			--target=*) TARGET_PATH=$${arg#--target=} ;; \
		esac; \
	done; \
	if [ -n "$$TARGET_PATH" ]; then \
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
	echo "🎯 Deploying using $$VALUES_FILE"
	@echo "🚀 Building and deploying to K8s..."
	@echo "📦 Building Docker images..."
	@docker build -f Dockerfile.dispatcher -t peerbot-dispatcher:latest .
	@docker build -f Dockerfile.orchestrator -t peerbot-orchestrator:latest .
	@docker build -f Dockerfile.worker -t peerbot-worker:latest .
	@if command -v kind >/dev/null 2>&1 && kind get clusters 2>/dev/null | grep -q kind; then \
		echo "📦 Loading images into kind..."; \
		kind load docker-image peerbot-dispatcher:latest; \
		kind load docker-image peerbot-orchestrator:latest; \
		kind load docker-image peerbot-worker:latest; \
	fi
	@echo "🔧 Deploying with Helm..."
	@set -a; source .env; set +a; \
	TARGET_PATH=""; \
	for arg in $(MAKECMDGOALS); do \
		case $$arg in \
			--target=*) TARGET_PATH=$${arg#--target=} ;; \
		esac; \
	done; \
	if [ -n "$$TARGET_PATH" ]; then \
		if [ -f "$$TARGET_PATH" ]; then \
			VALUES_FILE="$$TARGET_PATH"; \
		elif [ -f "charts/peerbot/values-$$TARGET_PATH.yaml" ]; then \
			VALUES_FILE="charts/peerbot/values-$$TARGET_PATH.yaml"; \
		fi; \
	elif [ -f "charts/peerbot/values-local.yaml" ]; then \
		VALUES_FILE="charts/peerbot/values-local.yaml"; \
	else \
		VALUES_FILE="charts/peerbot/values-local.yaml"; \
	fi; \
	echo "📋 Using values file: $$VALUES_FILE"; \
	helm upgrade --install peerbot charts/peerbot/ \
		--create-namespace \
		--namespace peerbot \
		-f "$$VALUES_FILE" \
		--set dispatcher.image.tag=latest \
		--set orchestrator.image.tag=latest \
		--set worker.image.tag=latest \
		--set secrets.slackBotToken="$$SLACK_BOT_TOKEN" \
		--set secrets.slackSigningSecret="$$SLACK_SIGNING_SECRET" \
		--set secrets.slackAppToken="$$SLACK_APP_TOKEN" \
		--set secrets.githubToken="$$GITHUB_TOKEN" \
		--set secrets.claudeCodeOAuthToken="$$CLAUDE_CODE_OAUTH_TOKEN" \
		--set secrets.postgresqlPassword="$$POSTGRESQL_PASSWORD"
	@echo "🗄️ Running database migrations..."
	@kubectl exec -n peerbot deployment/peerbot-orchestrator -- dbmate up
	@echo "✅ Deployed to K8s. Check status with:"
	@echo "  kubectl get pods -n peerbot"
	@echo "  kubectl logs -f deployment/peerbot-dispatcher -n peerbot"

# Start production mode with Docker Compose
prod:
	@if [ ! -f .env ]; then \
		echo "❌ .env file not found!"; \
		echo ""; \
		echo "Please run setup first:"; \
		echo "  make setup"; \
		echo ""; \
		exit 1; \
	fi
	@echo "🚀 Starting production mode with Docker Compose..."
	@echo "🔨 Building all services..."
	@docker compose build --no-cache worker
	@docker compose up --build -d dispatcher orchestrator postgres
	@echo "✅ Services started in production mode"
	@echo "   View logs with: make logs"

# View logs from Docker Compose services
logs:
	@if docker compose -f docker-compose.dev.yml ps --services 2>/dev/null | grep -q .; then \
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
	@echo "🧹 Cleaning up all peerbot resources..."
	@# Stop and remove all containers with peerbot labels
	@docker ps -q --filter "label=com.docker.compose.project=peerbot" | xargs -r docker stop 2>/dev/null || true
	@docker ps -aq --filter "label=com.docker.compose.project=peerbot" | xargs -r docker rm 2>/dev/null || true
	@docker ps -q --filter "label=app.kubernetes.io/component=worker" | xargs -r docker stop 2>/dev/null || true
	@docker ps -aq --filter "label=app.kubernetes.io/component=worker" | xargs -r docker rm 2>/dev/null || true
	@# Clean up with docker compose (including volumes)
	@docker compose -f docker-compose.dev.yml down -v --remove-orphans 2>/dev/null || true
	@docker compose down -v --remove-orphans 2>/dev/null || true
	@# Clean up Kubernetes resources if they exist
	@helm uninstall peerbot -n peerbot 2>/dev/null || true
	@kubectl delete namespace peerbot 2>/dev/null || true
	@echo "✅ All Docker containers, volumes, and K8s resources cleaned up"

clean-workers:
	@echo "🧹 Removing all worker containers..."
	@# Use xargs without -r flag for macOS compatibility
	@docker ps -a --filter "label=app.kubernetes.io/component=worker" -q | xargs docker rm -f 2>/dev/null || true
	@echo "✅ All worker containers removed. New workers will use updated code"
