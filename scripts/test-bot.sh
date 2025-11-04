#!/bin/bash
set -e

# Bot testing script with multi-message support
# Usage: ./scripts/test-bot.sh "message 1" ["message 2"] ["message 3"] ...
# Or: ./scripts/test-bot.sh (uses default test message)
# Environment: TEST_CHANNEL, SLACK_BOT_TOKEN, TEST_TIMEOUT (default: 30s)

# Load .env if it exists
if [ -f .env ]; then
    export $(grep -v '^#' .env | grep -E 'SLACK_BOT_TOKEN|TEST_CHANNEL|TEST_USER_ID' | sed 's/#.*//' | xargs)
fi

CHANNEL="${TEST_CHANNEL:-test-channel}"
TIMEOUT="${TEST_TIMEOUT:-30}"

if [ -z "$SLACK_BOT_TOKEN" ]; then
    echo "❌ SLACK_BOT_TOKEN environment variable is required"
    exit 1
fi

# Get messages from arguments or use default
if [ $# -eq 0 ]; then
    MESSAGES=("@me test message")
else
    MESSAGES=("$@")
fi

echo "🧪 Testing bot with ${#MESSAGES[@]} message(s)"
echo "📍 Channel: $CHANNEL"
echo "⏱️  Timeout: ${TIMEOUT}s"
echo ""

LAST_THREAD_ID=""

# Send each message sequentially
for i in "${!MESSAGES[@]}"; do
    MESSAGE="${MESSAGES[$i]}"
    MSG_NUM=$((i + 1))
    
    echo "[$MSG_NUM/${#MESSAGES[@]}] 📤 Sending: $MESSAGE"
    
    # Build request body
    if [ -n "$LAST_THREAD_ID" ]; then
        BODY="{\"platform\":\"slack\",\"channel\":\"$CHANNEL\",\"message\":\"$MESSAGE\",\"threadId\":\"$LAST_THREAD_ID\"}"
    else
        BODY="{\"platform\":\"slack\",\"channel\":\"$CHANNEL\",\"message\":\"$MESSAGE\"}"
    fi
    
    # Send message
    RESPONSE=$(curl -s -X POST http://localhost:8080/api/messaging/send \
      -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
      -H "Content-Type: application/json" \
      -d "$BODY")
    
    # Check success
    if ! echo "$RESPONSE" | jq -e '.success' > /dev/null 2>&1; then
        echo "   ❌ Failed to send message $MSG_NUM:"
        echo "$RESPONSE" | jq
        exit 1
    fi
    
    CHANNEL_ID=$(echo "$RESPONSE" | jq -r '.channel')
    THREAD_ID=$(echo "$RESPONSE" | jq -r '.threadId')
    MESSAGE_ID=$(echo "$RESPONSE" | jq -r '.messageId')
    QUEUED=$(echo "$RESPONSE" | jq -r '.queued')
    
    echo "   ✅ Sent: messageId=$MESSAGE_ID, queued=$QUEUED"
    
    # Save thread for subsequent messages
    LAST_THREAD_ID="$THREAD_ID"
    
    # If queued, verify in logs; otherwise poll for response
    if [ "$QUEUED" = "true" ]; then
        echo "   📋 Queued directly - checking logs..."
        sleep 2
        
        # Check logs for processing
        LOGS=$(docker compose -f docker-compose.dev.yml logs gateway --tail 50 2>/dev/null || echo "")
        if echo "$LOGS" | grep -q "Processing message job.*$MESSAGE_ID"; then
            echo "   ✅ Message processed"
        else
            echo "   ⚠️  Message queued but processing not confirmed"
        fi
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
                -d "channel=$CHANNEL_ID&ts=$THREAD_ID&limit=20")
            
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
    
    echo ""
done

echo "🎉 All tests PASSED!"
exit 0
