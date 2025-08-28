FROM mcr.microsoft.com/devcontainers/typescript-node:1-18-bullseye

# Install Bun
RUN curl -fsSL https://bun.sh/install | bash && \
    mv /root/.bun /usr/local/bun && \
    ln -s /usr/local/bun/bin/bun /usr/local/bin/bun && \
    ln -s /usr/local/bun/bin/bunx /usr/local/bin/bunx

# Install Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code@latest

# Install k3s for local Kubernetes
RUN curl -sfL https://get.k3s.io | sh -s - --write-kubeconfig-mode 644 --disable traefik --disable metrics-server || true

# Install Skaffold
RUN curl -Lo skaffold https://storage.googleapis.com/skaffold/releases/latest/skaffold-linux-amd64 && \
    chmod +x skaffold && \
    mv skaffold /usr/local/bin

# Install additional tools
RUN apt-get update && apt-get install -y \
    postgresql-client \
    redis-tools \
    jq \
    vim \
    htop \
    net-tools \
    iputils-ping \
    dnsutils \
    && rm -rf /var/lib/apt/lists/*

# Create workspace directory
RUN mkdir -p /workspace

# Note: MCP config will be copied during post-create from the mounted workspace

# Create Claude Code configuration directory
RUN mkdir -p /home/node/.claude && chown -R node:node /home/node/.claude

# Note: Shell environment setup will be handled by post-create script

# Install GitHub CLI for PR operations
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg && \
    chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null && \
    apt update && \
    apt install gh -y

# Setup git
RUN git config --global --add safe.directory /workspace

# Switch to vscode user (will be handled by devcontainer features)
# USER vscode

# Note: npm global packages and shell config will be set up by devcontainer features

WORKDIR /workspace

# Set entrypoint to keep container running
ENTRYPOINT ["/bin/bash"]