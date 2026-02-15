import { createLogger } from "@lobu/core";
import type { App } from "@slack/bolt";
import type { WebClient } from "@slack/web-api";

const logger = createLogger("dispatcher");

/**
 * Setup team join event handler for welcome messages
 * Uses the context-aware welcome from ShortcutCommandHandler
 */
export function setupTeamJoinHandler(
  app: App,
  sendContextAwareWelcome: (
    userId: string,
    channelId: string,
    client: WebClient,
    threadTs?: string
  ) => Promise<void>
): void {
  logger.info("Setting up team_join event handler...");

  app.event("team_join", async ({ event, client }) => {
    try {
      const userId = (event as any).user?.id;
      if (!userId) {
        logger.error("No user ID in team_join event");
        return;
      }

      logger.info(`New team member joined: ${userId}`);

      // Open a DM with the new user
      const im = await client.conversations.open({ users: userId });
      if (!im.channel?.id) {
        logger.error("Failed to open DM with new user");
        return;
      }

      // Send context-aware welcome message
      await sendContextAwareWelcome(userId, im.channel.id, client);

      logger.info(`Context-aware welcome message sent to new user ${userId}`);
    } catch (error) {
      logger.error("Error handling team_join event:", error);
    }
  });
}
