import type { HomeTabModule, WorkerModule, OrchestratorModule, SessionContext, ActionButton } from '../types';
import { GitHubRepositoryManager } from './repository-manager';
import { handleGitHubConnect, handleGitHubLogout, getUserGitHubInfo } from './handlers';
import { generateGitHubAuthUrl } from './utils';

export class GitHubModule implements HomeTabModule, WorkerModule, OrchestratorModule {
  name = 'github';
  private repoManager?: GitHubRepositoryManager;

  isEnabled(): boolean {
    return !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
  }

  async init(): Promise<void> {
    if (!this.isEnabled()) return;
    
    this.repoManager = new GitHubRepositoryManager(
      {
        token: process.env.GITHUB_TOKEN || '',
        organization: process.env.GITHUB_ORGANIZATION || '',
        repository: process.env.GITHUB_REPOSITORY,
        clientId: process.env.GITHUB_CLIENT_ID!,
        clientSecret: process.env.GITHUB_CLIENT_SECRET!,
        ingressUrl: process.env.INGRESS_URL,
      },
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

    const userRepo = await this.repoManager.getUserRepository(username!, userId);
    
    if (userRepo) {
      const repoUrl = userRepo.repositoryUrl.replace(/\.git$/, "");
      const repoDisplayName = repoUrl.replace(/^https?:\/\/(www\.)?github\.com\//, "");
      
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

  async handleHomeTabAction(actionId: string, userId: string, value?: any): Promise<void> {
    // Home tab actions are handled by the dispatcher action handler
    // This method is called from the dispatcher for module-specific actions
  }

  async initWorkspace(config: { repositoryUrl?: string; workspaceDir?: string }): Promise<void> {
    if (!config.repositoryUrl || !config.workspaceDir) return;
    
    // Clone repository if not already present
    const repoName = this.extractRepoName(config.repositoryUrl);
    const targetDir = `${config.workspaceDir}/${repoName}`;
    
    // Check if repo already exists
    try {
      const fs = await import('fs');
      if (!fs.existsSync(targetDir)) {
        const { execSync } = await import('child_process');
        execSync(`git clone ${config.repositoryUrl} ${targetDir}`, { 
          stdio: 'inherit',
          cwd: config.workspaceDir 
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

  async buildEnvVars(userId: string, baseEnv: Record<string, string>): Promise<Record<string, string>> {
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

  private extractRepoName(url: string): string {
    const match = url.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
    return match ? `${match[1]}/${match[2]}` : url;
  }

  getRepositoryManager(): GitHubRepositoryManager | undefined {
    return this.repoManager;
  }
}

export * from './repository-manager';
export * from './handlers';
export * from './utils';