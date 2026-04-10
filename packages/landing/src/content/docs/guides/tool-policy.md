---
title: Tool Policy
description: Where tool permissions and MCP approval overrides are configured in Lobu.
---

Tool policy is configured per agent in `lobu.toml`, not in `SKILL.md`.

Use `[agents.<id>.tools]` for two separate concerns:

- **Worker-side tool visibility**: `allowed`, `denied`, `strict`
- **MCP approval bypass**: `pre_approved`

```toml
[agents.support.tools]
pre_approved = [
  "/mcp/gmail/tools/list_messages",
  "/mcp/linear/tools/*",
]
allowed = ["Read", "Grep", "mcp__gmail__*"]
denied = ["Bash(rm:*)"]
strict = false
```

## What Each Field Does

- `allowed`: tools the worker can call
- `denied`: tools to always block; takes precedence over `allowed`
- `strict`: when `true`, only `allowed` tools are visible to the worker
- `pre_approved`: MCP tool grant patterns that skip the in-thread approval card

## Why This Lives In `lobu.toml`

Tool policy is operator-controlled configuration. Skills can add instructions, MCP servers, network domains, and packages, but they cannot silently widen tool access or pre-approve destructive MCP calls.

That split keeps approval overrides visible in code review and prevents a skill from bypassing the thread-level consent flow.

## Skills vs Agent Config

- Use `SKILL.md` for instructions and capability declarations such as MCP servers, Nix packages, and network requirements.
- Use `lobu.toml` for operator policy such as tool visibility and `pre_approved` MCP grants.

## Reference

For the exact schema and field definitions, see the [`lobu.toml` reference](/reference/lobu-toml/) section for `[agents.<id>.tools]`.
