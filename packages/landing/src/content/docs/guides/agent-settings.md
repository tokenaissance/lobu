---
title: Agent Settings
description: What can be configured per agent and how those settings affect runtime.
---

Agent settings control behavior of each worker session.

## What You Can Configure

- Provider and model
- Allowed/disallowed tools
- Skills/plugins and MCP server config
- Permission grants (network domains)
- Environment variables needed by tools/providers

## How Settings Apply

- Gateway is the source of truth for settings.
- Worker fetches session context from gateway before execution.
- Tool policy is applied before tools are exposed to the model.

## Practical Guidance

- Keep tool permissions minimal.
- Add only required domains/grants.
- Prefer explicit permission grants over broad access.

## Memory Plugin Defaults

Lobu configures Owletto as the default OpenClaw memory plugin:

```json
{
  "pluginsConfig": {
    "plugins": [
      {
        "source": "@lobu/owletto-openclaw",
        "slot": "memory",
        "enabled": true
      }
    ]
  }
}
```

You can switch to another OpenClaw memory plugin (for example native memory) by updating `pluginsConfig`:

```json
{
  "pluginsConfig": {
    "plugins": [
      {
        "source": "@openclaw/native-memory",
        "slot": "memory",
        "enabled": true
      }
    ]
  }
}
```
