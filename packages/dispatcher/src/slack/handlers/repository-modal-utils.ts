import { createLogger } from "@peerbot/shared";
// GitHub utility imports are loaded dynamically when needed

const logger = createLogger("dispatcher");

export interface RepositoryModalOptions {
  userId: string;
  body: any;
  client: any;
  checkAdminStatus?: boolean;
  getGitHubUserInfo?: (
    userId: string
  ) => Promise<{ token: string | null; username: string | null }>;
}

/**
 * Shared utility for opening repository selection modal
 * Used by both ActionHandler and ShortcutCommandHandler
 */
export async function openRepositoryModal({
  userId,
  body,
  client,
  checkAdminStatus = false,
  getGitHubUserInfo,
}: RepositoryModalOptions): Promise<void> {
  logger.info(`Opening repository modal for user ${userId}`);

  try {
    if (!getGitHubUserInfo) {
      throw new Error("getGitHubUserInfo function must be provided");
    }

    const githubUser = await getGitHubUserInfo(userId);

    // Store channel_id in metadata for context-aware selection
    const metadata: any = {};

    // Check if this was triggered from a channel or DM
    if (body.channel?.id) {
      metadata.channel_id = body.channel.id;
    } else if (body.container?.channel_id) {
      metadata.channel_id = body.container.channel_id;
    }

    // Check if user is admin (for channel repository selection)
    let isAdmin = false;
    if (
      checkAdminStatus &&
      metadata.channel_id &&
      !metadata.channel_id.startsWith("D")
    ) {
      try {
        const channelInfo = await client.conversations.info({
          channel: metadata.channel_id,
        });
        isAdmin = channelInfo.channel?.creator === userId || false;
      } catch (error) {
        logger.warn(
          `Could not check admin status for ${userId} in ${metadata.channel_id}`
        );
      }
    }

    const blocks: any[] = [];

    if (!githubUser.token) {
      // User not connected to GitHub
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*GitHub Not Connected*\n\nYou need to connect your GitHub account first to select repositories.",
        },
      });

      const { generateGitHubAuthUrl } = await import(
        "../../../../../modules/github/utils"
      );
      const authUrl = generateGitHubAuthUrl(userId);
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `<${authUrl}|🔗 Connect with GitHub>`,
        },
      });
    } else {
      // Build repository options
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            isAdmin &&
            metadata.channel_id &&
            !metadata.channel_id.startsWith("D")
              ? "*Select Repository for Channel*\n\nChoose how you want to set up your repository:"
              : "*Select Repository*\n\nChoose how you want to set up your repository:",
        },
      });

      // Option 1: Use existing repository
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*Option 1: Use Existing Repository*",
        },
      });

      blocks.push({
        type: "input",
        block_id: "existing_repo_input",
        element: {
          type: "external_select",
          action_id: "existing_repo_select",
          placeholder: {
            type: "plain_text",
            text: "Search for a repository...",
          },
          min_query_length: 0, // Show initial options immediately
        },
        label: {
          type: "plain_text",
          text: "Repository",
        },
        optional: true,
      });

      blocks.push({
        type: "divider",
      });

      // Option 2: Create new repository
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*Option 2: Create New Repository*",
        },
      });

      blocks.push({
        type: "input",
        block_id: "new_repo_input",
        element: {
          type: "plain_text_input",
          action_id: "new_repo_name",
          placeholder: {
            type: "plain_text",
            text: "my-new-project",
          },
        },
        label: {
          type: "plain_text",
          text: "New Repository Name",
        },
        optional: true,
        hint: {
          type: "plain_text",
          text: `Will be created in your GitHub account`,
        },
      });

      if (
        isAdmin &&
        metadata.channel_id &&
        !metadata.channel_id.startsWith("D")
      ) {
        blocks.push({
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: "⚠️ As a channel admin, this will set the repository for all channel members",
            },
          ],
        });
      }
    }

    await client.views.open({
      trigger_id: body.trigger_id,
      view: {
        type: "modal",
        callback_id: "repository_selection",
        private_metadata: JSON.stringify(metadata),
        title: { type: "plain_text", text: "Repository Selection" },
        submit: githubUser.token
          ? { type: "plain_text", text: "Select" }
          : undefined,
        close: { type: "plain_text", text: "Cancel" },
        blocks: blocks,
      },
    });
  } catch (error) {
    logger.error(`Failed to open repository modal for ${userId}:`, error);
  }
}
