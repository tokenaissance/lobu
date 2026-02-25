import { createLogger, type UserSuggestion } from "@lobu/core";
import type { WebClient } from "@slack/web-api";
import type { InteractionService, PostedQuestion } from "../interactions";
import { convertMarkdownToSlack } from "./converters/markdown";
import type { MessageHandler as SlackMessageHandler } from "./events/messages";
import type { SlackContext } from "./types";

const logger = createLogger("slack-interactions");

// ============================================================================
// SLACK INTERACTION RENDERER
// ============================================================================

export class SlackInteractionRenderer {
  constructor(
    private client: WebClient,
    private interactionService: InteractionService
  ) {
    this.interactionService.on(
      "question:created",
      (question: PostedQuestion) => {
        this.renderQuestion(question).catch((error) => {
          logger.error("Failed to render question:", error);
        });
      }
    );

    this.interactionService.on(
      "suggestion:created",
      (suggestion: UserSuggestion) => {
        this.renderSuggestion(suggestion).catch((error) => {
          logger.error("Failed to render suggestion:", error);
        });
      }
    );
  }

  /**
   * Render question with radio buttons inline
   */
  async renderQuestion(question: PostedQuestion): Promise<void> {
    logger.info(`Rendering question ${question.id}`);

    const questionText = convertMarkdownToSlack(question.question);

    const blocks: any[] = [
      {
        type: "section",
        text: { type: "mrkdwn", text: questionText },
      },
      {
        type: "actions",
        elements: [
          {
            type: "radio_buttons",
            action_id: `radio_${question.id}`,
            options: question.options.map((opt, idx) => ({
              text: {
                type: "plain_text",
                text: opt.length > 75 ? `${opt.substring(0, 72)}...` : opt,
              },
              value: `${idx}`,
            })),
          },
        ],
      },
    ];

    await this.client.chat.postMessage({
      channel: question.channelId,
      thread_ts: question.conversationId,
      text: questionText,
      blocks,
    });

    await this.setThreadStatus(question.channelId, question.conversationId, "");
  }

  /**
   * Render suggestions
   */
  async renderSuggestion(suggestion: UserSuggestion): Promise<void> {
    try {
      await this.client.assistant.threads.setSuggestedPrompts({
        channel_id: suggestion.channelId,
        thread_ts: suggestion.conversationId,
        prompts: suggestion.prompts.map((p) => ({
          title: p.title,
          message: p.message,
        })),
      });
    } catch (error) {
      logger.warn("Failed to set suggested prompts:", error);
    }
  }

  /**
   * Set thread status (or clear if null)
   */
  async setThreadStatus(
    channelId: string,
    conversationId: string,
    status: string | null
  ): Promise<void> {
    try {
      await this.client.assistant.threads.setStatus({
        channel_id: channelId,
        thread_ts: conversationId,
        status: status || "",
      });
    } catch (error) {
      logger.warn("Failed to set thread status:", error);
    }
  }
}

// ============================================================================
// INTERACTION HANDLERS
// ============================================================================

/**
 * Register radio button handler — on selection, post chosen option as a
 * synthetic user message and route through normal message handling.
 */
export function registerInteractionHandlers(
  app: any,
  messageHandler: SlackMessageHandler
): void {
  // Radio button selection → post selected option as synthetic message
  app.action(/^radio_(.+)$/, async ({ ack, action, body, client }: any) => {
    await ack();

    const matches = action.action_id.match(/^radio_(.+)$/);
    if (!matches) return;

    const [_, questionId] = matches;
    const selectedIndex = parseInt(action.selected_option.value, 10);
    const selectedText =
      action.selected_option?.text?.text || `Option ${selectedIndex + 1}`;

    const userId = body.user?.id;
    const channelId = body.channel?.id;
    const messageTs = body.message?.ts;
    const threadTs = body.message?.thread_ts || messageTs;

    if (!channelId || !threadTs) {
      logger.warn("Missing channel or thread info for radio selection");
      return;
    }

    logger.info({ questionId, selectedText, userId }, "Radio option selected");

    // Update original message to show selection (disable buttons)
    try {
      const questionText = body.message?.blocks?.[0]?.text?.text || "Question";
      await (client as WebClient).chat.update({
        channel: channelId,
        ts: messageTs,
        text: `${questionText}\n\n> ${selectedText}`,
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: questionText },
          },
          {
            type: "section",
            text: { type: "mrkdwn", text: `> ${selectedText}` },
          },
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: `Selected by <@${userId}>`,
              },
            ],
          },
        ],
      });
    } catch (error) {
      logger.warn("Failed to update question message:", error);
    }

    // Post selection as a visible message in the thread
    try {
      const postResult = await (client as WebClient).chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: selectedText,
      });

      // Route through normal message handling
      const context: SlackContext = {
        userId: userId!,
        channelId,
        teamId: body.team?.id || "",
        messageTs: postResult.ts as string,
        threadTs,
        text: selectedText,
      };

      await messageHandler.handleUserRequest(
        context,
        selectedText,
        client as WebClient
      );
    } catch (error) {
      logger.error("Failed to route radio selection as message:", error);
    }
  });
}
