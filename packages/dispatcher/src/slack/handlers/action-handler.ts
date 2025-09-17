import logger from "../../logger";
// import { getDbPool } from "../../db"; // Currently unused
import type { GitHubRepositoryManager } from "../../github/repository-manager";
import type { QueueProducer } from "../../queue/task-queue-producer";
import type { DispatcherConfig, SlackContext } from "../../types";
import type { MessageHandler } from "./message-handler";
import {
  handleGitHubConnect,
  handleGitHubLogout,
  getUserGitHubInfo,
} from "./github-handler";
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

      // Demo example buttons
      case "demo_example_1":
      case "demo_example_2":
      case "demo_example_3":
      case "demo_example_4": {
        const demoAction = body.actions?.[0];
        const demoPrompt = demoAction?.value;
        if (demoPrompt) {
          // Process as a user message
          const context: SlackContext = {
            channelId,
            userId,
            teamId: body.team?.id || "",
            threadTs: body.message?.thread_ts || body.message?.ts,
            messageTs: body.message?.ts || Date.now().toString(),
            text: demoPrompt,
            userDisplayName: body.user?.username || "User",
          };
          await this.messageHandler.handleUserRequest(
            context,
            demoPrompt,
            client
          );
        }
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
        }
        // Handle GitHub Code button clicks (no action needed, just log)
        else if (actionId.startsWith("github_code_")) {
          logger.info(
            `GitHub Code button clicked: ${actionId} by user ${userId}`
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

        // Post confirmation message like other interactive elements
        const formattedInput = `> 🔄 *Pull Request button clicked*\n\n${pullRequestPrompt}`;

        const inputMessage = await client.chat.postMessage({
          channel: channelId,
          thread_ts: actualThreadTs,
          text: formattedInput,
          blocks: [
            {
              type: "context",
              elements: [
                {
                  type: "mrkdwn",
                  text: `<@${userId}> clicked "Create Pull Request" button`,
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
          text: formattedInput,
          userDisplayName: body.user?.username || "User",
        };

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

      // Check if user has GitHub token
      const githubUser = await getUserGitHubInfo(userId);
      const isGitHubConnected = !!githubUser.token;

      let repository;
      let readmeSection: string | null = null;

      // Check for environment overrides
      const userEnv = await this.messageHandler.getUserEnvironment(userId);
      const overrideRepo = userEnv.GITHUB_REPOSITORY as string | undefined;

      // Try to get or create repository
      try {
        if (overrideRepo) {
          const repoUrl = overrideRepo.replace(/\/$/, "").replace(/\.git$/, "");
          const repoName = repoUrl.split("/").pop() || "unknown";

          repository = {
            username,
            repositoryName: repoName,
            repositoryUrl: repoUrl,
            cloneUrl: repoUrl.endsWith(".git") ? repoUrl : `${repoUrl}.git`,
            createdAt: Date.now(),
            lastUsed: Date.now(),
          };

          logger.info(
            `Using environment override repository for user ${userId}: ${repoUrl}`
          );
        } else {
          // Try to get existing repository
          repository = await this.repoManager.getUserRepository(
            username,
            userId
          );

          // If no cached repository and we have a token, create one
          if (!repository && (this.config.github.token || isGitHubConnected)) {
            repository = await this.repoManager.ensureUserRepository(username);
          }
        }

        // Fetch README.md content if we have a repository
        if (repository) {
          const readmeContent = await this.fetchRepositoryReadme(
            repository.repositoryUrl
          );
          if (readmeContent) {
            readmeSection = `*📖 README :*\n\`\`\`\n${readmeContent.slice(0, 500)}${readmeContent.length > 500 ? "..." : ""}\n\`\`\``;
          }
        }
      } catch (error) {
        logger.warn(
          `Could not get/ensure repository for user ${username}:`,
          error
        );
      }

      const blocks: any[] = [
        {
          type: "section",
          text: { type: "mrkdwn", text: "*Welcome to Peerbot!* 👋" },
        },
        {
          type: "divider",
        },
      ];

      // Show repository info or login prompt
      if (repository && isGitHubConnected) {
        const repoUrl = repository.repositoryUrl.replace(/\.git$/, "");
        const repoDisplayName = repoUrl.replace(
          /^https?:\/\/(www\.)?github\.com\//,
          ""
        );

        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Active Repository:*\n<${repoUrl}|${repoDisplayName}>`,
          },
          accessory: {
            type: "button",
            text: { type: "plain_text", text: "🔄 Change Repository" },
            action_id: "open_repository_modal",
          },
        });

        // Add README section if available
        if (readmeSection) {
          blocks.push({
            type: "section",
            text: { type: "mrkdwn", text: readmeSection },
          });
        }

        blocks.push({ type: "divider" });
      } else if (repository && !isGitHubConnected) {
        // Repository exists but user not authenticated - show login prompt with repo info
        const repoUrl = repository.repositoryUrl.replace(/\.git$/, "");
        const repoDisplayName = repoUrl.replace(
          /^https?:\/\/(www\.)?github\.com\//,
          ""
        );

        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Demo Repository:*\n<${repoUrl}|${repoDisplayName}>\n\n_Connect your GitHub account to work with your own repositories._`,
          },
        });

        const baseUrl = process.env.INGRESS_URL || "http://localhost:8080";
        const authUrl = `${baseUrl}/api/github/oauth/authorize?user_id=${userId}`;

        const demoElements = [
          {
            type: "button",
            text: { type: "plain_text", text: "🔗 Login with GitHub" },
            url: authUrl,
            style: "primary",
          } as any,
        ];

        // Only show Try Demo button if DEMO_REPOSITORY is configured
        if (process.env.DEMO_REPOSITORY) {
          demoElements.push({
            type: "button",
            text: { type: "plain_text", text: "🎮 Try Demo" },
            action_id: "try_demo",
          });
        }

        blocks.push({
          type: "actions",
          elements: demoElements,
        });

        blocks.push({ type: "divider" });
      } else if (isGitHubConnected) {
        // GitHub connected but no repository selected
        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*GitHub Connected:* ${githubUser.username || "✓"}\n\nSelect a repository to start working:`,
          },
        });

        blocks.push({
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "📂 Select Repository" },
              action_id: "open_repository_modal",
              style: "primary",
            },
          ],
        });

        blocks.push({ type: "divider" });
      } else {
        // Not connected to GitHub
        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: "*Get Started:*\nConnect your GitHub account to start working with your repositories.",
          },
        });

        const baseUrl = process.env.INGRESS_URL || "http://localhost:8080";
        const authUrl = `${baseUrl}/api/github/oauth/authorize?user_id=${userId}`;

        const loginElements = [
          {
            type: "button",
            text: { type: "plain_text", text: "🔗 Login with GitHub" },
            url: authUrl,
            style: "primary",
          } as any,
        ];

        // Only show Try Demo button if DEMO_REPOSITORY is configured
        if (process.env.DEMO_REPOSITORY) {
          loginElements.push({
            type: "button",
            text: { type: "plain_text", text: "🎮 Try Demo" },
            action_id: "try_demo",
          });
        }

        blocks.push({
          type: "actions",
          elements: loginElements,
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

      // Add logout button if GitHub is connected
      if (isGitHubConnected) {
        blocks.push(
          { type: "divider" },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: { type: "plain_text", text: "🚪 Logout from GitHub" },
                action_id: "github_logout",
                style: "danger",
                confirm: {
                  title: { type: "plain_text", text: "Logout from GitHub?" },
                  text: {
                    type: "mrkdwn",
                    text: "This will disconnect your GitHub account. You'll need to login again to access your repositories.",
                  },
                  confirm: { type: "plain_text", text: "Logout" },
                  deny: { type: "plain_text", text: "Cancel" },
                },
              },
            ],
          }
        );
      }

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
    const baseUrl = process.env.INGRESS_URL || "http://localhost:8080";
    const authUrl = `${baseUrl}/api/github/oauth/authorize?user_id=${userId}`;

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
