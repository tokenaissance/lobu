---
title: Skills Authoring
description: Create custom skills and MCP servers to extend agent capabilities.
---

Skills extend what your agent can do. They bundle instructions, MCP servers, network domains, and system packages into a single unit.

Tool permissions are not part of skill frontmatter. Configure those separately under `[agents.<id>.tools]` in `lobu.toml`; see [Tool Policy](/guides/tool-policy/).

## Skill types

| Type | Where it lives | Scope |
|------|---------------|-------|
| **System skills** | Built-in registry (`config/system-skills.json`) | Available to all agents |
| **Shared skills** | `skills/` directory (project root) | Available to all agents |
| **Agent skills** | `agents/{name}/skills/` directory | One agent only |
| **Custom MCP** | `lobu.toml` under `[agents.{id}.skills.mcp]` | One agent only |

## Creating a local skill

Create a `SKILL.md` file in either the shared or agent-specific skills directory:

```
skills/
  pdf-processing/
    SKILL.md           # shared — all agents can use this
agents/my-agent/
  skills/
    internal-tools/
      SKILL.md         # agent-specific — only my-agent sees this
```

### SKILL.md format

A skill file is markdown with optional YAML frontmatter:

```markdown
---
name: PDF Processing
description: Extract text and metadata from PDF files
nixPackages:
  - poppler
network:
  allow:
    - api.pdfparser.com
---

# PDF Processing

When asked to work with PDF files, use the `pdftotext` command (from the poppler package)
to extract text content.

For structured extraction, use the PDF Parser API at api.pdfparser.com.

## Examples

- Extract text: `pdftotext input.pdf output.txt`
- Extract with layout: `pdftotext -layout input.pdf output.txt`
```

### Frontmatter fields

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Display name |
| `description` | string | Short description |
| `nixPackages` | string[] | System packages to install in the worker (e.g., `poppler`, `ffmpeg`, `imagemagick`) |
| `network.allow` | string[] | Domains the skill needs access to |
| `network.deny` | string[] | Domains to block |
| `mcpServers` | object | MCP servers this skill provides (see below) |

The markdown body below the frontmatter is the skill's instructions — they're available to the agent at runtime via `.skills/{name}/SKILL.md`.

### Minimal skill (no frontmatter)

For simple instruction-only skills, skip the frontmatter:

```markdown
# Code Review Guidelines

When reviewing code, check for:
1. Security vulnerabilities (SQL injection, XSS, command injection)
2. Error handling — are errors caught and logged?
3. Test coverage — are edge cases tested?

Always suggest specific fixes, not just problems.
```

## Adding MCP servers to a skill

Skills can declare MCP servers that provide tools to the agent:

```markdown
---
name: Database Admin
description: Query and manage PostgreSQL databases
mcpServers:
  postgres:
    url: https://mcp-postgres.example.com
    type: sse
network:
  allow:
    - mcp-postgres.example.com
---

# Database Admin

Use the PostgreSQL MCP tools to query databases, list tables, and run migrations.
```

For stdio-based MCP servers:

```markdown
---
name: Local Tools
mcpServers:
  my-tool:
    command: node
    args: ["/path/to/mcp-server.js"]
---
```

## Configuring MCP servers in lobu.toml

For MCP servers that aren't part of a skill file, add them directly to `lobu.toml`:

```toml
[agents.support.skills.mcp.custom-api]
url = "https://my-api.example.com/mcp"

[agents.support.skills.mcp.custom-api.oauth]
auth_url = "https://auth.example.com/authorize"
token_url = "https://auth.example.com/token"
client_id = "$OAUTH_CLIENT_ID"
client_secret = "$OAUTH_CLIENT_SECRET"
scopes = ["read", "write"]
```

See [lobu.toml Reference](/reference/lobu-toml/) for the full MCP schema.

## Enabling skills

### From the registry

Browse and add skills from the built-in registry:

```bash
npx @lobu/cli skills list                # browse all skills
npx @lobu/cli skills search "github"     # search
npx @lobu/cli skills info github         # details and required secrets
npx @lobu/cli skills add github          # add to lobu.toml
```

This adds the skill ID to `[agents.{id}.skills].enabled` in your `lobu.toml`.

### Local skills

Local skills (in `skills/` or `agents/{name}/skills/`) are automatically discovered at startup. No explicit enablement needed — if the file exists, the agent has access.

## How skills work at runtime

1. **Startup**: gateway loads `lobu.toml` + scans skill directories
2. **Config merge**: network domains, nix packages, and MCP servers declared by enabled skills are merged into the agent's session context
3. **MCP discovery**: MCP servers declared by skills are registered and their tools are discovered
4. **Workspace sync**: skill files are written to `.skills/{name}/SKILL.md` in the worker filesystem
5. **Agent access**: the agent can read skill instructions on demand (`cat .skills/github/SKILL.md`) and invoke MCP tools directly

Skills use progressive disclosure — only the skill name and description are injected into the system prompt. The full instructions are loaded when the agent reads the file.

## Available system skills

### Integration skills

| ID | Name | What it provides |
|----|------|-----------------|
| `github` | GitHub | Repos, issues, PRs, code access via Owletto MCP |
| `google-workspace` | Google Workspace | Calendar, Drive, Gmail, Docs |
| `linear` | Linear | Issues, projects, teams |
| `notion` | Notion | Pages, databases, search |
| `jira` | Jira | Issues, projects, boards |
| `sentry` | Sentry | Error tracking and monitoring |
| `microsoft-365` | Microsoft 365 | Outlook, OneDrive, Teams |
| `spotify` | Spotify | Playback control, playlists |

### LLM provider skills

Provider skills install an LLM provider. See [Providers](/reference/providers/) for the full list.

Browse all available skills with `npx @lobu/cli skills list`.

## Trust model

Skills are trusted code. When a skill is enabled on an agent, its declared config is merged into the agent at startup — there is no separate per-skill consent prompt.

- **Network**: domains in `network.allow` are added to the worker's gateway proxy allowlist.
- **Nix packages**: installed in the worker environment before the agent starts.
- **MCP servers**: registered and their tools discovered at startup.
- **MCP credentials**: handled by the gateway proxy — workers never see OAuth tokens.

**Review a skill before installing it.** A malicious skill can widen the network allowlist or register additional MCP servers just by being enabled. Lobu's built-in system skills are curated; third-party or local skills should be read like any other dependency.

**Skills cannot bypass MCP tool approval.** Destructive MCP tool calls (per `destructiveHint` annotations) still require in-thread user approval regardless of which skill provided the tool. Only the operator can pre-approve tools, and only by listing them in `[agents.<id>.tools].pre_approved` in `lobu.toml`. See [Tool Policy](/guides/tool-policy/).
