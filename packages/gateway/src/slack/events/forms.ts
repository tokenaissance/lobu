#!/usr/bin/env bun

import { createLogger } from "@lobu/core";
import type {
  ActionsBlock,
  AnyBlock,
  ContextBlock,
  ModalView,
  SectionBlock,
  View,
} from "@slack/types";
import type { WebClient } from "@slack/web-api";
import type { SlackContext } from "../types";
import { type SlackMessagePayload, sendSlackMessage } from "./message-utils";

const logger = createLogger("dispatcher");

/**
 * Form submission handlers and utilities
 */

/**
 * Handle blockkit form submissions
 */
export async function handleBlockkitFormSubmission(
  userId: string,
  view: View,
  client: WebClient,
  handleUserRequestFn: (
    context: SlackContext,
    userInput: string,
    client: WebClient
  ) => Promise<void>
): Promise<void> {
  logger.info(`Handling blockkit form submission for user: ${userId}`);

  const metadata = view.private_metadata
    ? JSON.parse(view.private_metadata)
    : {};
  const channelId = metadata.channel_id;
  const threadTs = metadata.thread_ts;
  const buttonText = metadata.button_text || "Form";
  const modalView = view as ModalView;

  if (!channelId || !threadTs) {
    logger.error(
      "Missing channel or thread information in blockkit form submission"
    );
    return;
  }

  // Form processing
  // Extract input fields from state values
  const modalWithState = modalView as any; // Slack types don't properly define state
  const inputFieldsData = extractViewInputs(modalWithState.state?.values || {});

  // Extract action selections from view blocks (for button-based forms)
  const actionSelections = extractActionSelections(modalView);

  // Combine both input fields and action selections
  const userInput = [inputFieldsData, actionSelections]
    .filter((data) => data.trim())
    .join("\n");

  // If no form inputs were found, extract the content from the modal blocks
  // This handles cases where the blockkit is just informational content with action buttons
  if (!userInput.trim()) {
    logger.info(
      `No form inputs found, extracting modal content for button: ${buttonText}`
    );

    // Extract text content from the modal blocks
    const modalContent = extractModalContent(modalView.blocks || []);
    const userInput = modalContent || `Selected "${buttonText}"`;
    await dispatchFormSubmission(
      client,
      metadata,
      channelId,
      threadTs,
      userId,
      buttonText,
      userInput,
      handleUserRequestFn
    );
    return;
  }

  try {
    await dispatchFormSubmission(
      client,
      metadata,
      channelId,
      threadTs,
      userId,
      buttonText,
      userInput,
      handleUserRequestFn
    );
  } catch (error) {
    logger.error(`Failed to handle blockkit form submission:`, error);
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: `❌ Failed to process form submission: ${error instanceof Error ? error.message : "Unknown error"}`,
    });
  }
}

function buildFormSubmissionPayload(
  userId: string,
  buttonText: string,
  userInput: string
): SlackMessagePayload {
  const formattedInput = `> 📝 *Form submitted from "${buttonText}" button*\n\n${userInput}`;

  return {
    text: formattedInput,
    blocks: [
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `<@${userId}> submitted form from "${buttonText}" button`,
          } as any,
        ],
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: userInput,
        },
      },
    ] as AnyBlock[],
  };
}

async function dispatchFormSubmission(
  client: WebClient,
  metadata: Record<string, any>,
  channelId: string,
  threadTs: string,
  userId: string,
  buttonText: string,
  userInput: string,
  handler: (
    context: SlackContext,
    input: string,
    client: WebClient
  ) => Promise<void>
): Promise<void> {
  const payload = buildFormSubmissionPayload(userId, buttonText, userInput);
  const inputMessage = await sendSlackMessage(
    client,
    { type: "channel", channelId, threadTs },
    payload
  );

  const context = {
    channelId,
    userId,
    userDisplayName: metadata.user_display_name || "Unknown User",
    teamId: metadata.team_id || "",
    messageTs: inputMessage.ts as string,
    threadTs: threadTs,
    text: userInput,
  };

  await handler(context, userInput, client);
}

/**
 * Type for view state values
 */
interface ViewStateAction {
  value?: string;
  selected_option?: { value: string };
  selected_options?: Array<{ value: string }>;
  selected_date?: string;
  selected_time?: string;
  selected_button?: { value: string };
  selected_user?: string;
  selected_channel?: string;
  selected_conversation?: string;
  actions?: Array<{
    selected?: boolean;
    value?: string;
    text?: { text?: string };
    action_id?: string;
  }>;
}

function extractViewInputs(
  stateValues: Record<string, Record<string, ViewStateAction>>
): string {
  const inputs: string[] = [];
  for (const [blockId, block] of Object.entries(stateValues || {})) {
    for (const [actionId, action] of Object.entries(block)) {
      let value = "";

      // Handle different types of Slack form inputs
      if (action.value) {
        value = action.value;
      } else if (action.selected_option?.value) {
        value = action.selected_option.value;
      } else if (action.selected_options) {
        // Multi-select
        value = action.selected_options.map((opt) => opt.value).join(", ");
      } else if (action.selected_date) {
        value = action.selected_date;
      } else if (action.selected_time) {
        value = action.selected_time;
      } else if (action.selected_button) {
        // Handle button selections (radio buttons, etc.)
        value = action.selected_button.value;
      } else if (action.selected_user) {
        // Handle user picker
        value = action.selected_user;
      } else if (action.selected_channel) {
        // Handle channel picker
        value = action.selected_channel;
      } else if (action.selected_conversation) {
        // Handle conversation picker
        value = action.selected_conversation;
      } else if (action.actions && Array.isArray(action.actions)) {
        // Handle action blocks with button selections
        const selectedActions = action.actions.filter(
          (act) => act.selected || act.value
        );
        if (selectedActions.length > 0) {
          value = selectedActions
            .map((act) => act.value || act.text?.text || act.action_id)
            .join(", ");
        }
      }

      if (value?.toString().trim()) {
        // Use actionId as label if available, otherwise use blockId
        const label = actionId || blockId;
        // Convert snake_case or camelCase to readable format
        const readableLabel = label
          .replace(/[_-]/g, " ")
          .replace(/([a-z])([A-Z])/g, "$1 $2")
          .split(" ")
          .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
          .join(" ");

        inputs.push(`*${readableLabel}:* ${value}`);
      }
    }
  }

  // Debug logging to help troubleshoot form submission issues
  logger.info(
    `Form submission debug - stateValues: ${JSON.stringify(stateValues, null, 2)}`
  );
  logger.info(`Extracted inputs: ${inputs.join(", ")}`);

  return inputs.join("\n");
}

/**
 * Extract text content from modal blocks (for display-only forms)
 */
function isSectionBlock(block: AnyBlock): block is SectionBlock {
  return block.type === "section";
}

function isContextBlock(block: AnyBlock): block is ContextBlock {
  return block.type === "context";
}

function isActionsBlock(block: AnyBlock): block is ActionsBlock {
  return block.type === "actions";
}

function extractModalContent(blocks: AnyBlock[]): string {
  const content: string[] = [];

  if (!blocks || !Array.isArray(blocks)) {
    return "";
  }

  for (const block of blocks) {
    if (isSectionBlock(block) && block.text?.text) {
      // Extract section text content
      let text = block.text.text;
      // Clean up markdown formatting for plain text
      text = text.replace(/\*\*(.+?)\*\*/g, "$1"); // Bold
      text = text.replace(/\*(.+?)\*/g, "$1"); // Italic
      text = text.replace(/`(.+?)`/g, "$1"); // Code
      content.push(text);
    } else if (isContextBlock(block) && block.elements) {
      // Extract context elements
      for (const element of block.elements) {
        if (element.type === "mrkdwn" && element.text) {
          const text = element.text
            .replace(/\*\*(.+?)\*\*/g, "$1")
            .replace(/\*(.+?)\*/g, "$1");
          content.push(text);
        }
      }
    }
  }

  return content.join("\n").trim();
}

/**
 * Extract action selections from view blocks (for button-based forms)
 */
function extractActionSelections(view: View): string {
  const selections: string[] = [];

  if (!view.blocks || !Array.isArray(view.blocks)) {
    return "";
  }

  for (const block of view.blocks) {
    if (isActionsBlock(block) && block.elements) {
      // This is an action block with buttons/elements
      for (const element of block.elements) {
        if (element.type === "button" && element.text?.text) {
          // For now, we'll capture the button text as the user's selection
          // In a real scenario, we'd need to track which button was actually clicked
          // But since this is a modal submission, we know the user made a selection
          selections.push(`Selected: ${element.text.text}`);
        } else if (
          element.type === "static_select" &&
          element.placeholder?.text
        ) {
          selections.push(`Option available: ${element.placeholder.text}`);
        }
      }
    } else if (isSectionBlock(block) && block.text?.text) {
      // Capture section text as context
      const text = block.text.text;
      if (text && !text.includes("Would you like to")) {
        selections.push(text);
      }
    }
  }

  return selections.join("\n");
}
