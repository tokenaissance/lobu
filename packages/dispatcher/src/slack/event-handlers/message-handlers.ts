#!/usr/bin/env bun

import type { App } from "@slack/bolt";
import logger from "../../logger";
import { type EventHandlerContext, setupEventHandlers } from "./utils";

/**
 * Message-related event handlers
 */

/**
 * Handle message changes (edits)
 */
async function handleMessageChanged({ event }: EventHandlerContext) {
  // Message edits don't require worker session updates since workers
  // process messages asynchronously and have already received the original content
  logger.info(`Message changed: ${JSON.stringify(event, null, 2)}`);
}

/**
 * Handle message deletions
 */
async function handleMessageDeleted({ event }: EventHandlerContext) {
  // Message deletions don't require worker session cleanup since workers
  // process messages asynchronously and sessions have their own TTL-based cleanup
  logger.info(`Message deleted: ${JSON.stringify(event, null, 2)}`);
}

/**
 * Setup message-related event handlers
 */
export function setupMessageHandlers(app: App) {
  setupEventHandlers(app, {
    message_changed: handleMessageChanged,
    message_deleted: handleMessageDeleted,
  });
}
