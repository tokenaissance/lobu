#!/usr/bin/env bun

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { createLogger } from "@peerbot/shared";

const logger = createLogger("github-module");
const execAsync = promisify(exec);

export interface WorkspaceSetupConfig {
  baseDirectory: string;
  githubToken: string;
}

export interface GitRepository {
  url: string;
  branch: string;
  directory: string;
  lastCommit?: string;
}

export interface WorkspaceInfo {
  baseDirectory: string;
  userDirectory: string;
  repository?: GitRepository;
  setupComplete: boolean;
}

export class GitHubWorkspaceManager {
  private config: WorkspaceSetupConfig;

  constructor(config: WorkspaceSetupConfig) {
    this.config = config;
  }

  /**
   * Setup GitHub-specific workspace operations
   */
  async setupGitHubWorkspace(
    repositoryUrl: string,
    userDirectory: string,
    username: string
  ): Promise<WorkspaceInfo> {
    try {
      logger.info(`Setting up GitHub workspace for ${username}...`);

      // Setup git configuration
      await this.setupGitConfig(userDirectory, username);

      // Setup GitHub CLI authentication if token is available
      if (this.config.githubToken) {
        await this.setupGitHubCLI(userDirectory);
      }

      // Get repository info
      const repository = await this.getRepositoryInfo(
        userDirectory,
        repositoryUrl
      );

      return {
        baseDirectory: this.config.baseDirectory,
        userDirectory,
        repository,
        setupComplete: true,
      };
    } catch (error) {
      logger.error(`Failed to setup GitHub workspace: ${error}`);
      throw error;
    }
  }

  /**
   * Setup GitHub CLI authentication
   */
  async setupGitHubCLI(userDirectory: string): Promise<void> {
    try {
      logger.info("Setting up GitHub CLI authentication...");
      await execAsync(
        `echo "${this.config.githubToken}" | gh auth login --with-token`,
        {
          cwd: userDirectory,
          env: { ...process.env, GH_TOKEN: this.config.githubToken },
        }
      );
      logger.info("GitHub CLI authentication configured successfully");
    } catch (error) {
      logger.warn("Failed to setup GitHub CLI authentication:", error);
      throw error;
    }
  }

  /**
   * Setup git configuration for the user
   */
  private async setupGitConfig(
    repositoryDirectory: string,
    username: string
  ): Promise<void> {
    try {
      logger.info(`Setting up git configuration for ${username}...`);

      // Set user name and email
      await execAsync(`git config user.name "Peerbot"`, {
        cwd: repositoryDirectory,
      });

      await execAsync(
        `git config user.email "claude-code-bot+${username}@noreply.github.com"`,
        {
          cwd: repositoryDirectory,
        }
      );

      // Set push default
      await execAsync("git config push.default simple", {
        cwd: repositoryDirectory,
      });

      logger.info("Git configuration completed");
    } catch (error) {
      throw new Error(
        `Failed to setup git configuration for ${username}: ${error}`
      );
    }
  }

  /**
   * Get repository information
   */
  private async getRepositoryInfo(
    repositoryDirectory: string,
    repositoryUrl: string
  ): Promise<GitRepository> {
    try {
      // Get current branch
      const { stdout: branchOutput } = await execAsync(
        "git branch --show-current",
        {
          cwd: repositoryDirectory,
        }
      );
      const branch = branchOutput.trim();

      // Get last commit hash
      const { stdout: commitOutput } = await execAsync("git rev-parse HEAD", {
        cwd: repositoryDirectory,
      });
      const lastCommit = commitOutput.trim();

      return {
        url: repositoryUrl,
        branch,
        directory: repositoryDirectory,
        lastCommit,
      };
    } catch (error) {
      throw new Error(`Failed to get repository information: ${error}`);
    }
  }

  /**
   * Create a new branch for the session
   */
  async createSessionBranch(
    userDirectory: string,
    sessionKey: string
  ): Promise<string> {
    try {
      const branchName = `claude/${sessionKey.replace(/\./g, "-")}`;

      logger.info(`Checking if session branch exists: ${branchName}`);

      // Check if branch already exists locally or remotely
      try {
        // Try to checkout existing branch
        await execAsync(`git checkout "${branchName}"`, {
          cwd: userDirectory,
        });
        logger.info(
          `Session branch ${branchName} already exists locally, checked out`
        );

        // Pull latest changes from remote to preserve previous work
        try {
          await execAsync(`git pull origin "${branchName}"`, {
            cwd: userDirectory,
            timeout: 30000,
          });
          logger.info(`Pulled latest changes for session branch ${branchName}`);
        } catch (pullError) {
          logger.warn(
            `Failed to pull latest changes for ${branchName} (branch might be new):`,
            pullError
          );
        }
      } catch (_checkoutError) {
        // Branch doesn't exist locally, check remote
        try {
          const { stdout } = await execAsync(
            `git ls-remote --heads origin ${branchName}`,
            { cwd: userDirectory, timeout: 10000 }
          );

          if (stdout.trim()) {
            // Branch exists on remote, checkout from remote
            await execAsync(
              `git checkout -b "${branchName}" "origin/${branchName}"`,
              {
                cwd: userDirectory,
              }
            );
            logger.info(
              `Session branch ${branchName} exists on remote, checked out with latest changes`
            );
          } else {
            // Branch doesn't exist anywhere, create new
            await execAsync(`git checkout -b "${branchName}"`, {
              cwd: userDirectory,
            });
            logger.info(`Created new session branch: ${branchName}`);
          }
        } catch (_error) {
          // Error checking remote, create new branch
          await execAsync(`git checkout -b "${branchName}"`, {
            cwd: userDirectory,
          });
          logger.info(`Created new session branch: ${branchName}`);
        }
      }

      return branchName;
    } catch (error) {
      throw new Error(
        `Failed to create session branch for ${sessionKey}: ${error}`
      );
    }
  }

  /**
   * Commit and push changes
   */
  async commitAndPush(
    userDirectory: string,
    branch: string,
    message: string
  ): Promise<void> {
    try {
      // Add all changes
      await execAsync("git add .", { cwd: userDirectory });

      // Check if there are changes to commit
      let hasUnstagedChanges = false;
      try {
        await execAsync("git diff --cached --exit-code", {
          cwd: userDirectory,
        });
        logger.info(
          "No staged changes to commit - checking for unpushed commits"
        );
      } catch (_error) {
        hasUnstagedChanges = true;
      }

      // Check if there are unpushed commits
      let hasUnpushedCommits = false;
      try {
        await execAsync(`git diff --exit-code origin/${branch}..HEAD`, {
          cwd: userDirectory,
        });
        logger.info("No unpushed commits");
      } catch (_error) {
        hasUnpushedCommits = true;
        logger.info("Found unpushed commits");
      }

      // If neither staged changes nor unpushed commits, return
      if (!hasUnstagedChanges && !hasUnpushedCommits) {
        logger.info("No changes to commit or push");
        return;
      }

      // Commit changes if there are staged changes
      if (hasUnstagedChanges) {
        await execAsync(`git commit -m "${message}"`, { cwd: userDirectory });
        logger.info("Changes committed");
      }

      // Always push if there are unpushed commits (either new ones or existing ones)
      if (hasUnpushedCommits || hasUnstagedChanges) {
        await execAsync(`git push -u origin "${branch}"`, {
          cwd: userDirectory,
          timeout: 120000,
        });
        logger.info(`Changes pushed to ${branch}`);
      }
    } catch (error) {
      throw new Error(`Failed to commit and push changes: ${error}`);
    }
  }
}
