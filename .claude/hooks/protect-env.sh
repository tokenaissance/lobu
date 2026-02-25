#!/bin/bash
# PreToolUse hook: Block Edit/Write to .env* files
input=$(cat)
file_path=$(echo "$input" | jq -r '.tool_input.file_path // empty')

if [ -n "$file_path" ]; then
  basename=$(basename "$file_path")
  if [[ "$basename" == .env* ]]; then
    echo "BLOCKED: Cannot edit .env files via Claude. Edit them manually." >&2
    exit 2
  fi
fi

exit 0
