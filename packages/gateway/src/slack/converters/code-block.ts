#!/usr/bin/env bun

import type { ModuleButton } from "./types";

/**
 * Metadata structure parsed from code blocks
 */
export interface CodeBlockMetadata {
  action?: string;
  show?: boolean;
  [key: string]: string | boolean | number | undefined;
}

/**
 * Parse metadata from code block strings like "action: create_pr, show: true"
 */
export function parseCodeBlockMetadata(metadataStr: string): CodeBlockMetadata {
  const metadata: CodeBlockMetadata = {};
  metadataStr?.split(",").forEach((pair) => {
    const [key, value] = pair.split(":").map((s) => s.trim());
    if (key && value) {
      const cleanKey = key.replace(/"/g, "");
      let cleanValue: string | boolean | number = value.replace(/"/g, "");
      if (cleanValue === "true") cleanValue = true;
      else if (cleanValue === "false") cleanValue = false;
      else if (!Number.isNaN(Number(cleanValue)))
        cleanValue = Number(cleanValue);
      metadata[cleanKey] = cleanValue;
    }
  });
  return metadata;
}

/**
 * Process a code block with action metadata and return button configuration
 */
export function processCodeBlockWithAction(
  language: string,
  metadata: CodeBlockMetadata,
  codeContent: string,
  blockIndex: number,
  generateActionId: (content: string, prefix: string) => string
): {
  shouldHideBlock: boolean;
  shouldSkipButton: boolean;
  button?: ModuleButton;
  debugMessage?: string;
} {
  if (language === "blockkit") {
    // Always hide the code block from the message for blockkit actions
    // The show parameter doesn't affect button creation for blockkit
    const buttonValue = JSON.stringify({
      blocks: codeContent
        ? JSON.parse(codeContent.trim()).blocks || [
            JSON.parse(codeContent.trim()),
          ]
        : { blocks: [] },
    });

    // Skip the button entirely if value exceeds 2000 chars (Slack limit)
    if (!validateContentLength(buttonValue, 2000)) {
      return {
        shouldHideBlock: true,
        shouldSkipButton: true,
        debugMessage: `Skipping blockkit button - exceeds 2000 char limit (${buttonValue.length} chars), action: ${metadata.action}`,
      };
    }

    const actionId = generateActionId(
      codeContent + metadata.action + blockIndex,
      "blockkit_form"
    );
    const button: ModuleButton = {
      text: metadata.action || "Submit",
      action_id: actionId,
      value: buttonValue,
    };

    return {
      shouldHideBlock: true,
      shouldSkipButton: false,
      button,
      debugMessage: `Added blockkit button - action: ${metadata.action}, actionId: ${actionId}`,
    };
  } else {
    // For non-blockkit actions (bash, python, etc.)
    // Hide the code block unless show: true
    const shouldHideBlock = metadata.show !== true;

    // Skip entirely if show: false (no button)
    if (metadata.show === false) {
      return {
        shouldHideBlock,
        shouldSkipButton: true,
        debugMessage: `Skipping ${language} action with show:false - action: ${metadata.action}`,
      };
    }

    if (codeContent) {
      // Skip the button entirely if value exceeds 2000 chars (Slack limit)
      if (!validateContentLength(codeContent, 2000)) {
        return {
          shouldHideBlock,
          shouldSkipButton: true,
          debugMessage: `Skipping ${language} button - exceeds 2000 char limit (${codeContent.length} chars), action: ${metadata.action}`,
        };
      }

      const actionId = generateActionId(
        codeContent + metadata.action + blockIndex,
        language
      );
      const button: ModuleButton = {
        text: metadata.action || "Run",
        action_id: `${language}_${actionId}`,
        value: codeContent,
      };

      return {
        shouldHideBlock,
        shouldSkipButton: false,
        button,
        debugMessage: `Added ${language} button - action: ${metadata.action}, actionId: ${language}_${actionId}`,
      };
    }
  }

  return {
    shouldHideBlock: false,
    shouldSkipButton: true,
  };
}

/**
 * Validate content length against Slack limits
 */
export function validateContentLength(
  content: string,
  maxLength: number
): boolean {
  return content.length <= maxLength;
}
