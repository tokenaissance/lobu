#!/bin/bash
# PreToolUse hook: Block npm commands and suggest bun equivalents
input=$(cat)
command=$(echo "$input" | jq -r '.tool_input.command // empty')

if [ -n "$command" ]; then
  # Extract the first word/command from the line (skip env vars, cd, etc.)
  base_cmd=$(echo "$command" | grep -oE '(^|[;&|] *)npm ' | head -1)
  if [ -n "$base_cmd" ]; then
    suggestion=$(echo "$command" | sed -E 's/npm install/bun install/; s/npm run/bun run/; s/npm ci/bun install/; s/npm exec/bunx/; s/npm test/bun test/')
    echo "BLOCKED: Use bun instead of npm. Try: $suggestion" >&2
    exit 2
  fi
fi

exit 0
