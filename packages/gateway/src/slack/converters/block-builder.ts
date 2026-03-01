#!/usr/bin/env bun

import { createLogger } from "@lobu/core";
import type { ActionsBlockElement, Block as SlackBlock } from "@slack/types";
import { SLACK } from "../config";
import { convertMarkdownToSlack } from "./markdown";
import type { ModuleButton } from "./types";

export type { ModuleButton };

const logger = createLogger("slack-block-builder");

interface BlockBuilderOptions {
  includeActionButtons?: boolean;
  actionButtons?: ModuleButton[];
  maxBlocks?: number;
  maxTextLength?: number;
}

// Helper type for building blocks - use any to bypass Slack's strict Block union
type BlockBuilder = any;

/**
 * Builds Slack Block Kit blocks from markdown content with proper validation
 * Ensures blocks don't exceed Slack's limits
 */
export class SlackBlockBuilder {
  private readonly MAX_BLOCKS = SLACK.MAX_BLOCKS;
  private readonly MAX_TEXT_LENGTH = SLACK.MAX_BLOCK_TEXT_LENGTH;

  /**
   * Build blocks from markdown content with optional action buttons
   */
  buildBlocks(
    content: string,
    options: BlockBuilderOptions = {}
  ): { text: string; blocks: SlackBlock[] } {
    const {
      actionButtons = [],
      maxBlocks = this.MAX_BLOCKS,
      maxTextLength = this.MAX_TEXT_LENGTH,
    } = options;

    // Convert markdown to Slack format
    const text = convertMarkdownToSlack(content);
    const blocks: BlockBuilder[] = [];

    // Split long text into multiple section blocks
    if (text) {
      this.addTextBlocks(blocks, text, maxTextLength);
    }

    // Add action buttons if provided
    if (actionButtons.length > 0) {
      this.addActionButtons(blocks, actionButtons);
    }

    // Validate and truncate if needed
    const validatedBlocks = this.validateBlocks(blocks, maxBlocks);

    logger.debug(
      `Built ${validatedBlocks.length} blocks with ${actionButtons.length} action buttons`
    );

    return { text, blocks: validatedBlocks };
  }

  /**
   * Build error blocks with optional action buttons
   */
  buildErrorBlocks(
    errorMessage: string,
    actionButtons: ModuleButton[] = []
  ): { text: string; blocks: SlackBlock[] } {
    const errorContent = `❌ **Error occurred**\n\n**Error:** \`${errorMessage}\``;
    const text = convertMarkdownToSlack(errorContent);

    const blocks: BlockBuilder[] = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: text,
        },
      },
    ];

    if (actionButtons.length > 0) {
      this.addActionButtons(blocks, actionButtons);
    }

    return { text, blocks };
  }

  /**
   * Add text content as section blocks, splitting if too long
   */
  private addTextBlocks(
    blocks: BlockBuilder[],
    text: string,
    maxTextLength: number
  ): void {
    if (text.length <= maxTextLength) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: text,
        },
      });
      return;
    }

    // Split long text into chunks
    let remainingText = text;
    while (remainingText.length > 0) {
      let chunk = remainingText.substring(0, maxTextLength);

      // Try to break at a newline if possible (last 20% of chunk)
      if (remainingText.length > maxTextLength) {
        const lastNewline = chunk.lastIndexOf("\n");
        if (lastNewline > maxTextLength * 0.8) {
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

  /**
   * Add action buttons as an actions block
   */
  private addActionButtons(
    blocks: BlockBuilder[],
    buttons: ModuleButton[]
  ): void {
    // Validate buttons
    const validButtons = buttons.filter((btn) => {
      if (!btn.text || (!btn.action_id && !btn.url)) {
        logger.warn("Invalid button: missing text or action_id/url", btn);
        return false;
      }
      return true;
    });

    if (validButtons.length === 0) {
      return;
    }

    // Add divider before actions if there are other blocks
    if (blocks.length > 0) {
      blocks.push({ type: "divider" });
    }

    // Convert to Slack block elements
    const elements: ActionsBlockElement[] = validButtons.map((btn) => {
      if (btn.url) {
        return {
          type: "button",
          text: { type: "plain_text", text: btn.text },
          url: btn.url,
          action_id: btn.action_id,
          style: btn.style,
        };
      }
      return {
        type: "button",
        text: { type: "plain_text", text: btn.text },
        action_id: btn.action_id,
        style: btn.style,
        value: btn.value,
      };
    });

    blocks.push({
      type: "actions",
      elements: elements,
    });
  }

  /**
   * Validate blocks and truncate if exceeding limits
   */
  private validateBlocks(
    blocks: BlockBuilder[],
    maxBlocks: number
  ): SlackBlock[] {
    if (blocks.length <= maxBlocks) {
      return blocks;
    }

    logger.warn(
      `Blocks exceeded limit (${blocks.length} > ${maxBlocks}), truncating`
    );

    // Keep first N-1 blocks and add a truncation notice
    const truncated = blocks.slice(0, maxBlocks - 1);
    truncated.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "_...[content truncated due to Slack block limit]_",
      },
    });

    return truncated;
  }
}
