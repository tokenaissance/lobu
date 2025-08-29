# Development Makefile for Peerbot

.PHONY: help setup build compile dev test clean logs restart

# Default target
help:
	@echo "Available commands:"
	@echo "  make setup       - Interactive setup for Slack bot development"
	@echo "  make dev         - Start local development with Docker workers"
	@echo "  make build-worker - Build worker Docker image"
	@echo "  make test        - Run test bot"
	@echo "  make clean       - Stop services and clean up resources"

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
	@read -p "Do you want to setup Kubernetes configuration? (y/N): " setup_k8s; \
	if [ "$$setup_k8s" = "y" ] || [ "$$setup_k8s" = "Y" ]; then \
		echo "Setting up Kubernetes configuration..."; \
		./bin/setup-slack.sh k8s-only; \
	else \
		echo "Using Docker mode..."; \
		./bin/setup-slack.sh docker-only; \
	fi
	@export NODE_ENV=development && \
		bun --watch packages/orchestrator/src/index.ts & \
		bun --watch packages/dispatcher/src/index.ts

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
	@source .env && node test-bot.js --qa
# Clean up
clean:
	@echo "🧹 Cleaning up..."
	@docker stop $(shell docker ps -q --filter "label=app.kubernetes.io/component=worker") 2>/dev/null || true
	@docker rm $(shell docker ps -aq --filter "label=app.kubernetes.io/component=worker") 2>/dev/null || true
	@echo "✅ Docker containers cleaned up"