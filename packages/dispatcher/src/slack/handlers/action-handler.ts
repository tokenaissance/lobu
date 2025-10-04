import { createLogger } from "@peerbot/shared";
// import { getDbPool } from "@peerbot/shared"; // Currently unused

const logger = createLogger("dispatcher");
import type { QueueProducer } from "../../queue/task-queue-producer";
import type { SlackContext } from "../../types";
import type { MessageHandler } from "./message-handler";
import { moduleRegistry } from "../../../../../modules";
import type { GitHubModule } from "../../../../../modules/github";
import { handleTryDemo } from "./demo-handler";
import { openRepositoryModal } from "./repository-modal-utils";
import {
  handleBlockkitForm,
  handleExecutableCodeBlock,
  handleStopWorker,
} from "../event-handlers/block-actions";

export class ActionHandler {
  constructor(
    _queueProducer: QueueProducer,
    private messageHandler: MessageHandler
  ) {}

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

    // Try to handle action through modules first
    let handled = false;
    const dispatcherModules = moduleRegistry.getDispatcherModules();
    for (const module of dispatcherModules) {
      if (module.handleAction) {
        const moduleHandled = await module.handleAction(actionId, userId, {
          channelId,
          client,
          body,
          updateAppHome: this.updateAppHome.bind(this),
        });
        if (moduleHandled) {
          handled = true;
          break;
        }
      }
    }

    if (!handled) {
      switch (actionId) {
        case "open_repository_modal": {
          // Get GitHub functions from module
          const gitHubModule = moduleRegistry.getModule<GitHubModule>("github");
          if (gitHubModule) {
            const { getUserGitHubInfo } = await import(
              "../../../../../modules/github/handlers"
            );
            await openRepositoryModal({
              userId,
              body,
              client,
              checkAdminStatus: false,
              getGitHubUserInfo: getUserGitHubInfo,
            });
          }
          break;
        }

        case "open_github_login_modal": {
          // Get GitHub auth URL from module
          const gitHubModule = moduleRegistry.getModule<GitHubModule>("github");
          if (gitHubModule) {
            const { generateGitHubAuthUrl } = await import(
              "../../../../../modules/github/utils"
            );
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
          }
          break;
        }

        case "github_connect": {
          // This should be handled by the GitHub module, but fallback for compatibility
          const gitHubModule = moduleRegistry.getModule<GitHubModule>("github");
          if (gitHubModule) {
            const { handleGitHubConnect } = await import(
              "../../../../../modules/github/handlers"
            );
            await handleGitHubConnect(userId, channelId, client);
          }
          break;
        }

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

          break;
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
      await this.messageHandler.getOrCreateUserMapping(userId, client);

      // Get GitHub connection status for demo purposes
      const gitHubModule = moduleRegistry.getModule<GitHubModule>("github");
      const githubUser = gitHubModule
        ? await gitHubModule.getUserInfo(userId)
        : { token: null, username: null };
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
          logger.error(
            `Failed to render home tab for module ${module.name}:`,
            error
          );
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
}
