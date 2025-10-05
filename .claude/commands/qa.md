# QA Testing Command

Test and validate the Slack bot functionality with comprehensive testing scenarios.

## Quick Start

```bash
# Basic bot test
./slack-qa-bot.js "Hello bot"

# JSON output for automation
./slack-qa-bot.js --json "Create a function" | jq -r .thread_ts
```

## Script Usage

### slack-qa-bot.js Options

- `--json`: Return structured JSON response instead of human-readable output
- `--wait-for-response`: Wait for the bot to respond before returning
- `--timeout <seconds>`: Set timeout for waiting (default: 10 seconds)
- `--thread-ts <timestamp>`: Post to existing thread instead of creating new one
- `--verbose`: Show detailed debugging information

### JSON Response Format

When using `--json` mode, the script returns structured data:

```json
{
  "success": true,
  "channel": "C0952LTF7DG",
  "thread_ts": "1756582931.437209",
  "messages_sent": 1,
  "response": {
    "text": "The result is 4.",
    "timestamp": "1756582939.241739",
    "blocks": [...],
    "bot_id": "B097WU1DV1Q"
  },
  "url": "https://peerbotcommunity.slack.com/archives/C0952LTF7DG"
}
```

**Response Fields:**

- `success`: Boolean indicating if the test passed
- `channel`: Slack channel ID where the message was sent
- `thread_ts`: Thread timestamp (use this for continuing conversations)
- `messages_sent`: Number of messages sent in this test
- `response`: Bot's response message (only when bot responds)
  - `text`: The actual response text from the bot
  - `timestamp`: When the bot sent the response
  - `blocks`: Slack blocks for rich formatting (if present)
  - `bot_id`: The responding bot's ID
- `url`: Direct link to the Slack channel
- `error`: Error message (only on failure)
- `posted_to_thread`: Original thread timestamp (when using `--thread-ts`)

## Advanced Thread Continuation with Bash Pipes

### Single-line thread continuation:

```bash
# Start a task and immediately continue in the same thread
./slack-qa-bot.js --json "Create a React component" | jq -r .thread_ts | xargs -I {} ./slack-qa-bot.js --thread-ts {} "Add TypeScript types to it"

# Chain multiple operations using pipes
./slack-qa-bot.js --json --wait-for-response "Initialize a new project" | \
  jq -r .thread_ts | \
  xargs -I {} ./slack-qa-bot.js --wait-for-response --thread-ts {} "Add a README file" | \
  jq -r .thread_ts | \
  xargs -I {} ./slack-qa-bot.js --thread-ts {} "Set up CI/CD pipeline"
```

### Interactive thread continuation with response analysis:

```bash
# Analyze bot response and continue based on content
analyze_and_continue() {
  local response=$(./slack-qa-bot.js --json --wait-for-response "$1")
  local thread_ts=$(echo "$response" | jq -r .thread_ts)
  local bot_text=$(echo "$response" | jq -r .response.text)

  echo "Bot responded: $bot_text"

  # Continue based on response content
  if echo "$bot_text" | grep -q "error\|failed"; then
    echo "Bot encountered an issue, asking for clarification..."
    ./slack-qa-bot.js --thread-ts "$thread_ts" "Can you explain the error and try again?"
  else
    echo "Bot succeeded, continuing with next step..."
    ./slack-qa-bot.js --thread-ts "$thread_ts" "Great! Now please run the tests."
  fi
}

analyze_and_continue "Create a Python function to calculate fibonacci"
```

### Thread continuation with response validation:

```bash
# Function to validate bot response and retry if needed
validate_and_retry() {
  local prompt="$1"
  local max_attempts=3
  local attempt=1

  while [ $attempt -le $max_attempts ]; do
    echo "Attempt $attempt: $prompt"

    local result=$(./slack-qa-bot.js --json --wait-for-response --timeout 30 "$prompt")
    local success=$(echo "$result" | jq -r .success)
    local thread_ts=$(echo "$result" | jq -r .thread_ts)

    if [ "$success" = "true" ]; then
      local response_text=$(echo "$result" | jq -r .response.text)
      echo "Success: $response_text"
      echo "$thread_ts"  # Return thread for further use
      return 0
    else
      echo "Attempt $attempt failed, retrying..."
      attempt=$((attempt + 1))
    fi
  done

  echo "All attempts failed"
  return 1
}

# Use the validation function
if THREAD=$(validate_and_retry "Write a unit test for the function"); then
  ./slack-qa-bot.js --thread-ts "$THREAD" "Now run the test and show results"
fi
```

### Parallel thread processing with synchronization:

```bash
# Process multiple threads in parallel, then synchronize
process_parallel_threads() {
  local threads=()
  local tasks=("Create API endpoint" "Write documentation" "Add error handling")

  # Start multiple threads in parallel
  for task in "${tasks[@]}"; do
    thread_ts=$(./slack-qa-bot.js --json "$task" | jq -r .thread_ts)
    threads+=("$thread_ts")
    echo "Started thread $thread_ts for: $task"
  done

  # Wait for all to complete and continue each
  sleep 45  # Allow time for processing

  for i in "${!threads[@]}"; do
    local thread="${threads[$i]}"
    local task="${tasks[$i]}"
    echo "Following up on thread $thread ($task)"
    ./slack-qa-bot.js --thread-ts "$thread" "Please review and finalize your work"
  done
}

process_parallel_threads
```

## Queue Testing Scenarios

**Important:** When testing thread contamination or multiple messages in the same thread, always use `--thread-ts` to send messages to an existing thread rather than creating new threads for each message.

```bash
# Test sending to existing thread (after bot completes)
THREAD=$(./slack-qa-bot.js --json "Calculate 5+5" | jq -r .thread_ts)
sleep 30  # Wait for bot to complete
./slack-qa-bot.js --thread-ts "$THREAD" --json "Now calculate 6+6"

# Test parallel message processing (send while bot is processing)
THREAD=$(./slack-qa-bot.js --json "Start a complex task" | jq -r .thread_ts)
sleep 2  # Bot is still processing
./slack-qa-bot.js --thread-ts "$THREAD" --json "Add another request while processing"

# Test worker recovery (simulate pod failure)
THREAD=$(./slack-qa-bot.js --json "Start long task" | jq -r .thread_ts)
sleep 5
docker stop $(docker ps -q --filter name=peerbot-worker-$THREAD | head -1)
sleep 2
./slack-qa-bot.js --thread-ts "$THREAD" --json "Continue after failure"
```

## URL Generation and peerbot.ai Testing

Test the bot's ability to generate URLs and validate peerbot.ai endpoints:

```bash
# Test URL generation and extraction
test_url_generation() {
  local response=$(./slack-qa-bot.js --json --wait-for-response "Generate a demo URL for a React app deployment")
  local thread_ts=$(echo "$response" | jq -r .thread_ts)
  local bot_text=$(echo "$response" | jq -r .response.text)

  # Extract peerbot.ai URLs from response
  local peerbot_urls=$(echo "$bot_text" | grep -o "https://[^.]*\.peerbot\.ai[^[:space:]]*" | head -5)

  if [ -n "$peerbot_urls" ]; then
    echo "Found peerbot.ai URLs:"
    echo "$peerbot_urls"

    # Test each URL
    while IFS= read -r url; do
      echo "Testing URL: $url"
      if curl -s --max-time 10 "$url" > /dev/null; then
        echo "✅ URL accessible: $url"
      else
        echo "❌ URL failed: $url"
      fi
    done <<< "$peerbot_urls"
  else
    echo "No peerbot.ai URLs found in response"
  fi

  return 0
}

test_url_generation
```

## Important Notes

**Reaction Detection Issues:**
The test script may sometimes report "No acknowledgment from bot" even when the bot is working correctly. This happens when the QA bot token lacks permissions to read message reactions. You can verify the bot is actually working by:

1. Checking the server logs for reaction updates (`eyes` → `gear` → `white_check_mark`)
2. Looking at the Slack channel directly to see reactions and bot responses
3. Using the verbose mode (without `--json`) to see detailed troubleshooting info

**Response Capture:**
Even with reaction detection issues, the JSON response format correctly captures bot responses when they're accessible. The `response` field will contain the bot's actual reply text, timestamp, and any rich formatting.

**Thread Continuation:**
Thread continuation works reliably regardless of reaction detection issues. The bot correctly maintains conversation context across messages in the same thread using persistent storage.
