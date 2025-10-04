import { z } from "zod";
import type {
  HomeTabModule,
  WorkerModule,
  OrchestratorModule,
  DispatcherModule,
  SessionContext,
  ActionButton,
  ThreadContext,
} from "../types";
import { GitHubRepositoryManager } from "./repository-manager";
import { getUserGitHubInfo } from "./handlers";
import { generateGitHubAuthUrl } from "./utils";

// GitHub configuration schema (module-specific)
export const GitHubConfigSchema = z.object({
  appId: z.string().optional(),
  privateKey: z.string().optional(),
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
  installationId: z.string().optional(),
  token: z.string().optional(),
  organization: z.string().optional(),
  repository: z.string().optional(),
  ingressUrl: z.string().optional(),
});

export type GitHubConfig = z.infer<typeof GitHubConfigSchema>;

/**
 * Loads GitHub configuration from environment variables
 */
export function loadGitHubConfig(): GitHubConfig {
  return GitHubConfigSchema.parse({
    appId: process.env.GITHUB_APP_ID,
    privateKey: process.env.GITHUB_PRIVATE_KEY,
    clientId: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
    installationId: process.env.GITHUB_INSTALLATION_ID,
    token: process.env.GITHUB_TOKEN,
    organization: process.env.GITHUB_ORGANIZATION,
    repository: process.env.GITHUB_REPOSITORY,
    ingressUrl: process.env.INGRESS_URL,
  });
}

export class GitHubModule
  implements HomeTabModule, WorkerModule, OrchestratorModule, DispatcherModule
{
  name = "github";
  private repoManager?: GitHubRepositoryManager;

  isEnabled(): boolean {
    return !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
  }

  async init(): Promise<void> {
    if (!this.isEnabled()) return;

    const config = loadGitHubConfig();
    this.repoManager = new GitHubRepositoryManager(
      config,
      process.env.DATABASE_URL
    );
  }

  async renderHomeTab(userId: string): Promise<any[]> {
    if (!this.repoManager) return [];

    const { token, username } = await getUserGitHubInfo(userId);
    const isGitHubConnected = !!token;

    if (!isGitHubConnected) {
      const authUrl = generateGitHubAuthUrl(userId);
      return [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "*🔗 GitHub Integration*\nConnect your GitHub account to work with repositories",
          },
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: {
                type: "plain_text",
                text: "🔗 Login with GitHub",
                emoji: true,
              },
              url: authUrl,
              style: "primary",
            },
          ],
        },
      ];
    }

    const userRepo = await this.repoManager.getUserRepository(
      username!,
      userId
    );

    if (userRepo) {
      const repoUrl = userRepo.repositoryUrl.replace(/\.git$/, "");
      const repoDisplayName = repoUrl.replace(
        /^https?:\/\/(www\.)?github\.com\//,
        ""
      );

      return [
        {
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
        },
      ];
    }

    return [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*🔗 GitHub Integration*\nConnected as @${username}`,
        },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "Select Repository",
              emoji: true,
            },
            action_id: "open_repository_modal",
          },
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "Disconnect",
              emoji: true,
            },
            action_id: "github_logout",
          },
        ],
      },
    ];
  }

  async initWorkspace(config: {
    repositoryUrl?: string;
    workspaceDir?: string;
  }): Promise<void> {
    if (!config.repositoryUrl || !config.workspaceDir) return;

    // Clone repository if not already present
    const repoName = this.extractRepoName(config.repositoryUrl);
    const targetDir = `${config.workspaceDir}/${repoName}`;

    // Check if repo already exists
    try {
      const fs = await import("node:fs");
      if (!fs.existsSync(targetDir)) {
        const { execSync } = await import("node:child_process");
        execSync(`git clone ${config.repositoryUrl} ${targetDir}`, {
          stdio: "inherit",
          cwd: config.workspaceDir,
        });
      }
    } catch (error) {
      console.warn(`Failed to clone repository: ${error}`);
    }
  }

  async onSessionStart(context: SessionContext): Promise<SessionContext> {
    if (context.repositoryUrl) {
      const repoName = this.extractRepoName(context.repositoryUrl);
      context.systemPrompt += `\n\nYou are working with the GitHub repository: ${repoName}`;
    }
    return context;
  }

  async onSessionEnd(context: SessionContext): Promise<ActionButton[]> {
    if (!context.repositoryUrl) return [];

    return [
      {
        text: "Create Pull Request",
        action_id: "create_pull_request",
        style: "primary",
      },
      {
        text: "Commit Changes",
        action_id: "commit_changes",
      },
    ];
  }

  async buildEnvVars(
    userId: string,
    baseEnv: Record<string, string>
  ): Promise<Record<string, string>> {
    const { token, username } = await getUserGitHubInfo(userId);

    if (token && username) {
      return {
        ...baseEnv,
        GITHUB_TOKEN: token,
        GITHUB_USER: username,
      };
    }

    return baseEnv;
  }

  /**
   * Add GitHub authentication to repository URL
   */
  addGitHubAuth(repositoryUrl: string, token: string): string {
    try {
      const url = new URL(repositoryUrl);
      if (url.hostname === "github.com") {
        // Convert to authenticated HTTPS URL
        url.username = "x-access-token";
        url.password = token;
        return url.toString();
      }
      return repositoryUrl;
    } catch (error) {
      console.warn(`Failed to parse repository URL: ${repositoryUrl}`, error);
      return repositoryUrl;
    }
  }

  /**
   * Generate GitHub OAuth URL for authentication
   */
  generateOAuthUrl(userId: string): string {
    const baseUrl = process.env.INGRESS_URL || "http://localhost:8080";
    return `${baseUrl}/api/github/oauth/authorize?userId=${userId}`;
  }

  /**
   * Check if GitHub CLI is authenticated
   */
  async isGitHubCLIAuthenticated(workingDir: string): Promise<boolean> {
    try {
      const { execSync } = await import("node:child_process");
      execSync("gh auth status", {
        cwd: workingDir,
        stdio: "pipe",
        timeout: 3000,
      });
      return true;
    } catch (error) {
      // If GH_TOKEN is set, authentication is available even if gh auth status fails
      return !!(process.env.GH_TOKEN || process.env.GITHUB_TOKEN);
    }
  }

  private extractRepoName(url: string): string {
    const match = url.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
    return match ? `${match[1]}/${match[2]}` : url;
  }

  async generateActionButtons(context: ThreadContext): Promise<ActionButton[]> {
    if (!this.repoManager) {
      return [];
    }

    const { generateGitHubActionButtons } = await import("./actions");
    const buttons = await generateGitHubActionButtons(
      context.userId,
      context.gitBranch,
      context.hasGitChanges,
      context.pullRequestUrl,
      context.userMappings,
      this.repoManager,
      context.slackClient
    );

    return (
      buttons?.map((button) => ({
        text: button.text?.text || "",
        action_id: button.action_id,
        style: button.style,
        value: button.value,
      })) || []
    );
  }

  async handleAction(
    actionId: string,
    userId: string,
    context: any
  ): Promise<boolean> {
    // Handle GitHub-specific actions
    switch (actionId) {
      case "github_login": {
        const { handleGitHubConnect } = await import("./handlers");
        await handleGitHubConnect(userId, context.channelId, context.client);
        return true;
      }

      case "github_logout": {
        const { handleGitHubLogout } = await import("./handlers");
        await handleGitHubLogout(userId, context.client);
        // Update home tab after logout - delegate back to action handler
        if (context.updateAppHome) {
          await context.updateAppHome(userId, context.client);
        }
        return true;
      }

      case "open_repository_modal":
        // This is handled by repository-modal-utils which should also be moved to module
        return false; // Let dispatcher handle for now

      default:
        // Check if it's a GitHub-specific action (prefixed with github_ or contains repo operations)
        if (
          actionId.startsWith("github_") ||
          actionId.includes("pr_") ||
          actionId.includes("view_pr_")
        ) {
          // This is a GitHub action but not one we handle directly
          return false;
        }
        return false;
    }
  }

  getRepositoryManager(): GitHubRepositoryManager | undefined {
    return this.repoManager;
  }

  async getUserInfo(userId: string) {
    return getUserGitHubInfo(userId);
  }
}

export * from "./repository-manager";
export * from "./handlers";
export * from "./utils";
export * from "./errors";
