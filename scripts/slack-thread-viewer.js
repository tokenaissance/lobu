#!/usr/bin/env node

const https = require("node:https");
const path = require("node:path");

// Load credentials from .env
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;

if (!SLACK_BOT_TOKEN) {
  console.error("❌ SLACK_BOT_TOKEN environment variable is required");
  console.error("Please set SLACK_BOT_TOKEN in your .env file");
  process.exit(1);
}

function parseSlackUrl(url) {
  try {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split("/");

    // Extract channel ID from path (e.g., /archives/D095U1QV667/...)
    const channelId = pathParts[2];

    // Extract message timestamp from path (e.g., p1762042740217909)
    const messagePermalink = pathParts[3];
    let messageTs = null;

    if (messagePermalink?.startsWith("p")) {
      // Convert p1762042740217909 to 1762042740.217909
      const tsNumber = messagePermalink.substring(1);
      messageTs = `${tsNumber.slice(0, -6)}.${tsNumber.slice(-6)}`;
    }

    // Extract thread_ts from query params
    const threadTs = urlObj.searchParams.get("thread_ts");

    return {
      channelId,
      messageTs,
      threadTs: threadTs || messageTs, // Use messageTs if no thread_ts provided
    };
  } catch (error) {
    throw new Error(`Invalid Slack URL: ${error.message}`);
  }
}

async function makeSlackRequest(method, body) {
  return new Promise((resolve, reject) => {
    const needsUrlEncoding = [
      "conversations.info",
      "conversations.history",
      "conversations.replies",
    ].includes(method);
    const postData = needsUrlEncoding
      ? new URLSearchParams(body).toString()
      : JSON.stringify(body);

    const options = {
      hostname: "slack.com",
      port: 443,
      path: `/api/${method}`,
      method: "POST",
      headers: {
        Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
        "Content-Type": needsUrlEncoding
          ? "application/x-www-form-urlencoded"
          : "application/json",
        "Content-Length": Buffer.byteLength(postData),
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        try {
          const result = JSON.parse(data);
          if (result.ok) {
            resolve(result);
          } else {
            reject(new Error(`Slack API error: ${result.error}`));
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on("error", reject);
    req.write(postData);
    req.end();
  });
}

function formatTimestamp(ts) {
  const date = new Date(parseFloat(ts) * 1000);
  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatMessage(msg, index, isThreadStart = false) {
  const userDisplay = msg.user
    ? `<@${msg.user}>`
    : msg.bot_id
      ? "[BOT]"
      : "[UNKNOWN]";
  const timestamp = formatTimestamp(msg.ts);
  const prefix = isThreadStart ? "🧵 THREAD START" : `   Message ${index}`;

  let output = `\n${prefix}\n`;
  output += `├─ From: ${userDisplay}\n`;
  output += `├─ Time: ${timestamp}\n`;
  output += `├─ TS: ${msg.ts}\n`;

  if (msg.files && msg.files.length > 0) {
    output += `├─ Files: ${msg.files.length}\n`;
    msg.files.forEach((file, i) => {
      output += `│  ${i + 1}. ${file.name} (${file.mimetype})\n`;
    });
  }

  if (msg.attachments && msg.attachments.length > 0) {
    output += `├─ Attachments: ${msg.attachments.length}\n`;
  }

  if (msg.blocks && msg.blocks.length > 0) {
    output += `├─ Blocks: ${msg.blocks.length}\n`;
    output += `│  ${JSON.stringify(msg.blocks, null, 2).split("\n").join("\n│  ")}\n`;
  }

  const text = msg.text || "";
  const lines = text.split("\n");
  output += `└─ Text:\n`;
  lines.forEach((line, i) => {
    const linePrefix = i === lines.length - 1 ? "   " : "│  ";
    output += `${linePrefix}${line}\n`;
  });

  return output;
}

async function viewThread(url) {
  console.log("🔍 Slack Thread Viewer\n");

  const { channelId, messageTs, threadTs } = parseSlackUrl(url);

  console.log("📋 Thread Information:");
  console.log(`├─ Channel ID: ${channelId}`);
  console.log(`├─ Thread TS: ${threadTs}`);
  console.log(`└─ Message TS: ${messageTs}\n`);

  try {
    // Get channel info
    console.log("📡 Fetching channel information...");
    const channelInfo = await makeSlackRequest("conversations.info", {
      channel: channelId,
    });

    console.log(
      `✅ Channel: ${channelInfo.channel.name || channelInfo.channel.id}`
    );
    console.log(
      `   Type: ${channelInfo.channel.is_im ? "Direct Message" : channelInfo.channel.is_private ? "Private Channel" : "Public Channel"}\n`
    );

    // Get thread replies
    console.log("📡 Fetching thread messages...");
    const threadData = await makeSlackRequest("conversations.replies", {
      channel: channelId,
      ts: threadTs,
      limit: 1000,
    });

    if (!threadData.messages || threadData.messages.length === 0) {
      console.log("❌ No messages found in thread");
      process.exit(1);
    }

    const messageCount = threadData.messages.length;
    const hasMore = threadData.has_more;

    console.log(
      `✅ Found ${messageCount} message${messageCount > 1 ? "s" : ""}`
    );
    if (hasMore) {
      console.log("⚠️  Thread has more messages (showing first 1000)");
    }
    console.log(`\n${"=".repeat(80)}`);

    // Display thread start message
    const threadStart = threadData.messages[0];
    console.log(formatMessage(threadStart, 0, true));

    // Display replies
    if (messageCount > 1) {
      console.log("\n📨 THREAD REPLIES:");
      threadData.messages.slice(1).forEach((msg, index) => {
        console.log(formatMessage(msg, index + 1));
      });
    }

    console.log(`\n${"=".repeat(80)}`);
    console.log("\n📊 Thread Summary:");
    console.log(`├─ Total Messages: ${messageCount}`);
    console.log(`├─ Thread Started: ${formatTimestamp(threadStart.ts)}`);

    if (messageCount > 1) {
      const lastMsg = threadData.messages[messageCount - 1];
      console.log(`├─ Last Reply: ${formatTimestamp(lastMsg.ts)}`);

      const duration = parseFloat(lastMsg.ts) - parseFloat(threadStart.ts);
      const minutes = Math.floor(duration / 60);
      const seconds = Math.floor(duration % 60);
      console.log(`├─ Duration: ${minutes}m ${seconds}s`);
    }

    const userMessages = threadData.messages.filter((m) => m.user).length;
    const botMessages = threadData.messages.filter((m) => m.bot_id).length;
    console.log(`├─ User Messages: ${userMessages}`);
    console.log(`├─ Bot Messages: ${botMessages}`);

    const totalFiles = threadData.messages.reduce(
      (sum, m) => sum + (m.files?.length || 0),
      0
    );
    if (totalFiles > 0) {
      console.log(`├─ Total Files: ${totalFiles}`);
    }

    console.log(`└─ URL: ${url}\n`);
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    process.exit(1);
  }
}

// Parse command line arguments
const args = process.argv.slice(2);

if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
  console.log("Usage: slack-thread-viewer.js <slack-url>");
  console.log("");
  console.log("Examples:");
  console.log(
    "  ./slack-thread-viewer.js 'https://lobu.slack.com/archives/D095U1QV667/p1762042740217909?thread_ts=1762042394.121879&cid=D095U1QV667'"
  );
  console.log("");
  console.log("The script will:");
  console.log("  - Parse the Slack URL");
  console.log("  - Fetch all messages in the thread");
  console.log("  - Display thread information and status");
  console.log("  - Show a summary of the conversation");
  process.exit(0);
}

const slackUrl = args[0];
viewThread(slackUrl);
