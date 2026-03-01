import { createLogger } from "@lobu/core";

const logger = createLogger("dispatcher");

import type { AnyBlock } from "@slack/types";
import type { WebClient } from "@slack/web-api";
import {
  buildSettingsUrl,
  formatSettingsTokenTtl,
  generateSettingsToken,
} from "../../auth/settings/token-service";
import type { DispatcherModuleSource } from "../../modules/module-system";
import { resolveSpace } from "../../spaces";
import type { SlackActionBody, SlackContext } from "../types";
import type { MessageHandler } from "./messages";

/**
 * Block action handlers for interactive elements
 */

/**
 * Handle executable code block button clicks
 * Sends the code content back to Claude for execution
 */
async function handleExecutableCodeBlock(
  actionId: string,
  userId: string,
  channelId: string,
  messageTs: string,
  body: SlackActionBody,
  client: WebClient,
  handleUserRequestFn: (
    context: SlackContext,
    userInput: string,
    client: WebClient
  ) => Promise<void>
): Promise<void> {
  logger.info(`Handling executable code block: ${actionId}`);

  try {
    // Extract the code from the button's value
    const bodyWithActions = body as {
      actions?: Array<{ value?: string; text?: { text?: string } }>;
    };
    const action = bodyWithActions.actions?.[0];
    if (!action?.value) {
      throw new Error("No code content found in button");
    }

    const codeContent = action.value;
    const language = actionId.split("_")[0]; // Extract language from action_id
    const buttonText = action.text?.text || `Run ${language}`;

    // Post the code execution request as a user message
    const formattedInput = `> 🚀 *Executed "${buttonText}" button*\n\n\`\`\`${language}\n${codeContent}\n\`\`\``;

    // Get the actual thread_ts from the message (messageTs is where button was clicked)
    // If message has thread_ts, use it; otherwise this IS the thread root
    const bodyWithMessage = body as { message?: { thread_ts?: string } };
    const actualThreadTs = bodyWithMessage.message?.thread_ts || messageTs;

    const inputMessage = await client.chat.postMessage({
      channel: channelId,
      thread_ts: actualThreadTs,
      text: formattedInput,
      blocks: [
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `<@${userId}> executed "${buttonText}" button`,
            } as any,
          ],
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `\`\`\`${language}\n${codeContent}\n\`\`\``,
          },
        },
      ],
    });

    const context = {
      channelId,
      userId,
      userDisplayName: (body as any).user?.name || "Unknown User",
      teamId: (body as any).team?.id || "",
      messageTs: inputMessage.ts as string,
      threadTs: actualThreadTs,
      text: formattedInput,
    };

    await handleUserRequestFn(context, formattedInput, client);
  } catch (error) {
    logger.error(`Failed to handle executable code block ${actionId}:`, error);
    const actualThreadTs = (body as any)?.message?.thread_ts || messageTs;
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: actualThreadTs,
      text: `❌ Failed to execute code: ${error instanceof Error ? error.message : "Unknown error"}`,
    });
  }
}

/**
 * Handle blockkit form button clicks
 * Opens a modal with the blockkit form content
 */
async function handleBlockkitForm(
  actionId: string,
  channelId: string,
  messageTs: string,
  body: SlackActionBody,
  client: WebClient
): Promise<void> {
  logger.info(`Handling blockkit form: ${actionId}`);

  try {
    // Extract the blocks from the button's value
    const action = (body as any).actions?.[0];
    if (!action?.value) {
      logger.error(`No form data found in button for action ${actionId}`);
      throw new Error("No form data found in button");
    }

    let formData;
    try {
      formData = JSON.parse(action.value);
    } catch (parseError) {
      logger.error(
        `Failed to parse form data for action ${actionId}:`,
        parseError
      );
      logger.error(`Raw value: ${action.value}`);
      throw new Error(`Invalid JSON in form data: ${parseError}`);
    }

    const blocks = formData.blocks || [];

    if (blocks.length === 0) {
      logger.error(`No blocks found in form data for action ${actionId}`);
      throw new Error("No blocks found in form data");
    }

    // Check if trigger_id exists
    if (!body.trigger_id) {
      logger.error(`No trigger_id in body for action ${actionId}`);
      throw new Error("No trigger_id available - cannot open modal");
    }

    // Get the actual thread_ts from the message (messageTs is where button was clicked)
    // If message has thread_ts, use it; otherwise this IS the thread root
    const actualThreadTs = (body as any).message?.thread_ts || messageTs;

    logger.info(
      `Opening modal for action ${actionId}, trigger_id: ${body.trigger_id}`
    );

    // Create modal with the blockkit form
    const modalResult = await client.views.open({
      trigger_id: body.trigger_id,
      view: {
        type: "modal",
        callback_id: "blockkit_form_modal",
        private_metadata: JSON.stringify({
          channel_id: channelId,
          thread_ts: actualThreadTs,
          action_id: actionId,
          button_text: action.text?.text || "Form",
        }),
        title: { type: "plain_text", text: action.text?.text || "Form" },
        submit: { type: "plain_text", text: "Submit" },
        close: { type: "plain_text", text: "Cancel" },
        blocks: blocks,
      } as any,
    });

    logger.info(
      `Modal opened successfully for action ${actionId}, ok: ${modalResult.ok}`
    );
  } catch (error: unknown) {
    const err = error as {
      message?: string;
      data?: unknown;
      code?: string;
      stack?: string;
    };
    logger.error(`Failed to handle blockkit form ${actionId}:`, {
      error: err.message,
      data: err.data,
      code: err.code,
      stack: err.stack,
    });

    // Show the raw Block Kit content for troubleshooting
    const rawBlocksJson = JSON.stringify(body, null, 2);
    const truncatedBlocks =
      rawBlocksJson.length > 2500
        ? `${rawBlocksJson.substring(0, 2500)}\n...[truncated]`
        : rawBlocksJson;

    const bodyWithMessage = body as { message?: { thread_ts?: string } };
    const actualThreadTs = bodyWithMessage?.message?.thread_ts || messageTs;
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: actualThreadTs,
      text: `❌ Failed to open form: ${error instanceof Error ? error.message : "Unknown error"}\n\nRaw Block Kit (truncated):\n\`\`\`json\n${truncatedBlocks}\n\`\`\`\n\nTip: Some blocks are not modal-compatible.`,
    });
  }
}

export class ActionHandler {
  constructor(
    private messageHandler: MessageHandler,
    private moduleRegistry: DispatcherModuleSource
  ) {}

  /**
   * Handle block action events
   */
  async handleBlockAction(
    actionId: string,
    userId: string,
    channelId: string,
    messageTs: string,
    body: SlackActionBody,
    client: WebClient
  ): Promise<void> {
    logger.info(`Handling block action: ${actionId}`);

    // Interaction handlers (radio_, submit_, section_, next_) are registered
    // via Slack Bolt app.action() in interactions.ts
    // Don't handle them here - let them pass through to Bolt handlers
    if (actionId.match(/^(radio|submit|section|next)_/)) {
      logger.debug(
        `Skipping ${actionId} - handled by Bolt interaction handlers`
      );
      return;
    }

    // Try to handle action through modules first
    let handled = false;
    const dispatcherModules = this.moduleRegistry.getDispatcherModules();

    // Resolve agentId from context for module actions
    const isDirectMessage = channelId.startsWith("D");
    const { agentId } = resolveSpace({
      platform: "slack",
      userId,
      channelId,
      isGroup: !isDirectMessage,
    });

    for (const module of dispatcherModules) {
      if (module.handleAction) {
        const moduleHandled = await module.handleAction(
          actionId,
          userId,
          agentId,
          {
            channelId,
            client,
            body,
            agentId,
            updateAppHome: this.updateAppHome.bind(this),
            messageHandler: this.messageHandler,
          }
        );
        if (moduleHandled) {
          handled = true;
          break;
        }
      }
    }

    if (!handled) {
      // Handle Settings button from home tab
      if (actionId === "open_settings") {
        await this.handleOpenSettings(userId, client);
      }
      // Handle blockkit form button clicks
      else if (actionId.startsWith("blockkit_form_")) {
        await handleBlockkitForm(actionId, channelId, messageTs, body, client);
      }
      // Handle executable code block buttons
      else if (
        actionId.match(/^(bash|python|javascript|js|typescript|ts|sql|sh)_/)
      ) {
        await handleExecutableCodeBlock(
          actionId,
          userId,
          channelId,
          messageTs,
          body,
          client,
          (context: SlackContext, userRequest: string, client: WebClient) =>
            this.messageHandler.handleUserRequest(context, userRequest, client)
        );
      } else {
        logger.info(
          `Unsupported action: ${actionId} from user ${userId} in channel ${channelId}`
        );
      }
    }
  }

  /**
   * Handle "Open Settings" button click from home tab
   * Generates a settings link and sends it via DM
   */
  private async handleOpenSettings(
    userId: string,
    client: WebClient
  ): Promise<void> {
    logger.info(`Generating settings link for user: ${userId}`);

    try {
      // Resolve agentId for user's personal space (DM context)
      const { agentId } = resolveSpace({
        platform: "slack",
        userId,
        channelId: userId, // Use userId as channelId for DM-like context
        isGroup: false,
      });

      // Generate settings token (configured TTL, default 1 hour)
      const token = generateSettingsToken(agentId, userId, "slack");
      const settingsUrl = buildSettingsUrl(token);
      const ttlLabel = formatSettingsTokenTtl();

      // Send DM with settings link
      await client.chat.postMessage({
        channel: userId, // DM to user
        text: `Here's your settings link (expires in ${ttlLabel}):\n${settingsUrl}`,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "*Your Settings Link*\nConfigure skills, MCP servers, environment variables, and more.",
            },
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: { type: "plain_text", text: "Open Settings" },
                url: settingsUrl,
                style: "primary",
              },
            ],
          },
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: `_This link expires in ${ttlLabel}. Click the button above or copy the URL._`,
              } as any,
            ],
          },
        ],
      });

      logger.info(`Settings link sent to user ${userId}`);
    } catch (error) {
      logger.error(`Failed to send settings link to user ${userId}:`, error);

      // Try to send error message to user
      try {
        await client.chat.postMessage({
          channel: userId,
          text: "Sorry, I couldn't generate your settings link. Please try again.",
        });
      } catch {
        // Ignore if DM fails
      }
    }
  }

  /**
   * Update App Home tab - simple welcome with Settings button
   */
  async updateAppHome(userId: string, client: WebClient): Promise<void> {
    logger.info(`Updating app home for user: ${userId}`);

    try {
      const blocks: AnyBlock[] = [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "*Welcome to Lobu!* 👋\n\nYour AI coding assistant is ready to help.",
          },
        },
        {
          type: "divider",
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "*Configure Your Agent*\nSet up skills, MCP servers, environment variables, and more.",
          },
          accessory: {
            type: "button",
            text: { type: "plain_text", text: "Open Settings" },
            action_id: "open_settings",
            style: "primary",
          },
        },
        {
          type: "divider",
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text:
              "*💡 Quick Tips:*\n" +
              "• Mention me in any channel or DM me directly\n" +
              "• Ask questions about code, create features, or fix bugs\n" +
              "• Use the Settings button above to configure skills and integrations",
          },
        },
      ];

      // Update the app home view
      await client.views.publish({
        user_id: userId,
        view: {
          type: "home",
          blocks,
        } as any,
      });

      logger.info(`App home updated for user ${userId}`);
    } catch (error) {
      logger.error(`Failed to update app home for user ${userId}:`, error);
    }
  }
}
