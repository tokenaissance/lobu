#!/bin/bash
# PostToolUse hook: Auto-format .ts/.js/.json files under packages/ after Edit/Write
input=$(cat)
file_path=$(echo "$input" | jq -r '.tool_input.file_path // empty')

if [ -z "$file_path" ]; then
  exit 0
fi

# Only format ts/tsx/js/json files under packages/
if [[ "$file_path" == */packages/* ]] && [[ "$file_path" =~ \.(ts|tsx|js|json)$ ]]; then
  bunx biome check --write "$file_path" >/dev/null 2>&1 || true
fi

exit 0
