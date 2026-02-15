#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { createLogger } from "@lobu/core";
import {
  parseCodeBlockMetadata,
  processCodeBlockWithAction,
} from "./code-block";
import type { ModuleButton } from "./types";

const logger = createLogger("dispatcher");

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

/**
 * Extract action buttons from code blocks with metadata
 * Returns the processed content (with hidden blocks removed) and action buttons
 */
export function extractCodeBlockActions(content: string): {
  processedContent: string;
  actionButtons: ModuleButton[];
} {
  const codeBlockRegex = /```(\w+)\s*\{([^}]+)\}\s*\n?([\s\S]*?)\n?```/g;
  let processedContent = content;
  const actionButtons: ModuleButton[] = [];
  let blockIndex = 0;

  let match;
  // biome-ignore lint/suspicious/noAssignInExpressions: Required for regex matching pattern
  while ((match = codeBlockRegex.exec(content)) !== null) {
    const [fullMatch, language, metadataStr, codeContent] = match;

    try {
      const metadata = parseCodeBlockMetadata(metadataStr || "");

      if (metadata.action) {
        logger.info(
          `Found action block - language: ${language}, action: ${metadata.action}, show: ${metadata.show}`
        );

        const result = processCodeBlockWithAction(
          language || "",
          metadata,
          codeContent || "",
          blockIndex,
          generateDeterministicActionId
        );

        // Handle content removal based on result
        if (result.shouldHideBlock) {
          processedContent = processedContent.replace(fullMatch, "");
        }

        // Skip button creation if needed
        if (result.shouldSkipButton) {
          if (result.debugMessage) {
            logger.debug(`[DEBUG] ${result.debugMessage}`);
          }
          continue;
        }

        // Add button if provided
        if (result.button) {
          actionButtons.push(result.button);
          if (result.debugMessage) {
            logger.debug(`[DEBUG] ${result.debugMessage}`);
          }
        }
      }

      blockIndex++;
    } catch (error) {
      logger.error("Failed to parse code block:", error);
    }
  }

  return { processedContent, actionButtons };
}
