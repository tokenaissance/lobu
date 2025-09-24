#!/usr/bin/env bun

import type { App } from "@slack/bolt";
import logger from "../../logger";
import { type EventHandlerContext, setupEventHandlers } from "./utils";

/**
 * User and team-related event handlers
 */

/**
 * Handle team joins
 */
async function handleTeamJoin({ event }: EventHandlerContext) {
  // Welcome message functionality is implemented in welcome-handler.ts
  // This handler is primarily for logging and potential future enhancements
  logger.info(`Team join: ${JSON.stringify(event, null, 2)}`);
}

/**
 * Handle presence changes
 */
async function handlePresenceChange({ event }: EventHandlerContext) {
  // Worker scaling is currently handled by the orchestrator's TTL-based cleanup
  // Presence-based scaling would require complex orchestrator integration
  logger.info(`Presence change: ${JSON.stringify(event, null, 2)}`);
}

/**
 * Handle group/channel joins
 */
async function handleMemberJoinedChannel({
  event,
  client,
}: EventHandlerContext) {
  // Log the event for debugging
  logger.info(`Member joined channel: ${JSON.stringify(event, null, 2)}`);

  try {
    // Skip if it's a bot joining (bot user IDs typically start with 'B' or are app users)
    // The event.user is the user who joined
    if (event.user.startsWith("B")) {
      logger.info(`Skipping welcome for bot user: ${event.user}`);
      return;
    }

    // Also check if it's the bot itself joining
    const authResult = await client.auth.test();
    if (event.user === authResult.user_id) {
      logger.info("Bot joined channel, skipping welcome message");
      return;
    }

    // Send context-aware ephemeral welcome message using the callback if available
    if (memberJoinedWelcomeCallback) {
      await memberJoinedWelcomeCallback(event.user, event.channel, client);
      logger.info(
        `Sent ephemeral welcome message to user ${event.user} in channel ${event.channel}`
      );
    } else {
      logger.info(
        `No welcome callback configured for user ${event.user} in channel ${event.channel}`
      );
    }
  } catch (error) {
    logger.error("Error handling member joined channel:", error);
  }
}

/**
 * Handle workspace invite requests
 */
async function handleInviteRequested({ event }: EventHandlerContext) {
  // Invite request processing is currently handled through Slack's default workflow
  // Complex approval workflows would require additional infrastructure
  logger.info(`Invite requested: ${JSON.stringify(event, null, 2)}`);
}

/**
 * Setup user and team-related event handlers
 */
export function setupUserHandlers(app: App, sendWelcomeCallback?: any) {
  // Store the callback for use in handlers
  if (sendWelcomeCallback) {
    memberJoinedWelcomeCallback = sendWelcomeCallback;
  }

  setupEventHandlers(app, {
    team_join: handleTeamJoin,
    presence_change: handlePresenceChange,
    member_joined_channel: handleMemberJoinedChannel,
    invite_requested: handleInviteRequested,
  });
}

// Store the welcome callback
let memberJoinedWelcomeCallback: any = null;
