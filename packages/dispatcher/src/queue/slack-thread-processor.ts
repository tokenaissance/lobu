#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { WebClient } from "@slack/web-api";
import { marked } from "marked";
import PgBoss from "pg-boss";
import type { GitHubRepositoryManager } from "../github/repository-manager";

// Generate deterministic action IDs based on content to prevent conflicts during rapid message updates - fixed
function generateDeterministicActionId(
  content: string,
  prefix: string = "action"
): string {
  const hash = createHash("sha256")
    .update(content)
    .digest("hex")
    .substring(0, 8);
  return `${prefix}_${hash}`;
}
// Enhanced markdown to Slack conversion with proper handling of all common markdown elements
function processMarkdownAndBlockkit(content: string): {
  text: string;
  blocks: any[];
} {
  // Process blockkit with metadata first
  const codeBlockRegex = /```(\w+)\s*\{([^}]+)\}\s*\n?([\s\S]*?)\n?```/g;
  let processedContent = content;
  const actionButtons: any[] = [];
  let blockIndex = 0; // Track position to ensure unique action_ids

  let match;
  // biome-ignore lint/suspicious/noAssignInExpressions: Required for regex matching pattern
  while ((match = codeBlockRegex.exec(content)) !== null) {
    const [fullMatch, language, metadataStr, codeContent] = match;

    try {
      const metadata: any = {};
      metadataStr?.split(",").forEach((pair) => {
        const [key, value] = pair.split(":").map((s) => s.trim());
        if (key && value) {
          const cleanKey = key.replace(/"/g, "");
          let cleanValue: any = value.replace(/"/g, "");
          if (cleanValue === "true") cleanValue = true;
          if (cleanValue === "false") cleanValue = false;
          metadata[cleanKey] = cleanValue;
        }
      });

      if (metadata.action) {
        console.log(
          `[DEBUG] Found action block - language: ${language}, action: ${metadata.action}, show: ${metadata.show}`
        );

        if (language === "blockkit") {
          // Always hide the code block from the message for blockkit actions
          processedContent = processedContent.replace(fullMatch, "");

          // Skip entirely if show: false
          if (metadata.show === false) {
            console.log(
              `[DEBUG] Skipping blockkit with show:false - action: ${metadata.action}`
            );
            continue;
          }

          const parsed = codeContent
            ? JSON.parse(codeContent.trim())
            : { blocks: [] };
          const buttonValue = JSON.stringify({
            blocks: parsed.blocks || [parsed],
          });

          // Skip the button entirely if value exceeds 2000 chars (Slack limit)
          if (buttonValue.length > 2000) {
            console.log(
              `[DEBUG] Skipping blockkit button - exceeds 2000 char limit (${buttonValue.length} chars), action: ${metadata.action}`
            );
            continue;
          }

          const actionId = generateDeterministicActionId(
            codeContent + metadata.action + blockIndex,
            "blockkit_form"
          );
          const button = {
            type: "button",
            text: { type: "plain_text", text: metadata.action },
            action_id: actionId,
            value: buttonValue,
          };
          actionButtons.push(button);
          console.log(
            `[DEBUG] Added blockkit button - action: ${metadata.action}, actionId: ${actionId}`
          );
        } else {
          // For non-blockkit actions (bash, python, etc.)
          // Hide the code block unless show: true
          if (metadata.show !== true) {
            processedContent = processedContent.replace(fullMatch, "");
          }

          // Skip entirely if show: false (no button)
          if (metadata.show === false) {
            console.log(
              `[DEBUG] Skipping ${language} action with show:false - action: ${metadata.action}`
            );
            continue;
          }

          if (codeContent) {
            // Skip the button entirely if value exceeds 2000 chars (Slack limit)
            if (codeContent.length > 2000) {
              console.log(
                `[DEBUG] Skipping ${language} button - exceeds 2000 char limit (${codeContent.length} chars), action: ${metadata.action}`
              );
              continue;
            }

            const actionId = generateDeterministicActionId(
              codeContent + metadata.action + blockIndex,
              language
            );
            const button = {
              type: "button",
              text: { type: "plain_text", text: metadata.action },
              action_id: `${language}_${actionId}`,
              value: codeContent,
            };
            actionButtons.push(button);
            console.log(
              `[DEBUG] Added ${language} button - action: ${metadata.action}, actionId: ${language}_${actionId}`
            );
          }
        }
      }

      blockIndex++; // Increment for each processed block to ensure unique action_ids
    } catch (error) {
      console.error("Failed to parse code block:", error);
    }
  }

  // Enhanced markdown to Slack conversion
  const text = convertMarkdownToSlack(processedContent);

  // Always create at least one block
  const blocks: any[] = [];

  if (text) {
    // Slack has a 3000 character limit for text in section blocks
    const MAX_TEXT_LENGTH = 3000;

    if (text.length <= MAX_TEXT_LENGTH) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: text,
        },
      });
    } else {
      // Split long text into multiple blocks
      let remainingText = text;
      while (remainingText.length > 0) {
        // Take up to MAX_TEXT_LENGTH characters, but try to break at a newline if possible
        let chunk = remainingText.substring(0, MAX_TEXT_LENGTH);

        // If we're not at the end and we're cutting mid-text, try to find a better break point
        if (remainingText.length > MAX_TEXT_LENGTH) {
          const lastNewline = chunk.lastIndexOf("\n");
          if (lastNewline > MAX_TEXT_LENGTH * 0.8) {
            // If there's a newline in the last 20% of the chunk
            chunk = chunk.substring(0, lastNewline);
          }
        }

        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: chunk,
          },
        });

        remainingText = remainingText.substring(chunk.length).trim();
      }
    }
  }

  if (actionButtons.length > 0) {
    console.log(
      `[DEBUG] Adding ${actionButtons.length} action buttons to blocks`
    );
    if (blocks.length > 0) blocks.push({ type: "divider" });
    blocks.push({
      type: "actions",
      elements: actionButtons,
    });
  }

  console.log(
    `[DEBUG] processMarkdownAndBlockkit returning - text length: ${text?.length || 0}, blocks count: ${blocks.length}, action buttons: ${actionButtons.length}`
  );

  return { text, blocks };
}

/**
 * Custom renderer for converting markdown to Slack's mrkdwn format
 */
class SlackRenderer extends marked.Renderer {
  heading(text: string, _level: number): string {
    // Convert headings - preserve inline formatting like bold/italic
    // Headers themselves are not automatically bold in Slack

    let processedText = text;

    // Convert markdown bold (**text**) to Slack bold (*text*)
    processedText = processedText.replace(/\*\*(.+?)\*\*/g, "*$1*");

    // Convert markdown bold (__text__) to Slack bold (*text*)
    processedText = processedText.replace(/__(.+?)__/g, "*$1*");

    // Convert markdown italic (*text*) to Slack italic (_text_)
    // But be careful not to convert Slack bold markers we just added
    processedText = processedText.replace(
      /(?<!\*)\*(?!\*)([^*]+)(?<!\*)\*(?!\*)/g,
      "_$1_"
    );

    // Add extra spacing after headers for visual separation
    return `${processedText}\n\n`;
  }

  paragraph(text: string): string {
    return `${text}\n\n`;
  }

  strong(text: string): string {
    // Bold in Slack is *text*
    return `*${text}*`;
  }

  em(text: string): string {
    // Italic in Slack is _text_
    return `_${text}_`;
  }

  code(text: string): string {
    // Inline code in Slack is `text`
    return `\`${text}\``;
  }

  codespan(text: string): string {
    // Inline code in Slack is `text`
    return `\`${text}\``;
  }

  blockquote(quote: string): string {
    // Convert blockquote to italic with quote prefix
    const lines = quote.trim().split("\n");
    return `${lines.map((line) => `_> ${line.trim()}_`).join("\n")}\n\n`;
  }

  list(body: string, _ordered: boolean, _start: number | ""): string {
    return `${body}\n`;
  }

  listitem(text: string, _task?: boolean, _checked?: boolean): string {
    // Slack supports bullet points and numbered lists
    return `• ${text.trim()}\n`;
  }

  link(href: string, _title: string | null | undefined, text: string): string {
    // Slack link format is <url|text>
    return `<${href}|${text}>`;
  }

  br(): string {
    return "\n";
  }

  hr(): string {
    return "\n---\n\n";
  }
}

/**
 * Convert markdown to Slack's mrkdwn format using marked with custom renderer
 */
export function convertMarkdownToSlack(content: string): string {
  const renderer = new SlackRenderer();

  // First, handle raw triple backtick code blocks that might not be properly formatted
  // This handles cases where content has ```language\ncode\n``` format
  const preprocessed = content.replace(
    /```(\w*)\n?([\s\S]*?)```/g,
    (match, lang, code) => {
      // Convert to a format that marked can handle properly
      if (code?.trim()) {
        // Use HTML pre/code tags that marked will process
        const langAttr = lang ? ` class="language-${lang}"` : "";
        return `<pre><code${langAttr}>${code.trim()}</code></pre>`;
      }
      return match;
    }
  );

  // Configure marked options
  marked.setOptions({
    renderer: renderer,
    breaks: true, // Convert single line breaks to <br>
    gfm: true, // GitHub flavored markdown
  });

  try {
    let processed = marked.parse(preprocessed) as string;

    // Clean up extra whitespace but preserve intentional line breaks
    processed = processed
      .replace(/\n{3,}/g, "\n\n") // Max 2 consecutive newlines
      .trim();

    // Handle code blocks specially - marked converts them to HTML, we need to convert back to Slack format
    // Note: Slack doesn't support triple backtick code blocks in text fields, only in blocks
    // So we'll convert code blocks to single-line code format for the text field
    processed = processed.replace(
      /<pre><code(?:\s+class="language-(\w+)")?>([\s\S]*?)<\/code><\/pre>/g,
      (_match, _language, code) => {
        // Decode HTML entities in code blocks
        const decodedCode = code
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&amp;/g, "&")
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'");

        // For Slack text field, use single backticks for inline code
        // For multi-line code, we'll use indentation instead of backticks
        // since Slack text fields don't support proper code blocks
        const lines = decodedCode.trim().split("\n");
        if (lines.length === 1) {
          return `\`${lines[0]}\``;
        } else {
          // For multi-line code, use indentation (4 spaces) instead of backticks
          // This preserves the code structure without causing issues with # symbols
          return lines.map((line: string) => `    ${line}`).join("\n");
        }
      }
    );

    // Clean up any remaining HTML entities that might have been introduced
    processed = processed
      .replace(/&gt;/g, ">")
      .replace(/&lt;/g, "<")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");

    return processed;
  } catch (error) {
    console.error("Failed to parse markdown:", error);
    // Fallback to original content if parsing fails
    return content;
  }
}

/**
 * Generate GitHub action buttons for the session branch
 */
async function generateGitHubActionButtons(
  userId: string,
  gitBranch: string | undefined,
  hasGitChanges: boolean | undefined,
  pullRequestUrl: string | undefined,
  userMappings: Map<string, string>,
  repoManager: GitHubRepositoryManager,
  slackClient?: any
): Promise<any[] | undefined> {
  try {
    logger.debug(
      `Generating GitHub action buttons for user ${userId}, gitBranch: ${gitBranch}, hasGitChanges: ${hasGitChanges}, pullRequestUrl: ${pullRequestUrl}`
    );

    // If no git branch provided, don't show buttons
    if (!gitBranch) {
      logger.debug(`No git branch provided, skipping GitHub buttons`);
      return undefined;
    }

    // Check if we're on a session branch (indicates work has been done)
    const isSessionBranch = gitBranch.startsWith("claude/");

    // Show buttons if:
    // 1. There are uncommitted changes, OR
    // 2. An existing PR exists, OR
    // 3. We're on a session branch (even if all changes are committed)
    if (!hasGitChanges && !pullRequestUrl && !isSessionBranch) {
      logger.debug(
        `No git changes, no PR, and not a session branch, skipping GitHub buttons`
      );
      return undefined;
    }

    // Get GitHub username from Slack user ID
    let githubUsername = userMappings.get(userId);
    if (!githubUsername && slackClient) {
      // Create user mapping on-demand if not found
      logger.debug(`Creating on-demand user mapping for user ${userId}`);
      try {
        const userInfo = await slackClient.users.info({ user: userId });
        const user = userInfo.user;

        let username =
          user.profile?.display_name || user.profile?.real_name || user.name;
        if (!username) {
          username = userId;
        }

        // Sanitize username for GitHub
        username = username
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, "-")
          .replace(/^-|-$/g, "");

        username = `user-${username}`;
        userMappings.set(userId, username);
        githubUsername = username;

        logger.info(`Created user mapping: ${userId} -> ${username}`);
      } catch (error) {
        logger.error(`Failed to create user mapping for ${userId}:`, error);
        const fallbackUsername = `user-${userId.substring(0, 8)}`;
        userMappings.set(userId, fallbackUsername);
        githubUsername = fallbackUsername;
      }
    }

    if (!githubUsername) {
      logger.debug(`No GitHub username mapping found for user ${userId}`);
      return undefined;
    }

    // Get repository information, create if needed
    const repository = await repoManager.ensureUserRepository(githubUsername);
    if (!repository) {
      logger.debug(`No repository found for GitHub user ${githubUsername}`);
      return undefined;
    }

    const repoUrl = repository.repositoryUrl;
    const repoPath = repoUrl.replace("https://github.com/", "");

    logger.info(
      `Showing action buttons for branch: ${gitBranch}, PR exists: ${!!pullRequestUrl}`
    );

    const buttons: any[] = [];

    // Show appropriate PR button based on whether PR exists
    if (pullRequestUrl) {
      // PR exists - show view button with green checkmark
      buttons.push({
        type: "button",
        text: { type: "plain_text", text: "✅ View PR" },
        url: pullRequestUrl,
        action_id: generateDeterministicActionId(
          `view_pr_${repoPath}_${gitBranch}`,
          "github_view_pr"
        ),
      });
    } else if (hasGitChanges || isSessionBranch) {
      // No PR but has changes OR on a session branch - show create PR button
      buttons.push({
        type: "button",
        text: { type: "plain_text", text: "🔀 Pull Request" },
        action_id: generateDeterministicActionId(
          `pr_${repoPath}_${gitBranch}`,
          "github_pr"
        ),
        value: JSON.stringify({
          action: "create_pr",
          repo: repoPath,
          branch: gitBranch,
          prompt: "Review your code, cleanup temporary files, commit changes to GIT and create a pull request",
        }),
      });
    }

    // View Code button
    if (hasGitChanges) {
      // Has uncommitted changes - show action button to commit/push first
      buttons.push({
        type: "button",
        text: { type: "plain_text", text: "📝 View Code" },
        action_id: generateDeterministicActionId(
          `code_${repoPath}_${gitBranch}`,
          "github_code"
        ),
        value: JSON.stringify({
          action: "view_code",
          repo: repoPath,
          branch: gitBranch,
          prompt: "Commit and push changes, then view code",
        }),
      });
    } else {
      // No uncommitted changes - show direct link to view code
      buttons.push({
        type: "button",
        text: { type: "plain_text", text: "View Code" },
        url: `https://github.dev/${repoPath}/tree/${gitBranch}`,
        action_id: generateDeterministicActionId(
          `code_${repoPath}_${gitBranch}`,
          "github_code_link"
        ),
      });
    }

    return buttons.length > 0 ? buttons : undefined;
  } catch (_error) {
    // Return undefined on error - this will result in no action buttons being added
    return undefined;
  }
}

import logger from "../logger";

interface ThreadResponsePayload {
  messageId: string;
  channelId: string;
  threadTs: string;
  userId: string;
  content?: string;
  processedMessageIds?: string[];
  reaction?: string;
  error?: string;
  timestamp: number;
  originalMessageTs?: string; // User's original message timestamp for reactions
  gitBranch?: string; // Current git branch for Edit button URLs
  hasGitChanges?: boolean; // Whether there are uncommitted/unpushed changes
  pullRequestUrl?: string; // URL of existing PR if any
  botResponseTs?: string; // Bot's response message timestamp for updates
  claudeSessionId?: string; // Claude session ID for tracking bot messages per session
}

/**
 * Consumer that listens to thread_response queue and updates Slack messages
 * This handles all Slack communication that was previously done by the worker
 */
export class ThreadResponseConsumer {
  private pgBoss: PgBoss;
  private slackClient: WebClient;
  private isRunning = false;
  private repoManager: GitHubRepositoryManager;
  private userMappings: Map<string, string>; // slackUserId -> githubUsername
  private sessionBotMessages: Map<string, string> = new Map(); // sessionKey -> botMessageTs

  constructor(
    connectionString: string,
    slackToken: string,
    repoManager: GitHubRepositoryManager,
    userMappings: Map<string, string>
  ) {
    this.pgBoss = new PgBoss(connectionString);
    this.slackClient = new WebClient(slackToken);
    this.repoManager = repoManager;
    this.userMappings = userMappings;
  }

  /**
   * Start consuming thread_response messages
   */
  async start(): Promise<void> {
    try {
      await this.pgBoss.start();

      // Create the thread_response queue if it doesn't exist
      await this.pgBoss.createQueue("thread_response");

      // Register job handler for thread response messages
      await this.pgBoss.work(
        "thread_response",
        this.handleThreadResponse.bind(this)
      );

      this.isRunning = true;
      logger.info("✅ Thread response consumer started");
    } catch (error) {
      logger.error("Failed to start thread response consumer:", error);
      throw error;
    }
  }

  /**
   * Stop the consumer
   */
  async stop(): Promise<void> {
    try {
      this.isRunning = false;
      await this.pgBoss.stop();
      logger.info("✅ Thread response consumer stopped");
    } catch (error) {
      logger.error("Error stopping thread response consumer:", error);
      throw error;
    }
  }

  /**
   * Handle thread response message jobs
   */
  private async handleThreadResponse(job: any): Promise<void> {
    let data;

    try {
      // Handle PgBoss serialized format (similar to worker queue consumer)
      if (typeof job === "object" && job !== null) {
        const keys = Object.keys(job);
        const numericKeys = keys.filter((key) => !Number.isNaN(Number(key)));

        if (numericKeys.length > 0) {
          // PgBoss passes jobs as an array, get the first element
          const firstKey = numericKeys[0];
          const firstJob = firstKey ? job[firstKey] : null;

          if (
            typeof firstJob === "object" &&
            firstJob !== null &&
            firstJob.data
          ) {
            // This is the actual job object from PgBoss
            data = firstJob.data;
            console.log(
              `📤 AGENT RESPONSE: Processing agent response for user ${data.userId}, thread ${data.threadId || "unknown"}, jobId: ${firstJob.id}`
            );
          } else {
            throw new Error(
              "Invalid job format: expected job object with data field"
            );
          }
        } else {
          // Fallback - might be normal job format
          data = job.data || job;
        }
      } else {
        data = job;
      }

      if (!data || !data.messageId) {
        throw new Error(
          `Invalid thread response data: ${JSON.stringify(data)}`
        );
      }

      logger.info(
        `Processing thread response job for message ${data.messageId}, originalMessageTs: ${data.originalMessageTs}, claudeSessionId: ${data.claudeSessionId}, botResponseTs: ${data.botResponseTs}`
      );

      // Create a session key to track bot messages per conversation
      // Use the claudeSessionId as the primary key when available
      // This ensures all messages from the same worker session update the same bot message
      const sessionKey = data.claudeSessionId
        ? `session:${data.claudeSessionId}`
        : `${data.userId}:${data.originalMessageTs || data.messageId}`;

      logger.info(`Using session key: ${sessionKey}`);

      // Check if we have a bot message for this Claude session
      // First check if the worker provided a bot message timestamp
      const existingBotMessageTs =
        data.botResponseTs || this.sessionBotMessages.get(sessionKey);
      const isFirstResponse = !existingBotMessageTs;
      // Use originalMessageTs for reactions (the actual user message timestamp)
      const reactionTimestamp = data.originalMessageTs || data.messageId;

      // Handle reaction transitions without gear. Completion is signaled by processedMessageIds presence.
      const isDM = data.channelId?.startsWith("D");
      if (data.error && reactionTimestamp) {
        // Error: change eyes to x on the relevant message
        await this.updateReaction(
          data.channelId,
          reactionTimestamp,
          "eyes",
          "x"
        );
      }

      // On completion, processedMessageIds will be provided
      if (
        Array.isArray(data.processedMessageIds) &&
        data.processedMessageIds.length > 0
      ) {
        if (isDM) {
          // Remove eyes from each processed user message (no checkmarks in DMs)
          for (const ts of data.processedMessageIds) {
            try {
              await this.slackClient.reactions.remove({
                channel: data.channelId,
                timestamp: ts,
                name: "eyes",
              });
            } catch (_e) {
              // ignore if reaction not present
            }
          }
        } else {
          // Channel: only the root thread message should get the checkmark
          await this.updateReaction(
            data.channelId,
            data.threadTs,
            "eyes",
            "white_check_mark"
          );
        }
      }

      // Handle message content
      if (data.content) {
        // Pass the existing bot message timestamp if we have one
        const botMessageTs = existingBotMessageTs || data.botResponseTs;
        const newBotResponseTs = await this.handleMessageUpdate(
          data,
          isFirstResponse,
          botMessageTs
        );

        // Store the bot response timestamp for future updates
        if (isFirstResponse && newBotResponseTs) {
          logger.info(
            `Bot created first response with ts: ${newBotResponseTs}, storing for session ${sessionKey}`
          );
          this.sessionBotMessages.set(sessionKey, newBotResponseTs);

          // Also send the bot message timestamp back to the worker for future updates
          // This ensures the worker can include it in subsequent thread_response messages
          try {
            if (data.claudeSessionId) {
              await this.pgBoss.send("worker_metadata_update", {
                claudeSessionId: data.claudeSessionId,
                botResponseTs: newBotResponseTs,
                channelId: data.channelId,
                threadTs: data.threadTs,
              });
            }
          } catch (error) {
            logger.debug(
              `Failed to send bot message timestamp to worker: ${error}`
            );
          }
        }
      } else if (data.error) {
        // Pass the existing bot message timestamp for error updates
        const botMessageTs = existingBotMessageTs || data.botResponseTs;
        await this.handleError(data, isFirstResponse, botMessageTs);
      }

      // Log completion when processedMessageIds is present but DON'T clear session
      // Keep the session active so any late-arriving messages still update the same bot message
      if (
        Array.isArray(data.processedMessageIds) &&
        data.processedMessageIds.length > 0
      ) {
        logger.info(
          `Thread processing completed for message ${data.messageId}`
        );
        // Don't clear the session here - it will be cleared when a new user message arrives
        // This prevents duplicate bot messages if the worker sends more messages after completion
      }
    } catch (error: any) {
      // Check if it's a validation error that shouldn't be retried
      if (
        error?.data?.error === "invalid_blocks" ||
        error?.data?.error === "msg_too_long" ||
        error?.code === "slack_webapi_platform_error"
      ) {
        logger.error(
          `Slack validation error in job ${job.id}: ${error?.data?.error || error.message}`
        );

        // Try to inform the user about the validation error
        if (data?.channelId && data.messageId) {
          try {
            await this.slackClient.chat.update({
              channel: data.channelId,
              ts: data.messageId,
              text: `❌ **Message update failed**\n\n**Error:** ${error?.data?.error || error.message}\n\nThe response may contain invalid formatting or be too long for Slack.`,
            });
            logger.info(
              `Notified user about validation error in job ${job.id}`
            );
          } catch (notifyError) {
            logger.error(
              `Failed to notify user about validation error: ${notifyError}`
            );
          }
        }

        // Don't throw - mark job as complete to prevent retry loops
        return;
      }

      logger.error(`Failed to process thread response job ${job.id}:`, error);
      throw error; // Let pgboss handle retry logic for other errors
    }
  }

  /**
   * Update reactions atomically (remove old, add new)
   */
  private async updateReaction(
    channel: string,
    timestamp: string,
    oldReaction: string,
    newReaction: string
  ): Promise<void> {
    console.log(
      `🔄 REACTION UPDATE: Changing ${oldReaction} → ${newReaction} on message ${timestamp} in channel ${channel}`
    );

    try {
      // Remove old reaction
      console.log(
        `🗑️  REACTION CHANGE: Removing '${oldReaction}' from message ${timestamp}`
      );
      await this.slackClient.reactions.remove({
        channel,
        timestamp,
        name: oldReaction,
      });
      console.log(
        `✅ REACTION REMOVED: '${oldReaction}' successfully removed from message ${timestamp}`
      );
    } catch (error) {
      // Ignore - reaction might not exist
      console.log(
        `⚠️  REACTION REMOVE: '${oldReaction}' reaction might not exist on message ${timestamp}:`,
        error
      );
      logger.debug(
        `Failed to remove ${oldReaction} reaction (might not exist):`,
        error
      );
    }

    try {
      // Add new reaction
      console.log(
        `➕ REACTION CHANGE: Adding '${newReaction}' to message ${timestamp}`
      );
      await this.slackClient.reactions.add({
        channel,
        timestamp,
        name: newReaction,
      });
      console.log(
        `✅ REACTION ADDED: '${newReaction}' successfully added to message ${timestamp}`
      );
      logger.info(
        `Updated reaction: ${oldReaction} → ${newReaction} on message ${timestamp}`
      );
    } catch (error) {
      // Ignore - reaction might already exist
      logger.debug(
        `Failed to add ${newReaction} reaction (might already exist):`,
        error
      );
    }
  }

  /**
   * Handle message content updates
   */
  private async handleMessageUpdate(
    data: ThreadResponsePayload,
    isFirstResponse: boolean,
    botMessageTs?: string
  ): Promise<string | undefined> {
    const { content, channelId, threadTs, userId } = data;

    if (!content) return;

    try {
      // Process markdown and blockkit content
      console.log(
        `[DEBUG] Processing content for Slack - content length: ${content?.length || 0}`
      );
      const result = processMarkdownAndBlockkit(content);
      console.log(
        `[DEBUG] processMarkdownAndBlockkit result - blocks: ${result.blocks?.length || 0}, has actions: ${result.blocks?.some((b) => b.type === "actions")}`
      );

      // Get GitHub action buttons for this session
      const githubActionButtons = await generateGitHubActionButtons(
        userId,
        data.gitBranch,
        data.hasGitChanges,
        data.pullRequestUrl,
        this.userMappings,
        this.repoManager,
        this.slackClient
      );

      // Add GitHub action buttons as a separate actions block
      if (githubActionButtons && githubActionButtons.length > 0) {
        // Add a divider before the GitHub actions if there are other blocks
        if (result.blocks.length > 0) {
          result.blocks.push({ type: "divider" });
        }

        // Add the GitHub action buttons as an actions block
        result.blocks.push({
          type: "actions",
          elements: githubActionButtons,
        });
      }

      // Truncate text to Slack's limit (3000 chars for text field)
      const MAX_TEXT_LENGTH = 3000;
      const truncatedText =
        (result.text || content).length > MAX_TEXT_LENGTH
          ? (result.text || content).substring(0, MAX_TEXT_LENGTH - 20) +
            "\n...[truncated]"
          : result.text || content;

      // Add blocks (always have at least one)
      const MAX_BLOCKS = 50;
      const blocks = result.blocks.slice(0, MAX_BLOCKS);
      console.log(
        `[DEBUG] Final blocks to send - count: ${blocks.length}, types: ${blocks.map((b) => b.type).join(", ")}`
      );
      if (blocks.some((b) => b.type === "actions")) {
        console.log(
          `[DEBUG] Actions block elements:`,
          blocks.find((b) => b.type === "actions")?.elements
        );
      }

      if (isFirstResponse) {
        // Create new message for first response
        logger.info(
          `Creating new bot message in channel ${channelId}, thread ${threadTs}`
        );
        const postResult = await this.slackClient.chat.postMessage({
          channel: channelId,
          thread_ts: threadTs,
          text: truncatedText,
          mrkdwn: true,
          blocks: blocks,
          unfurl_links: true,
          unfurl_media: true,
        });

        logger.info(
          `Bot message created: ${postResult.ok}, ts: ${postResult.ts}`
        );

        if (!postResult.ok) {
          logger.error(`Failed to create bot message: ${postResult.error}`);
          return;
        }

        // CRITICAL: Validate that Slack created the message in the correct thread
        const returnedTs = postResult.ts as string;
        const returnedThreadTs =
          (postResult.message as any)?.thread_ts || returnedTs;

        // Check if the message was created in the intended thread
        if (threadTs && returnedThreadTs !== threadTs) {
          // Delete the wrongly placed message
          try {
            await this.slackClient.chat.delete({
              channel: channelId,
              ts: returnedTs,
            });
            logger.info(`Deleted misplaced message ${returnedTs}`);
          } catch (deleteError) {
            logger.error(`Failed to delete misplaced message:`, deleteError);
          }

          // Retry with explicit thread creation
          await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait 1 second

          const retryResult = await this.slackClient.chat.postMessage({
            channel: channelId,
            thread_ts: threadTs,
            text: truncatedText,
            mrkdwn: true,
            blocks: blocks,
            unfurl_links: true,
            unfurl_media: true,
            reply_broadcast: false, // Ensure it stays in thread
          });

          if (!retryResult.ok) {
            throw new Error(
              `Failed to create bot message after retry: ${retryResult.error}`
            );
          }

          return retryResult.ts as string;
        }

        return returnedTs; // Return the new message timestamp
      } else {
        // Update existing message - use the passed botMessageTs or fallback
        const botTs = botMessageTs || data.botResponseTs || threadTs;
        logger.info(
          `Updating bot message in channel ${channelId}, ts ${botTs}`
        );

        const updateResult = await this.slackClient.chat.update({
          channel: channelId,
          ts: botTs,
          text: truncatedText,
          blocks: blocks,
        });

        logger.info(`Slack update result: ${updateResult.ok}`);

        if (!updateResult.ok) {
          logger.error(`Slack update failed with error: ${updateResult.error}`);
        }
      }
    } catch (error: any) {
      // Handle specific Slack errors
      if (error.code === "message_not_found") {
        logger.error("Slack message not found - it may have been deleted");
      } else if (error.code === "channel_not_found") {
        logger.error("Slack channel not found - bot may not have access");
      } else if (error.code === "not_in_channel") {
        logger.error("Bot is not in the channel");
      } else if (
        error.data?.error === "invalid_blocks" ||
        error.data?.error === "msg_too_long"
      ) {
        // These are Slack validation errors - retrying won't help
        logger.error(`Slack validation error: ${JSON.stringify(error)}`);

        // Try to send a simple error message with raw content for recovery
        try {
          // Truncate content to fit in code block (leave room for error message + code block formatting)
          const maxContentLength = 2500; // Conservative limit
          const truncatedContent =
            content.length > maxContentLength
              ? `${content.substring(0, maxContentLength)}\n...[truncated]`
              : content;

          const errorMessage = `❌ *Error occurred while updating message*\n\n*Error:* ${error.data?.error || ""}${error.message || ""}\n\nThe response may be too long or contain invalid formatting.\n\n*Raw Content:*\n\`\`\`\n${truncatedContent}\n\`\`\``;

          await this.slackClient.chat.update({
            channel: channelId,
            ts: threadTs,
            text: errorMessage,
          });
          logger.info(
            `Sent fallback error message with raw content for validation error: ${error.data?.error}`
          );
        } catch (fallbackError) {
          logger.error("Failed to send fallback error message:", fallbackError);
          // If even the fallback fails, try a minimal message
          try {
            await this.slackClient.chat.update({
              channel: channelId,
              ts: threadTs,
              text: `❌ *Error occurred while updating message*\n\n*Error:* ${error.data?.error || error.message}`,
            });
          } catch (minimalError) {
            logger.error("Failed to send minimal error message:", minimalError);
          }
        }
        // Don't throw - this prevents retry loops for validation errors
      } else {
        logger.error(`Failed to update Slack message: ${error.message}`);
        throw error;
      }
    }
  }

  /**
   * Handle error messages
   */
  private async handleError(
    data: ThreadResponsePayload,
    isFirstResponse: boolean,
    botMessageTs?: string
  ): Promise<void> {
    const { error, channelId, threadTs, userId } = data;

    if (!error) return;

    try {
      logger.info(
        `Sending error message to channel ${channelId}, thread ${threadTs}`
      );

      const errorContent = `❌ **Error occurred**\n\n**Error:** \`${error}\``;

      // Simple error message
      const errorResult = {
        text: errorContent,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: errorContent,
            },
          },
        ],
      };

      // Get GitHub action buttons for this session
      const githubActionButtons = await generateGitHubActionButtons(
        userId,
        data.gitBranch,
        data.hasGitChanges,
        data.pullRequestUrl,
        this.userMappings,
        this.repoManager,
        this.slackClient
      );

      // Add GitHub action buttons if available
      if (githubActionButtons && githubActionButtons.length > 0) {
        // Add a divider before the GitHub actions
        errorResult.blocks.push({
          type: "divider",
        } as any);

        // Add the GitHub action buttons as an actions block
        errorResult.blocks.push({
          type: "actions",
          elements: githubActionButtons,
        } as any);
      }

      if (isFirstResponse) {
        // Create new error message
        const postResult = await this.slackClient.chat.postMessage({
          channel: channelId,
          thread_ts: threadTs,
          text: errorResult.text || errorContent,
          mrkdwn: true,
          blocks: errorResult.blocks,
          unfurl_links: true,
          unfurl_media: true,
        });
        logger.info(`Error message created: ${postResult.ok}`);
      } else {
        // Update existing message with error - use the passed botMessageTs or fallback
        const botTs = botMessageTs || data.botResponseTs || threadTs;
        const updateResult = await this.slackClient.chat.update({
          channel: channelId,
          ts: botTs,
          text: errorResult.text || errorContent,
          blocks: errorResult.blocks,
        });
        logger.info(`Error message update result: ${updateResult.ok}`);
      }
    } catch (updateError: any) {
      logger.error(
        `Failed to send error message to Slack: ${updateError.message}`
      );
      throw updateError;
    }
  }

  /**
   * Check if consumer is running and healthy
   */
  isHealthy(): boolean {
    return this.isRunning;
  }

  /**
   * Get current status
   */
  getStatus(): {
    isRunning: boolean;
  } {
    return {
      isRunning: this.isRunning,
    };
  }
}
