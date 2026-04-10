---
title: SKILL.md Reference
description: Reference for Lobu skill files and supported frontmatter.
sidebar:
  order: 2
---

`SKILL.md` is the skill file format used by Lobu. It combines optional YAML frontmatter with markdown instructions.

Use it for:

- Skill metadata such as `name` and `description`
- Capability declarations such as integrations, MCP servers, packages, and network domains
- Instruction text that is injected into the agent's system prompt when the skill is active

Tool policy does **not** live in `SKILL.md`. Configure that in [`lobu.toml`](/reference/lobu-toml/) under `[agents.<id>.tools]`; see [Tool Policy](/guides/tool-policy/).

## Minimal example

```markdown
---
name: PDF Processing
description: Extract text and metadata from PDF files
---

# PDF Processing

When asked to work with PDFs, use `pdftotext` first.
```

## Full example

```markdown
---
name: My Skill
description: What this skill does

integrations:
  - id: google
    authType: oauth

mcpServers:
  my-mcp:
    url: https://my-mcp.example.com
    type: sse

nixConfig:
  packages: [jq, ripgrep, pandoc]

networkConfig:
  allowedDomains:
    - api.example.com
---

# My Skill

Instructions and behavioral rules for the agent go here as Markdown.
The body acts as a system prompt extension.
```

## Frontmatter Reference

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Display name shown in settings and search results |
| `description` | string | Short summary for the skill registry |
| `integrations` | array | Third-party services the skill requires |
| `integrations[].id` | string | Integration identifier such as `google` or `github` |
| `integrations[].authType` | `oauth` \| `apiKey` | Authentication method |
| `mcpServers` | object | MCP server connections keyed by server ID |
| `mcpServers.<id>.url` | string | Server endpoint URL |
| `mcpServers.<id>.type` | `sse` \| `http` | Transport type |
| `nixConfig.packages` | string[] | Nix packages to install |
| `nixConfig.flakeUrl` | string | Nix flake URL for a full dev shell |
| `networkConfig.allowedDomains` | string[] | Domains the worker sandbox can reach |

## Markdown Body

The markdown body after the frontmatter is appended to the agent's prompt when the skill is active. Use it for workflows, rules, conventions, and domain-specific instructions.

## Related Docs

- [Skills](/getting-started/skills/)
- [Skills Authoring](/guides/skills-authoring/)
- [Tool Policy](/guides/tool-policy/)
- [`lobu.toml` Reference](/reference/lobu-toml/)
