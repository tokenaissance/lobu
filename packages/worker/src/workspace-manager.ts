#!/usr/bin/env bun

import { exec } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { createLogger } from "@peerbot/shared";
import type { GitHubModule } from "../../../modules/github";
import type {
  GitRepository,
  WorkspaceInfo,
  WorkspaceSetupConfig,
} from "./types";
import { WorkspaceError } from "./types";

const logger = createLogger("worker");

const execAsync = promisify(exec);

export class WorkspaceManager {
  private config: WorkspaceSetupConfig;
  private workspaceInfo?: WorkspaceInfo;

  constructor(config: WorkspaceSetupConfig) {
    this.config = config;
  }

  /**
   * Setup workspace by cloning repository or creating local workspace
   */
  async setupWorkspace(
    repositoryUrl: string | null,
    username: string,
    sessionKey?: string
  ): Promise<WorkspaceInfo> {
    try {
      // Use thread-specific directory instead of user-specific to avoid conflicts
      // between concurrent threads from the same user
      const threadId =
        process.env.SLACK_THREAD_TS ||
        process.env.SLACK_RESPONSE_TS ||
        sessionKey ||
        username;
      logger.info(
        `Setting up thread-specific workspace for ${username}, thread: ${threadId}...`
      );
      const userDirectory = join(
        this.config.baseDirectory,
        threadId.replace(/[^a-zA-Z0-9.-]/g, "_")
      );

      // Ensure base directory exists
      await this.ensureDirectory(this.config.baseDirectory);

      // Check if no repository URL is provided
      logger.info(`Repository URL received: "${repositoryUrl}"`);
      if (!repositoryUrl || repositoryUrl === "") {
        logger.info(
          `No repository URL provided. Creating local workspace at ${userDirectory}...`
        );

        // Ensure user directory exists
        await this.ensureDirectory(userDirectory);

        // Create workspace info without repository
        this.workspaceInfo = {
          baseDirectory: this.config.baseDirectory,
          userDirectory,
          repository: undefined,
          setupComplete: true,
        };

        logger.info(
          `Local workspace setup completed for ${username} (thread: ${threadId}) at ${userDirectory}`
        );
        return this.workspaceInfo;
      }

      // Check if user directory already exists
      const userDirExists = await this.directoryExists(userDirectory);

      if (userDirExists) {
        logger.info(
          `User directory ${userDirectory} already exists, checking if it's a git repository...`
        );

        // Check if it's a git repository
        const isGitRepo = await this.isGitRepository(userDirectory);

        if (isGitRepo) {
          logger.info("Existing git repository found, updating...");
          await this.updateRepository(userDirectory, sessionKey);
        } else {
          // Directory exists but is not a git repository
          // This is expected for local workspaces - just reuse it
          logger.info(
            "Directory exists but is not a git repository, reusing existing workspace..."
          );
          // Set workspace info for existing non-git directory
          this.workspaceInfo = {
            baseDirectory: this.config.baseDirectory,
            userDirectory,
            repository: {
              url: repositoryUrl,
              branch: "main",
              directory: userDirectory,
            },
            setupComplete: true,
          };
          return this.workspaceInfo;
        }
      } else {
        logger.info("User directory does not exist, cloning repository...");
        await this.cloneRepository(repositoryUrl, userDirectory);
      }

      // Setup git configuration
      await this.setupGitConfig(userDirectory, username);

      // Setup GitHub CLI authentication through module if available
      if (process.env.GITHUB_TOKEN && repositoryUrl.includes("github.com")) {
        try {
          const { moduleRegistry } = await import("../../../modules");
          const githubModule = moduleRegistry.getModule<GitHubModule>("github");
          if (githubModule && "init" in githubModule) {
            // GitHub module will handle CLI authentication during its own setup
            logger.info("GitHub module will handle CLI authentication");
          }
        } catch (error) {
          logger.warn(
            "Failed to setup GitHub CLI authentication through module:",
            error
          );
          // Non-fatal - continue without gh CLI
        }
      }

      // Get repository info
      const repository = await this.getRepositoryInfo(
        userDirectory,
        repositoryUrl
      );

      // Create workspace info
      this.workspaceInfo = {
        baseDirectory: this.config.baseDirectory,
        userDirectory,
        repository,
        setupComplete: true,
      };

      logger.info(
        `Thread-specific workspace setup completed for ${username} (thread: ${threadId}) at ${userDirectory}`
      );
      return this.workspaceInfo;
    } catch (error: any) {
      const workspaceError = new WorkspaceError(
        "setupWorkspace",
        `Failed to setup workspace for ${username}`,
        error as Error
      );

      // Propagate authentication error flag if it exists
      if (error.isAuthenticationError || error.gitExitCode === 128) {
        (workspaceError as any).isAuthenticationError = true;
        (workspaceError as any).gitExitCode = error.gitExitCode;
      }

      throw workspaceError;
    }
  }

  /**
   * Clone repository to specified directory
   */
  private async cloneRepository(
    repositoryUrl: string,
    targetDirectory: string
  ): Promise<void> {
    try {
      logger.info(
        `Cloning repository ${repositoryUrl} to ${targetDirectory}...`
      );

      // Use GitHub token for authentication through module
      let authenticatedUrl = repositoryUrl;
      if (this.config.githubToken && repositoryUrl.includes("github.com")) {
        const { moduleRegistry } = await import("../../../modules");
        const githubModule = moduleRegistry.getModule<GitHubModule>("github");
        if (githubModule && "addGitHubAuth" in githubModule) {
          authenticatedUrl = (githubModule as any).addGitHubAuth(
            repositoryUrl,
            this.config.githubToken
          );
        }
      }

      const { stderr } = await execAsync(
        `git clone "${authenticatedUrl}" "${targetDirectory}"`,
        { timeout: 180000 } // 3 minute timeout for slow repositories
      );

      if (stderr && !stderr.includes("Cloning into")) {
        logger.warn("Git clone warnings:", stderr);
      }

      logger.info("Repository cloned successfully");
    } catch (error: any) {
      // Git returns exit code 128 for authentication/permission errors
      const isAuthError = error.code === 128;
      const errorMessage = error.stderr || error.message || String(error);

      // Check specific git error patterns
      const isNotFound = errorMessage.includes("Repository not found");
      const isAuthenticationFailed = errorMessage.includes(
        "Authentication failed"
      );
      const isPermissionDenied = errorMessage.includes("Permission denied");

      const workspaceError = new WorkspaceError(
        "cloneRepository",
        `Failed to clone repository ${repositoryUrl}`,
        error as Error
      );

      // Add metadata to the error for proper handling upstream
      (workspaceError as any).isAuthenticationError =
        isAuthError &&
        (isNotFound || isAuthenticationFailed || isPermissionDenied);
      (workspaceError as any).gitExitCode = error.code;

      throw workspaceError;
    }
  }

  /**
   * Update existing repository
   */
  private async updateRepository(
    repositoryDirectory: string,
    sessionKey?: string
  ): Promise<void> {
    try {
      logger.info(`Updating repository at ${repositoryDirectory}...`);

      // Fetch latest changes
      await execAsync("git fetch origin", {
        cwd: repositoryDirectory,
        timeout: 30000,
      });

      // If sessionKey provided, check if session branch exists
      if (sessionKey) {
        // Use the thread timestamp directly in the branch name
        const branchName = `claude/${sessionKey.replace(/\./g, "-")}`;

        try {
          // Check if the branch exists on remote
          const { stdout } = await execAsync(
            `git ls-remote --heads origin ${branchName}`,
            { cwd: repositoryDirectory, timeout: 10000 }
          );

          if (stdout.trim()) {
            logger.info(
              `Session branch ${branchName} exists on remote, checking it out...`
            );

            // Branch exists on remote, check it out
            try {
              // Try to checkout existing local branch
              await execAsync(`git checkout "${branchName}"`, {
                cwd: repositoryDirectory,
                timeout: 10000,
              });
              // Pull latest changes
              await execAsync(`git pull origin "${branchName}"`, {
                cwd: repositoryDirectory,
                timeout: 30000,
              });
            } catch (_checkoutError) {
              // Local branch doesn't exist, create it from remote
              await execAsync(
                `git checkout -b "${branchName}" "origin/${branchName}"`,
                {
                  cwd: repositoryDirectory,
                  timeout: 10000,
                }
              );
            }

            logger.info(
              `Successfully checked out session branch ${branchName}`
            );
            return;
          }
        } catch (_error) {
          logger.info(
            `Session branch not found on remote, will use main/master`
          );
        }
      }

      // No session branch or sessionKey not provided, reset to main/master
      try {
        await execAsync("git reset --hard origin/main", {
          cwd: repositoryDirectory,
          timeout: 10000,
        });
      } catch (_error) {
        // Try master if main doesn't exist
        await execAsync("git reset --hard origin/master", {
          cwd: repositoryDirectory,
          timeout: 10000,
        });
      }

      logger.info("Repository updated successfully");
    } catch (error) {
      throw new WorkspaceError(
        "updateRepository",
        `Failed to update repository at ${repositoryDirectory}`,
        error as Error
      );
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
      throw new WorkspaceError(
        "setupGitConfig",
        `Failed to setup git configuration for ${username}`,
        error as Error
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
      throw new WorkspaceError(
        "getRepositoryInfo",
        `Failed to get repository information`,
        error as Error
      );
    }
  }

  /**
   * Check if directory exists
   */
  private async directoryExists(path: string): Promise<boolean> {
    try {
      const stats = await stat(path);
      return stats.isDirectory();
    } catch (_error) {
      return false;
    }
  }

  /**
   * Check if directory is a git repository
   */
  private async isGitRepository(path: string): Promise<boolean> {
    try {
      await execAsync("git status", { cwd: path, timeout: 5000 });
      return true;
    } catch (_error) {
      return false;
    }
  }

  /**
   * Ensure directory exists
   */
  private async ensureDirectory(path: string): Promise<void> {
    try {
      await mkdir(path, { recursive: true });
    } catch (error: any) {
      if (error.code !== "EEXIST") {
        throw error;
      }
    }
  }

  /**
   * Get current working directory
   */
  getCurrentWorkingDirectory(): string {
    return this.workspaceInfo?.userDirectory || this.config.baseDirectory;
  }

  /**
   * Create a new branch for the session
   */
  async createSessionBranch(sessionKey: string): Promise<string> {
    if (!this.workspaceInfo) {
      throw new WorkspaceError("createSessionBranch", "Workspace not setup");
    }

    // Skip git operations if no repository is configured
    if (!this.workspaceInfo.repository) {
      logger.info(
        `No repository configured, skipping branch creation for session ${sessionKey}`
      );
      return "local";
    }

    try {
      // Use the thread timestamp directly in the branch name
      // Replace dots with dashes for git branch naming conventions
      const branchName = `claude/${sessionKey.replace(/\./g, "-")}`;

      logger.info(`Checking if session branch exists: ${branchName}`);

      // Check if branch already exists locally or remotely
      try {
        // Try to checkout existing branch
        await execAsync(`git checkout "${branchName}"`, {
          cwd: this.workspaceInfo.userDirectory,
        });
        logger.info(
          `Session branch ${branchName} already exists locally, checked out`
        );

        // Pull latest changes from remote to preserve previous work
        try {
          await execAsync(`git pull origin "${branchName}"`, {
            cwd: this.workspaceInfo.userDirectory,
            timeout: 30000,
          });
          logger.info(`Pulled latest changes for session branch ${branchName}`);
        } catch (pullError) {
          // If pull fails, branch might not exist on remote yet - that's okay for new branches
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
            { cwd: this.workspaceInfo.userDirectory, timeout: 10000 }
          );

          if (stdout.trim()) {
            // Branch exists on remote, checkout from remote
            await execAsync(
              `git checkout -b "${branchName}" "origin/${branchName}"`,
              {
                cwd: this.workspaceInfo.userDirectory,
              }
            );
            logger.info(
              `Session branch ${branchName} exists on remote, checked out with latest changes`
            );
          } else {
            // Branch doesn't exist anywhere, create new
            await execAsync(`git checkout -b "${branchName}"`, {
              cwd: this.workspaceInfo.userDirectory,
            });
            logger.info(`Created new session branch: ${branchName}`);

            // Push the new branch to GitHub immediately to ensure it exists
            try {
              await execAsync(`git push -u origin "${branchName}"`, {
                cwd: this.workspaceInfo.userDirectory,
                timeout: 120000,
              });
              logger.info(`Pushed new session branch to GitHub: ${branchName}`);
            } catch (pushError) {
              logger.warn(`Failed to push new branch to GitHub:`, pushError);
            }
          }
        } catch (_error) {
          // Error checking remote, create new branch
          await execAsync(`git checkout -b "${branchName}"`, {
            cwd: this.workspaceInfo.userDirectory,
          });
          logger.info(`Created new session branch: ${branchName}`);

          // Push the new branch to GitHub immediately to ensure it exists
          try {
            await execAsync(`git push -u origin "${branchName}"`, {
              cwd: this.workspaceInfo.userDirectory,
              timeout: 120000,
            });
            logger.info(`Pushed new session branch to GitHub: ${branchName}`);
          } catch (pushError) {
            logger.warn(`Failed to push new branch to GitHub:`, pushError);
          }
        }
      }

      this.workspaceInfo.repository.branch = branchName;

      return branchName;
    } catch (error) {
      throw new WorkspaceError(
        "createSessionBranch",
        `Failed to create session branch for ${sessionKey}`,
        error as Error
      );
    }
  }

  /**
   * Commit and push changes
   */
  async commitAndPush(message: string): Promise<void> {
    if (!this.workspaceInfo) {
      throw new WorkspaceError("commitAndPush", "Workspace not setup");
    }

    // Skip git operations if no repository is configured
    if (!this.workspaceInfo.repository) {
      logger.info("No repository configured, skipping commit and push");
      return;
    }

    try {
      const repoDir = this.workspaceInfo.userDirectory;

      // Add all changes
      await execAsync("git add .", { cwd: repoDir });

      // Check if there are changes to commit
      let hasUnstagedChanges = false;
      try {
        await execAsync("git diff --cached --exit-code", { cwd: repoDir });
        logger.info(
          "No staged changes to commit - checking for unpushed commits"
        );
      } catch (_error) {
        // Staged changes exist, proceed with commit
        hasUnstagedChanges = true;
      }

      // Check if there are unpushed commits
      let hasUnpushedCommits = false;
      try {
        const branch = this.workspaceInfo.repository.branch;
        await execAsync(`git diff --exit-code origin/${branch}..HEAD`, {
          cwd: repoDir,
        });
        logger.info("No unpushed commits");
      } catch (_error) {
        // Unpushed commits exist
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
        await execAsync(`git commit -m "${message}"`, { cwd: repoDir });
        logger.info("Changes committed");
      }

      // Always push if there are unpushed commits (either new ones or existing ones)
      if (hasUnpushedCommits || hasUnstagedChanges) {
        const branch = this.workspaceInfo.repository.branch;
        await execAsync(`git push -u origin "${branch}"`, {
          cwd: repoDir,
          timeout: 120000,
        });
        logger.info(`Changes pushed to ${branch}`);
      }
    } catch (error) {
      throw new WorkspaceError(
        "commitAndPush",
        `Failed to commit and push changes`,
        error as Error
      );
    }
  }

  /**
   * Clean up workspace
   */
  async cleanup(): Promise<void> {
    try {
      logger.info("Cleaning up workspace...");

      if (this.workspaceInfo) {
        // No auto-push during cleanup - changes remain local
        logger.info("Workspace has changes that will remain local");
      }

      logger.info("Workspace cleanup completed");
    } catch (error) {
      logger.error("Error during workspace cleanup:", error);
    }
  }

  /**
   * Get repository status
   */
  async getRepositoryStatus(): Promise<{
    branch: string;
    hasChanges: boolean;
    changedFiles: string[];
  }> {
    if (!this.workspaceInfo) {
      throw new WorkspaceError("getRepositoryStatus", "Workspace not setup");
    }

    try {
      const repoDir = this.workspaceInfo.userDirectory;

      // Get current branch
      const { stdout: branchOutput } = await execAsync(
        "git branch --show-current",
        {
          cwd: repoDir,
        }
      );
      const branch = branchOutput.trim();

      // Get status
      const { stdout: statusOutput } = await execAsync(
        "git status --porcelain",
        {
          cwd: repoDir,
        }
      );

      const changedFiles = statusOutput
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => line.substring(3)); // Remove status prefix

      return {
        branch,
        hasChanges: changedFiles.length > 0,
        changedFiles,
      };
    } catch (error) {
      throw new WorkspaceError(
        "getRepositoryStatus",
        "Failed to get repository status",
        error as Error
      );
    }
  }
}
