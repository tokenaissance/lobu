---
title: Agent Tools
description: Built-in tools available to Lobu agents.
---

This page lists the built-in tools exposed by Lobu workers.

## Core Runtime Tools

From `packages/worker/src/openclaw/tools.ts`.

| Tool | What it does | Typical use |
|---|---|---|
| `read` | Reads file contents from the workspace. | Inspect source/config/log files before editing. |
| `write` | Writes full file contents. | Create new files or replace file content entirely. |
| `edit` | Applies targeted text replacements in a file. | Small, surgical code changes. |
| `bash` | Runs shell commands in the workspace (policy-controlled). | Build, test, lint, run scripts, inspect runtime state. |
| `grep` | Searches file contents with pattern matching. | Find symbols, config values, or error strings quickly. |
| `find` | Finds files/directories by path patterns. | Locate files across large repositories. |
| `ls` | Lists files/directories. | Quick workspace structure discovery. |

## Lobu Custom Tools

From `packages/worker/src/openclaw/custom-tools.ts`.

| Tool | What it does | Typical use |
|---|---|---|
| `UploadUserFile` | Uploads a generated file back to the user thread. | Share reports, charts, documents, exports, media. |
| `ScheduleReminder` | Schedules one-time or recurring follow-up tasks. | Deferred tasks and recurring automations. |
| `CancelReminder` | Cancels a scheduled reminder by ID. | Stop previously scheduled jobs. |
| `ListReminders` | Lists pending reminders and schedule IDs. | Audit or pick reminder to cancel/update. |
| `SearchSkills` | Searches for skills and MCP servers, or lists installed capabilities (empty query). | Discover capabilities and check installed state. |
| `InstallSkill` | Creates a settings link to install or upgrade a skill/MCP server. | Guided install/upgrade with user confirmation and pre-filled dependencies. |
| `GetSettingsLink` | Creates a settings link with optional prefilled config. | Ask user to add keys, grants, skills, or MCP config. |
| `GenerateAudio` | Converts text to speech and returns audio. | Voice responses or spoken summaries. |
| `GetChannelHistory` | Fetches prior messages in the conversation thread. | Recover context from earlier discussion. |
| `AskUserQuestion` | Sends structured button-based questions to the user. | Branching choices and approvals without free-text ambiguity. |
| `ConnectService` | Authenticates with a service (OAuth integration or MCP server). | Connect user account before API operations. |
| `CallService` | Calls external APIs through gateway-managed auth. | Make authenticated API requests without exposing secrets. |
| `DisconnectService` | Removes service connection/credentials. | Revoke or reset broken/stale integration access. |

## Additional Tool Sources

Beyond built-ins, agents can also receive tools from:

- OpenClaw plugins (`pluginsConfig`) loaded at runtime
- Configured MCP servers (proxied through the gateway)

## Memory Plugins

Lobu uses OpenClaw's plugin system for memory as well. The default memory plugin is Owletto (`./plugins/openclaw-owletto-plugin.js`, slot `memory`).

You can replace it with another OpenClaw memory plugin (for example `@openclaw/native-memory`) via `pluginsConfig`.

So the effective toolset for a given agent is:

1. Core runtime tools
2. Lobu custom tools
3. Plugin tools (if enabled)
4. MCP-provided tools (if configured)
