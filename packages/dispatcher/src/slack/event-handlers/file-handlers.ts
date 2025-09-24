#!/usr/bin/env bun

import type { App } from "@slack/bolt";
import logger from "../../logger";
import { type EventHandlerContext, setupEventHandlers } from "./utils";

/**
 * File-related event handlers
 */

/**
 * Handle file sharing
 */
async function handleFileShared({ event }: EventHandlerContext) {
  // File processing is not currently implemented
  // Users can share files directly in Claude conversations via @ mentions
  logger.info(`File shared: ${JSON.stringify(event, null, 2)}`);
}

/**
 * Handle file deletions
 */
async function handleFileDeleted({ event }: EventHandlerContext) {
  // File cleanup is not needed as files are not cached or stored by the bot
  // File availability is handled by Slack's native file management
  logger.info(`File deleted: ${JSON.stringify(event, null, 2)}`);
}

/**
 * Setup file-related event handlers
 */
export function setupFileHandlers(app: App) {
  setupEventHandlers(app, {
    file_shared: handleFileShared,
    file_deleted: handleFileDeleted,
  });
}
