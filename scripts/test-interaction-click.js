#!/usr/bin/env bun
/**
 * Test script to simulate clicking a Slack interaction (radio button)
 * Usage: ./scripts/test-interaction-click.js <interaction_id> <option_index>
 */

import { config } from "dotenv";
import Redis from "ioredis";

config();

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const GATEWAY_URL = process.env.PUBLIC_GATEWAY_URL || "http://localhost:3000";
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

if (!SLACK_BOT_TOKEN) {
  console.error("❌ SLACK_BOT_TOKEN not set");
  process.exit(1);
}

const interactionId = process.argv[2];
const optionIndex = process.argv[3] || "0";

if (!interactionId) {
  console.error(
    "Usage: ./scripts/test-interaction-click.js <interaction_id> <option_index>"
  );
  console.error(
    "Example: ./scripts/test-interaction-click.js ui_4e74cd8d-af38-4515-9a02-fda6098b41db 0"
  );
  process.exit(1);
}

async function testInteractionClick() {
  const redis = new Redis(REDIS_URL);

  try {
    // Get interaction from Redis
    const interactionKey = `interaction:${interactionId}`;
    const interactionData = await redis.get(interactionKey);

    if (!interactionData) {
      console.error(`❌ Interaction ${interactionId} not found in Redis`);
      process.exit(1);
    }

    const interaction = JSON.parse(interactionData);
    console.log(`📋 Found interaction: ${interaction.question}`);
    console.log(`   Thread: ${interaction.threadId}`);
    console.log(`   Channel: ${interaction.channelId}`);

    // Determine the answer based on option type
    let answer;
    const options = interaction.options;

    if (Array.isArray(options)) {
      // Simple radio buttons
      const index = parseInt(optionIndex, 10);
      if (index < 0 || index >= options.length) {
        console.error(
          `❌ Invalid option index ${index} for ${options.length} options`
        );
        process.exit(1);
      }
      answer = options[index];
      console.log(`✅ Selecting option ${index}: "${answer}"`);
    } else {
      console.error(
        `❌ Only simple radio button interactions are supported by this test script`
      );
      process.exit(1);
    }

    // Call the interaction respond API directly
    const response = await fetch(`${GATEWAY_URL}/api/interactions/respond`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        interactionId,
        answer,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(
        `❌ Failed to respond to interaction: ${response.status} ${error}`
      );
      process.exit(1);
    }

    console.log(`✅ Successfully clicked option ${optionIndex}: "${answer}"`);
    console.log(
      `🔗 Check thread: https://peerbotcommunity.slack.com/archives/${interaction.channelId}/p${interaction.threadId.replace(".", "")}`
    );
  } catch (error) {
    console.error(`❌ Error:`, error);
    process.exit(1);
  } finally {
    await redis.quit();
  }
}

testInteractionClick();
