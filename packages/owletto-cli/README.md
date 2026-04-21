# owletto

CLI for running Owletto locally, configuring MCP clients, and operating Owletto directly.

## Quick Start

```bash
# Install the public Owletto skill
npx skills add lobu-ai/lobu --skill owletto

# Configure supported clients to use Owletto
npx owletto@latest init
```

Use the OpenClaw-specific variant when needed:

```bash
npx skills add lobu-ai/lobu --skill owletto-openclaw --agent openclaw -y
```

## Common Commands

```bash
npx owletto@latest start
npx owletto@latest login https://app.lobu.ai/mcp
npx owletto@latest run search_knowledge '{"query":"Acme"}'
```

## Lobu Relationship

Owletto and Lobu are separate products:

- **Owletto** provides shared memory, knowledge tools, connectors, and watchers.
- **Lobu** builds and runs agents, and can optionally use Owletto as its memory backend.

Use `npx skills add lobu-ai/lobu --skill lobu --agent openclaw -y` to install the Lobu skill separately.
