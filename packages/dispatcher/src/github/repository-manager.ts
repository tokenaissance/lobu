#!/usr/bin/env bun

import { Octokit } from "@octokit/rest";
import logger from "../logger";
import type { GitHubConfig, UserRepository } from "../types";

// Import from shared package
import { GitHubRepositoryError, getDbPool } from "@peerbot/shared";

export class GitHubRepositoryManager {
  private octokit: Octokit;
  private config: GitHubConfig;
  private repositories = new Map<string, UserRepository>(); // username -> repository info
  private databaseUrl?: string;

  constructor(config: GitHubConfig, databaseUrl?: string) {
    this.config = config;
    this.databaseUrl = databaseUrl;

    this.octokit = new Octokit({
      auth: config.token,
    });
  }

  /**
   * Extract repository name from GitHub URL
   */
  private extractRepoNameFromUrl(url: string): string {
    try {
      // Handle both HTTPS and SSH URLs
      // Match pattern: github.com[:/]owner/repo[.git]
      const match = url.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
      if (match?.[1] && match?.[2]) {
        // Return owner/repo format
        return `${match[1]}/${match[2]}`;
      }

      // Fallback: try to extract from the URL path
      const githubIndex = url.indexOf("github.com");
      if (githubIndex !== -1) {
        const pathPart = url.substring(githubIndex + "github.com".length);
        const cleanPath = pathPart.replace(/^[:/]/, "").replace(/\.git$/, "");
        if (cleanPath && !cleanPath.startsWith("http")) {
          return cleanPath;
        }
      }

      // If we can't extract a proper name, return the full URL
      return url;
    } catch (_error) {
      // If there's any error, return the full URL
      return url;
    }
  }

  private normalizeRepoUrls(url: string): {
    repositoryUrl: string;
    cloneUrl: string;
  } {
    const clean = url.replace(/\.git$/, "");
    const clone = url.endsWith(".git") ? url : `${clean}.git`;
    return { repositoryUrl: clean, cloneUrl: clone };
  }

  /**
   * Get user's repositories using their GitHub token
   */
  async getUserRepositories(token: string): Promise<any[]> {
    try {
      const userOctokit = new Octokit({ auth: token });

      // Fetch user's repositories (owned and collaborated)
      const { data: repos } =
        await userOctokit.rest.repos.listForAuthenticatedUser({
          sort: "updated",
          per_page: 100,
          type: "all", // Get all repos (owner, collaborator, org member)
        });

      return repos;
    } catch (error) {
      logger.error("Failed to fetch user repositories:", error);
      throw new GitHubRepositoryError(
        "getUserRepositories",
        "user",
        `Failed to fetch user repositories: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Get cached repository for a user without creating
   */
  async getUserRepository(
    username: string,
    slackUserId?: string
  ): Promise<UserRepository | undefined> {
    // If a global repository override is configured, return it (highest priority)
    if (this.config.repository) {
      const { repositoryUrl, cloneUrl } = this.normalizeRepoUrls(
        this.config.repository
      );
      return {
        username,
        repositoryName: this.extractRepoNameFromUrl(this.config.repository),
        repositoryUrl,
        cloneUrl,
        createdAt: Date.now(),
        lastUsed: Date.now(),
      };
    }

    // Check for user's selected repository from database
    const selectedRepo = await this.getUserSelectedRepository(
      username,
      slackUserId
    );
    if (selectedRepo) {
      return selectedRepo;
    }

    // Return cached repository if available
    return this.repositories.get(username);
  }

  /**
   * Get user's selected repository from database
   */
  private async getUserSelectedRepository(
    username: string,
    slackUserId?: string
  ): Promise<UserRepository | undefined> {
    try {
      logger.info(
        `Checking for user-selected repository for ${username} (Slack ID: ${slackUserId || "unknown"})`
      );
      const dbPool = getDbPool(this.databaseUrl || process.env.DATABASE_URL);

      let result;

      // If we have the Slack user ID, use it directly
      if (slackUserId) {
        result = await dbPool.query(
          `SELECT ue.value as repo_url
           FROM users u
           JOIN user_environ ue ON u.id = ue.user_id
           WHERE u.platform = 'slack' 
           AND u.platform_user_id = $1
           AND ue.name = 'SELECTED_REPOSITORY'`,
          [slackUserId.toUpperCase()]
        );
      } else {
        // Fall back to searching by username pattern
        result = await dbPool.query(
          `SELECT ue.value as repo_url
           FROM users u
           JOIN user_environ ue ON u.id = ue.user_id
           WHERE u.platform = 'slack'
           AND ue.name = 'SELECTED_REPOSITORY'
           ORDER BY u.updated_at DESC
           LIMIT 1`,
          []
        );
      }

      if (result.rows.length > 0 && result.rows[0].repo_url) {
        const repoUrl = result.rows[0].repo_url;
        const repoName = this.extractRepoNameFromUrl(repoUrl);

        logger.info(
          `Found user-selected repository for ${username}: ${repoUrl}`
        );

        return {
          username,
          repositoryName: repoName,
          repositoryUrl: repoUrl.replace(".git", ""),
          cloneUrl: repoUrl.endsWith(".git") ? repoUrl : `${repoUrl}.git`,
          createdAt: Date.now(),
          lastUsed: Date.now(),
        };
      } else {
        logger.info(`No user-selected repository found for ${username}`);
      }
    } catch (error) {
      logger.warn(
        `Failed to get user selected repository for ${username}:`,
        error
      );
    }
    return undefined;
  }

  /**
   * Ensure user repository exists, create if needed
   */
  async ensureUserRepository(username: string): Promise<UserRepository | null> {
    try {
      // If a global repository override is configured, use it (highest priority)
      if (this.config.repository) {
        // Create repository info from override URL (no caching for overrides)
        const { repositoryUrl, cloneUrl } = this.normalizeRepoUrls(
          this.config.repository
        );
        const repository: UserRepository = {
          username,
          repositoryName: this.extractRepoNameFromUrl(this.config.repository),
          repositoryUrl,
          cloneUrl,
          createdAt: Date.now(),
          lastUsed: Date.now(),
        };

        logger.info(
          `Using global repository override for user ${username}: ${repository.repositoryUrl}`
        );
        return repository;
      }

      // Check for user's selected repository from database
      const selectedRepo = await this.getUserSelectedRepository(username);
      if (selectedRepo) {
        logger.info(
          `Using user-selected repository for ${username}: ${selectedRepo.repositoryUrl}`
        );
        // Cache it
        this.repositories.set(username, selectedRepo);
        return selectedRepo;
      }

      // Check if we have cached repository info
      const cached = this.repositories.get(username);
      if (cached) {
        // Update last used timestamp
        cached.lastUsed = Date.now();
        return cached;
      }

      // No user-specific repository configured
      // Return null to indicate no repository is set
      // The worker will create a local workspace without git operations
      logger.info(
        `No repository configured for user ${username}. Will use local workspace only.`
      );
      return null;
    } catch (error) {
      throw new GitHubRepositoryError(
        "ensureUserRepository",
        username,
        `Failed to ensure repository for user ${username}`,
        error as Error
      );
    }
  }

  /**
   * Get repository information
   */
  async getRepositoryInfo(username: string): Promise<UserRepository | null> {
    return this.repositories.get(username) || null;
  }

  /**
   * Fetch README.md content from a GitHub repository
   */
  async fetchReadmeContent(
    owner: string,
    repo: string
  ): Promise<string | null> {
    try {
      logger.info(`Fetching README.md from ${owner}/${repo}...`);

      const response = await this.octokit.rest.repos.getContent({
        owner,
        repo,
        path: "README.md",
      });

      if ("content" in response.data && response.data.content) {
        const content = Buffer.from(response.data.content, "base64").toString(
          "utf8"
        );
        logger.info(
          `Successfully fetched README.md from ${owner}/${repo} (${content.length} characters)`
        );
        return content;
      }

      logger.warn(
        `README.md found but no content available for ${owner}/${repo}`
      );
      return null;
    } catch (error: any) {
      if (error.status === 404) {
        logger.info(`README.md not found for ${owner}/${repo}`);
        return null;
      }
      logger.error(`Failed to fetch README.md from ${owner}/${repo}:`, error);
      return null;
    }
  }
}
