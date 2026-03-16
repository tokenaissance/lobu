#!/bin/bash
set -e

# Bot testing script with multi-message and multi-platform support
# Usage: ./scripts/test-bot.sh "message 1" ["message 2"] ["message 3"] ...
# Or: ./scripts/test-bot.sh (uses default test message)
#
# Environment variables:
#   TEST_PLATFORM   - "slack", "whatsapp", or "telegram" (default: auto-detect)
#   TEST_CHANNEL    - Channel ID (Slack), phone number (WhatsApp), or peer/chat ID (Telegram)
#   TEST_TIMEOUT    - Timeout in seconds (default: 30)
#
# Platform-specific:
#   Slack: QA_SLACK_CHANNEL, optional SLACK_BOT_TOKEN for reply polling
#   WhatsApp: WHATSAPP_SELF_PHONE (defaults to bot's own number for self-chat)
#   Telegram: TELEGRAM_TEST_CHAT_ID, TG_API_ID, TG_API_HASH (uses tguser to send as real user)

GATEWAY_URL="${GATEWAY_URL:-http://localhost:8080}"

# Load .env if it exists
if [ -f .env ]; then
    set -a
    source <(grep -v '^\s*#' .env | grep -v '^\s*$')
    set +a
fi

# Auto-detect platform from active messaging connections, fall back to env vars
if [ -z "$TEST_PLATFORM" ]; then
    # Try querying gateway for active local test targets
    TEST_TARGETS=$(curl -sf "$GATEWAY_URL/internal/connections/test-targets" 2>/dev/null || \
        curl -sf "$GATEWAY_URL/api/internal/connections/test-targets" 2>/dev/null || \
        echo "")

    if [ -n "$TEST_TARGETS" ]; then
        TEST_PLATFORM=$(echo "$TEST_TARGETS" | jq -r '.[0].platform // empty' 2>/dev/null || echo "")
        if [ -z "$TEST_CHANNEL" ]; then
            TEST_CHANNEL=$(echo "$TEST_TARGETS" | jq -r '.[0].defaultTarget // empty' 2>/dev/null || echo "")
        fi
    fi

    # Fall back to env var detection if gateway didn't respond
    if [ -z "$TEST_PLATFORM" ]; then
        TELEGRAM_CHANNEL="${TEST_CHANNEL:-$TELEGRAM_TEST_CHAT_ID}"
        TELEGRAM_READY="false"
        if [ -n "$TELEGRAM_BOT_TOKEN" ] && [ -n "$TELEGRAM_CHANNEL" ] && command -v tguser > /dev/null 2>&1 && [ -n "$TG_API_ID" ] && [ -n "$TG_API_HASH" ]; then
            TELEGRAM_READY="true"
        fi

        if [ -n "$SLACK_BOT_TOKEN" ]; then
            TEST_PLATFORM="slack"
        elif [ "$TELEGRAM_READY" = "true" ]; then
            TEST_PLATFORM="telegram"
        elif [ -n "$TELEGRAM_BOT_TOKEN" ]; then
            TEST_PLATFORM="telegram"
        else
            echo "❌ No platform detected. Set TEST_PLATFORM=slack|telegram|whatsapp"
            exit 1
        fi
    fi
fi

TIMEOUT="${TEST_TIMEOUT:-30}"

# Platform-specific setup
case "$TEST_PLATFORM" in
    slack)
        AUTH_TOKEN="${TEST_AUTH_TOKEN:-$ADMIN_PASSWORD}"
        CHANNEL="${TEST_CHANNEL:-$QA_SLACK_CHANNEL}"
        if [ -z "$CHANNEL" ]; then
            echo "❌ QA_SLACK_CHANNEL or TEST_CHANNEL environment variable is required for Slack"
            exit 1
        fi
        ;;
    whatsapp)
        AUTH_TOKEN="${TEST_AUTH_TOKEN:-$ADMIN_PASSWORD}"
        CHANNEL="${TEST_CHANNEL:-$WHATSAPP_SELF_PHONE}"
        if [ -z "$CHANNEL" ]; then
            # For self-chat mode, we can use "self" as a special channel
            if [ "$WHATSAPP_SELF_CHAT" = "true" ]; then
                CHANNEL="self"
            else
                echo "❌ TEST_CHANNEL or WHATSAPP_SELF_PHONE environment variable is required for WhatsApp"
                exit 1
            fi
        fi
        ;;
    telegram)
        AUTH_TOKEN="${TEST_AUTH_TOKEN:-$ADMIN_PASSWORD}"
        CHANNEL="${TEST_CHANNEL:-$TELEGRAM_TEST_CHAT_ID}"
        if [ -z "$CHANNEL" ]; then
            echo "❌ TEST_CHANNEL or TELEGRAM_TEST_CHAT_ID environment variable is required for Telegram"
            exit 1
        fi
        ;;
    *)
        echo "❌ Unknown platform: $TEST_PLATFORM. Use 'slack', 'whatsapp', or 'telegram'"
        exit 1
        ;;
esac

# Get messages from arguments or use default
if [ $# -eq 0 ]; then
    MESSAGES=("@me test message")
else
    MESSAGES=("$@")
fi

echo "🧪 Testing bot with ${#MESSAGES[@]} message(s)"
echo "📱 Platform: $TEST_PLATFORM"
echo "📍 Channel: $CHANNEL"
echo "⏱️  Timeout: ${TIMEOUT}s"
echo ""

LAST_THREAD_ID=""

# Send each message sequentially
for i in "${!MESSAGES[@]}"; do
    MESSAGE="${MESSAGES[$i]}"
    MSG_NUM=$((i + 1))

    echo "[$MSG_NUM/${#MESSAGES[@]}] 📤 Sending: $MESSAGE"

    if [ "$TEST_PLATFORM" = "telegram" ] && command -v tguser > /dev/null 2>&1 && [ -n "$TG_API_ID" ] && [ -n "$TG_API_HASH" ]; then
        TGUSER_OUTPUT=$(TG_API_ID="$TG_API_ID" TG_API_HASH="$TG_API_HASH" tguser send "$CHANNEL" "$MESSAGE" 2>&1) || {
            echo "   ❌ Failed to send Telegram message $MSG_NUM:"
            echo "$TGUSER_OUTPUT"
            exit 1
        }

        echo "   ✅ Sent via tguser (as your Telegram user account)"
        if [ -n "$TGUSER_OUTPUT" ]; then
            echo "      $TGUSER_OUTPUT"
        fi
        echo "   📋 Check Telegram chat for bot response"
        echo ""
        continue
    elif [ "$TEST_PLATFORM" = "telegram" ]; then
        echo "   ℹ️  TG_API_ID/TG_API_HASH not configured; falling back to gateway-side Telegram send"
    fi

    # Escape message for JSON (handle newlines, quotes, backslashes)
    ESCAPED_MESSAGE=$(printf '%s' "$MESSAGE" | jq -Rs .)

    # Build request body using jq for proper JSON
    # Use TEST_AGENT_ID or generate a default test agent ID
    AGENT_ID="${TEST_AGENT_ID:-test-$TEST_PLATFORM}"

    # Build request body (must match /api/v1/messaging/send schema)
    BODY=$(jq -n \
        --arg agentId "$AGENT_ID" \
        --arg platform "$TEST_PLATFORM" \
        --argjson message "$ESCAPED_MESSAGE" \
        '{agentId: $agentId, platform: $platform, message: $message}')

    # Add platform-specific routing info
    case "$TEST_PLATFORM" in
        slack)
            if [ -n "$LAST_THREAD_ID" ]; then
                BODY=$(echo "$BODY" | jq --arg channel "$CHANNEL" --arg thread "$LAST_THREAD_ID" '. + {slack: {channel: $channel, thread: $thread}}')
            else
                BODY=$(echo "$BODY" | jq --arg channel "$CHANNEL" '. + {slack: {channel: $channel}}')
            fi
            ;;
        whatsapp)
            BODY=$(echo "$BODY" | jq --arg chat "$CHANNEL" '. + {whatsapp: {chat: $chat}}')
            ;;
        telegram)
            BODY=$(echo "$BODY" | jq --arg chatId "$CHANNEL" '. + {telegram: {chatId: $chatId}}')
            ;;
    esac

    # Send message
    RESPONSE=$(curl -s -X POST "$GATEWAY_URL/api/v1/messaging/send" \
      -H "Authorization: Bearer $AUTH_TOKEN" \
      -H "Content-Type: application/json" \
      -d "$BODY")

    # Check success
    if ! echo "$RESPONSE" | jq -e '.success' > /dev/null 2>&1; then
        echo "   ❌ Failed to send message $MSG_NUM:"
        echo "$RESPONSE" | jq 2>/dev/null || echo "$RESPONSE"
        exit 1
    fi

    MESSAGE_ID=$(echo "$RESPONSE" | jq -r '.messageId')
    QUEUED=$(echo "$RESPONSE" | jq -r '.queued')

    echo "   ✅ Sent: messageId=$MESSAGE_ID, queued=$QUEUED"

    # Save thread for subsequent messages
    if [ -z "$LAST_THREAD_ID" ]; then
        LAST_THREAD_ID="$MESSAGE_ID"
    fi

    # Platform-specific response handling
    case "$TEST_PLATFORM" in
        slack)
            # For Slack, we can optionally poll for responses when a bot token is available.
            if [ "$QUEUED" = "true" ]; then
                echo "   📋 Queued directly - checking logs..."
                sleep 2
            elif [ -z "$SLACK_BOT_TOKEN" ]; then
                echo "   📋 Sent via configured Slack connection"
                echo "   ℹ️  Set SLACK_BOT_TOKEN to enable automatic reply polling"
            else
                echo "   ⏳ Waiting for bot response..."
                START_TIME=$(date +%s)

                while true; do
                    CURRENT_TIME=$(date +%s)
                    ELAPSED=$((CURRENT_TIME - START_TIME))

                    if [ $ELAPSED -ge $TIMEOUT ]; then
                        echo "   ❌ Timeout: No bot response within ${TIMEOUT}s"
                        exit 1
                    fi

                    # Check for replies in thread
                    REPLIES=$(curl -s -X POST https://slack.com/api/conversations.replies \
                        -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
                        -H "Content-Type: application/x-www-form-urlencoded" \
                        -d "channel=$CHANNEL&ts=$LAST_THREAD_ID&limit=20")

                    # Check if we got bot messages after our message
                    BOT_RESPONSE=$(echo "$REPLIES" | jq -r '.messages[]? | select(.bot_id != null) | select(.ts > "'"$MESSAGE_ID"'") | .text' | head -1)

                    if [ -n "$BOT_RESPONSE" ]; then
                        echo "   ✅ Bot responded:"
                        echo "      $(echo "$BOT_RESPONSE" | head -c 200)..."
                        break
                    fi

                    sleep 2
                done
            fi
            ;;
        whatsapp)
            # For WhatsApp, we can't poll for responses - just wait and check logs
            echo "   📋 Message sent to WhatsApp - check your phone for response"
            if [ "$QUEUED" = "true" ]; then
                echo "   ⏳ Waiting for processing..."
                sleep 5
            fi
            ;;
        telegram)
            echo "   📋 Message sent to Telegram via configured connection"
            echo "   ℹ️  Automatic reply polling is unavailable without tguser credentials"
            ;;
    esac

    echo ""
done

echo "🎉 All messages sent successfully!"
exit 0
