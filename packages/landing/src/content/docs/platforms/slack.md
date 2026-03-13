---
title: Slack
description: Slack integration capabilities for Lobu agents.
---

Lobu's Slack adapter supports assistant threads, rich UI, and interactive workflows.

## Setup

1. Create a Slack app at [api.slack.com/apps](https://api.slack.com/apps) and install it to your workspace.
2. Copy the **Signing Secret** and **Bot Token** (`xoxb-...`) from the app settings.
3. Open the admin page at `{PUBLIC_GATEWAY_URL}/agents`.
4. Click **Add Connection**, select **Slack**, and paste the signing secret and bot token.
5. The bot is now live in your Slack workspace.

## Features

- **Block Kit rendering** for buttons, forms, and structured interaction payloads.
- **Thread streaming** using Slack streaming APIs for incremental responses.
- **Question/approval UI** with radio buttons and action buttons.
- **Settings/auth links** rendered as platform-scoped link buttons.
- **Thread status indicator** (`is running..`) with rotating progress messages.

## Typical Use Cases

- Team assistant inside channels and DMs.
- Human approval steps for domain grants or agent decisions.
- Rich in-thread interaction without leaving Slack.
