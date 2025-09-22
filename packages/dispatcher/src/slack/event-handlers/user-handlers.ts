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
  // For now, just log the event
  // TODO: Implement welcome message functionality for new team members
  // Should:
  // 1. Send personalized welcome DM to new user
  // 2. Explain bot capabilities and how to get started
  // 3. Optionally create initial user repository if auto-provisioning is enabled
  // 4. Set up user preferences and default settings
  // 5. Track onboarding metrics and user engagement
  // 6. Consider team-specific welcome templates or customization
  logger.info(`Team join: ${JSON.stringify(event, null, 2)}`);
}

/**
 * Handle presence changes
 */
async function handlePresenceChange({ event }: EventHandlerContext) {
  // For now, just log the event
  // TODO: Implement worker scaling based on user presence
  // Should consider:
  // 1. Scale down idle workers when users go offline/away
  // 2. Pre-scale workers when active users come online
  // 3. Implement presence-based resource optimization
  // 4. Track user activity patterns for predictive scaling
  // 5. Handle bulk presence changes efficiently to avoid scaling storms
  // 6. Consider different scaling policies per user/team (VIP users, etc.)
  // 7. Integration with Kubernetes HPA or custom scaling logic
  // 8. Graceful session handling during scale-down operations
  logger.info(`Presence change: ${JSON.stringify(event, null, 2)}`);
}

/**
 * Handle group/channel joins
 */
async function handleMemberJoinedChannel({ event, client }: EventHandlerContext) {
  // Log the event for debugging
  logger.info(`Member joined channel: ${JSON.stringify(event, null, 2)}`);
  
  try {
    // Skip if it's a bot joining (bot user IDs typically start with 'B' or are app users)
    // The event.user is the user who joined
    if (event.user.startsWith('B')) {
      logger.info(`Skipping welcome for bot user: ${event.user}`);
      return;
    }
    
    // Also check if it's the bot itself joining
    const authResult = await client.auth.test();
    if (event.user === authResult.user_id) {
      logger.info('Bot joined channel, skipping welcome message');
      return;
    }
    
    // Send context-aware ephemeral welcome message using the callback if available
    if (memberJoinedWelcomeCallback) {
      await memberJoinedWelcomeCallback(event.user, event.channel, client);
      logger.info(`Sent ephemeral welcome message to user ${event.user} in channel ${event.channel}`);
    } else {
      logger.info(`No welcome callback configured for user ${event.user} in channel ${event.channel}`);
    }
  } catch (error) {
    logger.error('Error handling member joined channel:', error);
  }
}

/**
 * Handle workspace invite requests
 */
async function handleInviteRequested({ event }: EventHandlerContext) {
  // For now, just log the event
  // TODO: Implement invite request processing and approval workflow
  // Should:
  // 1. Validate invite requests against allowed domains/email patterns
  // 2. Auto-approve requests from trusted domains (company email, etc.)
  // 3. Queue requests for manual admin approval with notification system
  // 4. Send welcome information to approved users before they join
  // 5. Track invite metrics and conversion rates
  // 6. Integration with external approval systems (ServiceNow, Jira, etc.)
  // 7. Implement invite expiration and cleanup policies
  // 8. Support for different approval workflows per team/workspace
  // 9. Anti-spam and rate limiting for invite requests
  // 10. Audit trail for compliance (who requested, who approved, when)
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
