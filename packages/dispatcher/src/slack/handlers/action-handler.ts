import { createLogger } from "@peerbot/shared";
// import { getDbPool } from "@peerbot/shared"; // Currently unused

const logger = createLogger("dispatcher");
import type { GitHubRepositoryManager } from "../../../../../modules/github/repository-manager";
import type { QueueProducer } from "../../queue/task-queue-producer";
import type { DispatcherConfig, SlackContext } from "../../types";
import { generateGitHubAuthUrl } from "../../../../../modules/github/utils";
import type { MessageHandler } from "./message-handler";
import {
  handleGitHubConnect,
  handleGitHubLogout,
  getUserGitHubInfo,
} from "../../../../../modules/github/handlers";
import { moduleRegistry } from "../../../../../modules";
import { handleTryDemo } from "./demo-handler";
import { openRepositoryModal } from "./repository-modal-utils";
import {
  handleBlockkitForm,
  handleExecutableCodeBlock,
  handleStopWorker,
} from "../event-handlers/block-actions";

export class ActionHandler {
  constructor(
    private repoManager: GitHubRepositoryManager,
    _queueProducer: QueueProducer, // Not used directly in ActionHandler
    private config: DispatcherConfig,
    private messageHandler: MessageHandler
  ) {
    // queueProducer passed for consistency but not used directly
  }

  /**
   * Handle block action events
   */
  async handleBlockAction(
    actionId: string,
    userId: string,
    channelId: string,
    messageTs: string,
    body: any,
    client: any
  ): Promise<void> {
    logger.info(`Handling block action: ${actionId}`);

    switch (actionId) {
      case "github_login":
        await this.handleGitHubLogin(userId, client);
        break;

      case "github_logout":
        await handleGitHubLogout(userId, client);
        // Update home tab after logout
        await this.updateAppHome(userId, client);
        break;

      case "open_repository_modal":
        await openRepositoryModal({
          userId,
          body,
          client,
          checkAdminStatus: false,
          getGitHubUserInfo: getUserGitHubInfo,
        });
        break;

      case "open_github_login_modal": {
        // Open modal with GitHub OAuth link
        const authUrl = generateGitHubAuthUrl(userId);
        await client.views.open({
          trigger_id: body.trigger_id,
          view: {
            type: "modal",
            callback_id: "github_login_modal",
            title: {
              type: "plain_text",
              text: "Connect GitHub",
            },
            blocks: [
              {
                type: "header",
                text: {
                  type: "plain_text",
                  text: "🔗 Connect Your GitHub Account",
                  emoji: true,
                },
              },
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text:
                    "Connect your GitHub account to:\n\n" +
                    "• Access your repositories\n" +
                    "• Create new projects\n" +
                    "• Manage code with AI assistance\n\n" +
                    "*Your connection is secure and encrypted.*",
                },
              },
              {
                type: "divider",
              },
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: "Click the button below to authenticate with GitHub:",
                },
              },
              {
                type: "actions",
                elements: [
                  {
                    type: "button",
                    text: {
                      type: "plain_text",
                      text: "🚀 Connect with GitHub",
                      emoji: true,
                    },
                    url: authUrl,
                    style: "primary",
                  },
                ],
              },
              {
                type: "context",
                elements: [
                  {
                    type: "mrkdwn",
                    text: "💡 *Note:* After connecting, you can select which repositories to work with.",
                  },
                ],
              },
            ],
            close: {
              type: "plain_text",
              text: "Cancel",
            },
          },
        });
        break;
      }

      case "github_connect":
        await handleGitHubConnect(userId, channelId, client);
        break;

      case "try_demo": {
        // Check if this is from the home tab (view type will be 'home')
        const fromHomeTab = body.view?.type === "home";

        // Get the message timestamp to keep demo response in same thread (if not from home)
        const demoMessageTs = body.message?.ts;

        // Pass the fromHomeTab flag to ensure DM is sent when clicked from home
        await handleTryDemo(
          userId,
          channelId,
          client,
          demoMessageTs,
          fromHomeTab
        );

        // Clear cache and update home tab after demo setup
        const username = await this.messageHandler.getOrCreateUserMapping(
          userId,
          client
        );
        this.messageHandler.clearCacheForUser(username);
        await this.updateAppHome(userId, client);
        break;
      }

      default:
        // Handle blockkit form button clicks
        if (actionId.startsWith("blockkit_form_")) {
          await handleBlockkitForm(
            actionId,
            userId,
            channelId,
            messageTs,
            body,
            client
          );
        }
        // Handle executable code block buttons
        else if (
          actionId.match(/^(bash|python|javascript|js|typescript|ts|sql|sh)_/)
        ) {
          await handleExecutableCodeBlock(
            actionId,
            userId,
            channelId,
            messageTs,
            body,
            client,
            (context: SlackContext, userRequest: string, client: any) =>
              this.messageHandler.handleUserRequest(
                context,
                userRequest,
                client
              )
          );
        }
        // Handle stop worker button clicks
        else if (actionId.startsWith("stop_worker_")) {
          const deploymentName = actionId.replace("stop_worker_", "");
          await handleStopWorker(
            deploymentName,
            userId,
            channelId,
            messageTs,
            client
          );
        }
        // Handle GitHub Pull Request button clicks
        else if (actionId.startsWith("github_pr_")) {
          await this.handleGitHubPullRequestAction(
            actionId,
            userId,
            channelId,
            messageTs,
            body,
            client
          );
        } else {
          logger.info(
            `Unsupported action: ${actionId} from user ${userId} in channel ${channelId}`
          );
        }
    }
  }

  /**
   * Handle GitHub Pull Request action
   */
  async handleGitHubPullRequestAction(
    actionId: string,
    userId: string,
    channelId: string,
    messageTs: string,
    body: any,
    client: any
  ): Promise<void> {
    const action = body.actions?.[0];
    const value = action?.value;

    if (!value) {
      logger.warn(`No value in GitHub PR action: ${actionId}`);
      return;
    }

    let metadata;
    try {
      metadata = JSON.parse(value);
    } catch (error) {
      logger.error(`Failed to parse GitHub PR metadata: ${error}`);
      return;
    }

    const { action: prAction, repo, branch, prompt } = metadata;

    logger.info(
      `GitHub PR action: ${prAction} for repo: ${repo}, branch: ${branch}`
    );

    try {
      if (prAction === "create_pr") {
        const pullRequestPrompt =
          prompt ||
          "Review your code, cleanup temporary files, commit changes to GIT and create a pull request";

        // Get the actual thread_ts from the message
        const actualThreadTs = body.message?.thread_ts || body.message?.ts;

        // Post confirmation message with the prompt (which is already markdown formatted)
        const inputMessage = await client.chat.postMessage({
          channel: channelId,
          thread_ts: actualThreadTs,
          text: `Pull Request requested`,
          blocks: [
            {
              type: "context",
              elements: [
                {
                  type: "mrkdwn",
                  text: `<@${userId}> requested a pull request`,
                },
              ],
            },
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: pullRequestPrompt,
              },
            },
          ],
        });

        const context: SlackContext = {
          channelId,
          userId,
          teamId: body.team?.id || "",
          threadTs: actualThreadTs,
          messageTs: inputMessage.ts as string,
          text: `Pull Request requested for ${branch}`,
          userDisplayName: body.user?.username || "User",
        };

        // Send the raw prompt to Claude, not the display version
        await this.messageHandler.handleUserRequest(
          context,
          pullRequestPrompt,
          client
        );
      }
    } catch (error) {
      logger.error(`Failed to handle GitHub PR action: ${error}`);
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: body.message?.thread_ts || messageTs,
        text: `❌ Failed to create pull request: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    }
  }

  /**
   * Update App Home tab with repository information and README
   */
  async updateAppHome(userId: string, client: any): Promise<void> {
    logger.info(
      `Updating app home for user: ${userId} with README from active repository`
    );

    try {
      const username = await this.messageHandler.getOrCreateUserMapping(
        userId,
        client
      );

      // Get GitHub connection status for demo purposes
      const githubUser = await getUserGitHubInfo(userId);
      const isGitHubConnected = !!githubUser.token;

      const blocks: any[] = [
        {
          type: "section",
          text: { type: "mrkdwn", text: "*Welcome to Peerbot!* 👋" },
        },
        {
          type: "divider",
        },
      ];

      // Add module-rendered home tab sections
      const homeTabModules = moduleRegistry.getHomeTabModules();
      for (const module of homeTabModules) {
        try {
          const moduleBlocks = await module.renderHomeTab!(userId);
          blocks.push(...moduleBlocks);
          if (moduleBlocks.length > 0) {
            blocks.push({ type: "divider" });
          }
        } catch (error) {
          logger.error(`Failed to render home tab for module ${module.name}:`, error);
        }
      }

      // Demo functionality (non-module specific)
      if (process.env.DEMO_REPOSITORY && !isGitHubConnected) {
        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: "*🎮 Demo Mode*\nTry Peerbot with a demo repository",
          },
        });

        blocks.push({
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "🎮 Try Demo" },
              action_id: "try_demo",
              style: "primary",
            },
          ],
        });

        blocks.push({ type: "divider" });
      }

      // Add quick tips
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            "*💡 Quick Tips:*\n" +
            "• Mention me in any channel or DM me directly\n" +
            "• Ask questions about code, create features, or fix bugs\n" +
            "• Use `/peerbot help` for all commands",
        },
      });


      // Update the app home view
      await client.views.publish({
        user_id: userId,
        view: {
          type: "home",
          blocks,
        },
      });

      logger.info(`App home updated for user ${userId}`);
    } catch (error) {
      logger.error(`Failed to update app home for user ${userId}:`, error);
    }
  }

  /**
   * Handle GitHub login
   */
  private async handleGitHubLogin(userId: string, client: any): Promise<void> {
    const authUrl = generateGitHubAuthUrl(userId);

    try {
      const im = await client.conversations.open({ users: userId });
      if (im.channel?.id) {
        await client.chat.postMessage({
          channel: im.channel.id,
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: "*🔗 Connect to GitHub*\n\nClick the link below to connect your GitHub account:",
              },
            },
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `<${authUrl}|Connect with GitHub>`,
              },
            },
            {
              type: "context",
              elements: [
                {
                  type: "mrkdwn",
                  text: "🔒 We'll only access repositories you explicitly grant permission to",
                },
              ],
            },
          ],
        });
      }
    } catch (error) {
      logger.error(`Failed to send GitHub login message to ${userId}:`, error);
    }
  }

  /**
   * Fetch repository README content
   */
  private async fetchRepositoryReadme(
    repositoryUrl: string
  ): Promise<string | null> {
    try {
      const urlParts = repositoryUrl
        .replace(/^https?:\/\//, "")
        .replace(/\.git$/, "")
        .split("/");

      if (urlParts.length < 3) {
        return null;
      }

      const owner = urlParts[1];
      const repo = urlParts[2];
      const branch = "main";

      const readmeUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/README.md`;

      const response = await fetch(readmeUrl);
      if (response.ok) {
        const content = await response.text();
        return content.substring(0, 1000);
      }

      // Try master branch
      const masterUrl = `https://raw.githubusercontent.com/${owner}/${repo}/master/README.md`;
      const masterResponse = await fetch(masterUrl);
      if (masterResponse.ok) {
        const content = await masterResponse.text();
        return content.substring(0, 1000);
      }
    } catch (error) {
      logger.error(`Failed to fetch README for ${repositoryUrl}:`, error);
    }

    return null;
  }
}
