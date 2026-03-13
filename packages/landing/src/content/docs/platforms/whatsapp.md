---
title: WhatsApp
description: WhatsApp integration capabilities for Lobu agents.
---

Lobu's WhatsApp adapter is Baileys-based and optimized for practical chat automation.

## Setup

1. Obtain a WhatsApp Business **access token** and **phone number ID** from the [Meta Developer Portal](https://developers.facebook.com/).
2. Open the admin page at `{PUBLIC_GATEWAY_URL}/agents`.
3. Click **Add Connection**, select **WhatsApp**, and paste the access token and phone number ID.
4. The bot starts handling messages on the configured phone number.

## Features

- **Baileys integration** for WhatsApp Web-compatible messaging.
- **Self-chat mode** for local testing when `WHATSAPP_SELF_CHAT=true`.
- **Group controls** with allow/deny behavior and optional mention requirement.
- **Typing indicator status** while responses are being generated.
- **File/media support** for inbound and outbound attachments.
- **Conversation history window** with configurable retention limits.

## Typical Use Cases

- Personal assistant over WhatsApp chats.
- Group assistant that only responds when mentioned.
- Media-aware workflows (voice notes, files, images).
