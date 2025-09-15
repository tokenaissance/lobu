#!/bin/bash
# Setup MCP server for Claude Code
# This script is called during worker initialization

echo "Setting up Claude Code settings..."

# Setup main Claude settings with MCP configuration
if [ -f "/app/packages/worker/claude-settings.json" ]; then
    mkdir -p /home/claude/.claude
    cp /app/packages/worker/claude-settings.json /home/claude/.claude/settings.json
    echo "✅ Claude settings deployed to /home/claude/.claude/settings.json"
    
    # Also copy as settings.mcp.json for compatibility
    cp /app/packages/worker/claude-settings.json /home/claude/.claude/settings.mcp.json
    echo "✅ MCP settings also deployed to /home/claude/.claude/settings.mcp.json"
    
    # Start the MCP process-manager server in the background
    if [ -f "/app/packages/worker/dist/mcp/process-manager-server.mjs" ]; then
        chmod +x /app/packages/worker/dist/mcp/process-manager-server.mjs
        echo "🚀 Starting MCP process-manager server on port 3001..."
        PORT=3001 node /app/packages/worker/dist/mcp/process-manager-server.mjs &
        MCP_PID=$!
        sleep 2
        
        # Check if the server started successfully
        if kill -0 $MCP_PID 2>/dev/null; then
            echo "✅ MCP server started successfully (PID: $MCP_PID)"
        else
            echo "❌ Failed to start MCP server"
        fi
    else
        echo "⚠️ Warning: MCP server file not found"
    fi
else
    echo "⚠️ Warning: Claude settings file not found"
fi

echo "✅ Claude Code setup completed"
echo "💡 Claude Code will use filesystem and process management tools"