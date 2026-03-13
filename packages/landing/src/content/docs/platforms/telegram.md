---
title: Telegram
description: Telegram integration capabilities for Lobu agents.
---

Lobu's Telegram adapter uses Grammy and supports bot flows plus Mini App-secured experiences.

## Setup

1. Create a bot with [@BotFather](https://t.me/BotFather) on Telegram and copy the bot token.
2. Open the admin page at `{PUBLIC_GATEWAY_URL}/agents`.
3. Click **Add Connection**, select **Telegram**, and paste the bot token.
4. The bot starts receiving messages immediately.

## Features

- **Grammy-based bot runtime** with long-polling or webhook handling.
- **Inline keyboard interactions** for structured choices and approvals.
- **Telegram Mini App support** with signed `initData` validation.
- **Platform-scoped settings links** that can open Telegram Web App context.
- **Thread/context routing** across DMs and group chats.
- **File handling** for documents and media attached in Telegram messages.

## Typical Use Cases

- Personal AI assistant in Telegram DMs.
- Group copilots with mention-based interaction patterns.
- Mini App assisted settings and authentication flows.
