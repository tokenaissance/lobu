#!/bin/bash
# PreToolUse hook: Block Edit/Write/Read on /dist/ paths
input=$(cat)
file_path=$(echo "$input" | jq -r '.tool_input.file_path // empty')

if [ -n "$file_path" ] && [[ "$file_path" == */dist/* ]]; then
  echo "BLOCKED: /dist/ contains compiled artifacts. Work with source files in src/ instead." >&2
  exit 2
fi

exit 0
