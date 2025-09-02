# Development Makefile for Peerbot

.PHONY: help setup build compile dev test clean logs restart build-worker

# Default target
help:
	@echo "Available commands:"
	@echo "  peerbot setup                              - Interactive setup for Slack bot development"
	@echo "  peerbot dev                                - Start local development with Docker workers"
	@echo "  peerbot build-worker                       - Build worker Docker image"
	@echo "  peerbot deploy                             - Deploy using values-local.yaml if exists, else create it from .env"
	@echo "  peerbot deploy --target=production         - Deploy using values-production.yaml"
	@echo "  peerbot deploy --target=path/to/values.yaml - Deploy using custom values file path"
	@echo "  peerbot test                               - Run test bot"
	@echo "  peerbot clean                              - Stop services and clean up resources"

# Interactive setup for development
setup:
	@echo "🚀 Starting PeerBot development setup..."
	@./bin/setup-slack.sh

# Start local development
dev: build-worker
	@if [ ! -f .env ]; then \
		echo "❌ .env file not found!"; \
		echo ""; \
		echo "Please run setup first:"; \
		echo "  make setup"; \
		echo ""; \
		exit 1; \
	fi
	@echo "🚀 Starting local development mode..."
	@echo "   This will:"
	@echo "   - Build worker Docker image"
	@echo "   - Start orchestrator and dispatcher with hot reload"
	@echo "   - Use Docker containers for workers"
	@echo ""
	@if grep -q "DEPLOYMENT_MODE=" .env 2>/dev/null; then \
		DEPLOYMENT_MODE=$$(grep "DEPLOYMENT_MODE=" .env | cut -d'=' -f2); \
		if [ "$$DEPLOYMENT_MODE" = "k8s" ]; then \
			echo "Using Kubernetes mode (from .env)..."; \
			./bin/setup-slack.sh k8s-only; \
		else \
			echo "Using Docker mode (from .env)..."; \
			./bin/setup-slack.sh docker-only; \
		fi \
	else \
		read -p "Do you want to setup Kubernetes configuration? (y/N): " setup_k8s; \
		if [ "$$setup_k8s" = "y" ] || [ "$$setup_k8s" = "Y" ]; then \
			echo "Setting up Kubernetes configuration..."; \
			./bin/setup-slack.sh k8s-only; \
		else \
			echo "Using Docker mode..."; \
			./bin/setup-slack.sh docker-only; \
		fi \
	fi
	@export NODE_ENV=development && \
		cd packages/orchestrator && bun run dev & \
		cd packages/dispatcher && bun run dev


# Build worker image for Docker mode
build-worker:
	@echo "🔨 Building worker Docker image..."
	@if [ "$$NODE_ENV" = "development" ]; then \
		echo "📦 Building development image with volume mounts..."; \
		docker build -f Dockerfile.worker.dev -t peerbot-worker:latest .; \
	else \
		echo "📦 Building production image..."; \
		docker build -f Dockerfile.worker -t peerbot-worker:latest .; \
	fi

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

# Clean up
clean:
	@echo "🧹 Cleaning up..."
	@docker stop $(shell docker ps -q --filter "label=app.kubernetes.io/component=worker") 2>/dev/null || true
	@docker rm $(shell docker ps -aq --filter "label=app.kubernetes.io/component=worker") 2>/dev/null || true
	@helm uninstall peerbot -n peerbot 2>/dev/null || true
	@kubectl delete namespace peerbot 2>/dev/null || true
	@echo "✅ Docker containers and K8s resources cleaned up"