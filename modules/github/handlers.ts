import { createLogger } from "@peerbot/shared";
import { getDbPool } from "@peerbot/shared";
import { encrypt, decrypt } from "@peerbot/shared";
import axios from "axios";
import type { Request, Response } from "express";

const logger = createLogger("github-module");
import { generateGitHubAuthUrl } from "./utils";

export class GitHubOAuthHandler {
  private dbPool: any;
  private homeTabCallback?: (userId: string) => Promise<void>;

  constructor(
    databaseUrl: string,
    homeTabCallback?: (userId: string) => Promise<void>
  ) {
    this.dbPool = getDbPool(databaseUrl);
    this.homeTabCallback = homeTabCallback;
  }

  /**
   * Handle OAuth authorization request
   */
  async handleAuthorize(req: Request, res: Response): Promise<void> {
    const clientId = process.env.GITHUB_CLIENT_ID;

    if (!clientId) {
      res.status(500).json({ error: "GitHub OAuth not configured" });
      return;
    }

    const userId = req.query.user_id as string;
    if (!userId) {
      res.status(400).json({ error: "User ID required" });
      return;
    }

    // Create encrypted state with user ID and timestamp
    const stateData = JSON.stringify({
      userId,
      timestamp: Date.now(),
    });
    const state = encrypt(stateData);

    // Use INGRESS_URL if provided, otherwise construct from request
    const baseUrl =
      process.env.INGRESS_URL || `${req.protocol}://${req.get("host")}`;

    // If using default localhost, ensure we use port 8080
    const redirectUri =
      baseUrl.includes("localhost") && !process.env.INGRESS_URL
        ? `http://localhost:8080/api/github/oauth/callback`
        : `${baseUrl}/api/github/oauth/callback`;

    // GitHub OAuth URL with full repo scope
    const githubAuthUrl =
      `https://github.com/login/oauth/authorize?` +
      `client_id=${clientId}&` +
      `redirect_uri=${encodeURIComponent(redirectUri)}&` +
      `scope=${encodeURIComponent("repo read:user")}&` +
      `state=${encodeURIComponent(state)}`;

    res.redirect(githubAuthUrl);
  }

  /**
   * Handle OAuth callback
   */
  async handleCallback(req: Request, res: Response): Promise<void> {
    try {
      const { code, state } = req.query;

      if (!code || !state) {
        res.status(400).send("Missing code or state parameter");
        return;
      }

      // Decrypt and validate state
      let stateData;
      try {
        stateData = JSON.parse(decrypt(state as string));
      } catch (error) {
        res.status(400).send("Invalid state parameter");
        return;
      }

      // Check timestamp (expire after 10 minutes)
      if (Date.now() - stateData.timestamp > 10 * 60 * 1000) {
        res.status(400).send("State parameter expired");
        return;
      }

      // Exchange code for access token
      const tokenResponse = await axios.post(
        "https://github.com/login/oauth/access_token",
        {
          client_id: process.env.GITHUB_CLIENT_ID,
          client_secret: process.env.GITHUB_CLIENT_SECRET,
          code,
        },
        {
          headers: {
            Accept: "application/json",
          },
        }
      );

      const accessToken = tokenResponse.data.access_token;
      if (!accessToken) {
        throw new Error("Failed to get access token");
      }

      // Get user info from GitHub
      const userResponse = await axios.get("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      const githubUsername = userResponse.data.login;

      // Store token in database
      const userId = stateData.userId.toUpperCase(); // Slack user IDs are uppercase

      // First ensure user exists
      await this.dbPool.query(
        `INSERT INTO users (platform, platform_user_id) 
         VALUES ('slack', $1) 
         ON CONFLICT (platform, platform_user_id) DO NOTHING`,
        [userId]
      );

      // Get user ID
      const userResult = await this.dbPool.query(
        `SELECT id FROM users WHERE platform = 'slack' AND platform_user_id = $1`,
        [userId]
      );
      const userDbId = userResult.rows[0].id;

      // Store GitHub token and username (token encrypted at rest)
      const encToken = encrypt(accessToken);
      await this.dbPool.query(
        `INSERT INTO user_environ (user_id, channel_id, repository, name, value, type) 
         VALUES ($1, NULL, NULL, 'GITHUB_TOKEN', $2, 'user') 
         ON CONFLICT (user_id, channel_id, repository, name) 
         DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [userDbId, encToken]
      );

      await this.dbPool.query(
        `INSERT INTO user_environ (user_id, channel_id, repository, name, value, type)
         VALUES ($1, NULL, NULL, 'GITHUB_USER', $2, 'user')
         ON CONFLICT (user_id, channel_id, repository, name)
         DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [userDbId, encrypt(githubUsername)]
      );

      // Trigger home tab refresh and send repository selection message
      try {
        if (this.homeTabCallback) {
          logger.info(
            `Triggering home tab refresh for user ${userId} after GitHub OAuth`
          );
          await this.homeTabCallback(userId);
        }
      } catch (error) {
        logger.error("Failed to trigger home tab refresh:", error);
        // Don't fail the OAuth flow if home tab refresh fails
      }

      // Success page
      res.send(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>GitHub Connected</title>
            <style>
              body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
                display: flex;
                justify-content: center;
                align-items: center;
                height: 100vh;
                margin: 0;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              }
              .container {
                background: white;
                padding: 40px;
                border-radius: 10px;
                box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                text-align: center;
                max-width: 400px;
              }
              h1 { color: #333; margin-bottom: 10px; }
              p { color: #666; margin: 20px 0; }
              .success-icon {
                font-size: 48px;
                margin-bottom: 20px;
              }
              .username {
                font-weight: bold;
                color: #764ba2;
              }
              .close-note {
                margin-top: 30px;
                padding-top: 20px;
                border-top: 1px solid #eee;
                color: #999;
                font-size: 14px;
              }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="success-icon">✅</div>
              <h1>GitHub Connected!</h1>
              <p>Successfully connected as <span class="username">@${githubUsername}</span></p>
              <p>You can now return to Slack and select your repositories.</p>
              <div class="close-note">You can close this window.</div>
            </div>
            <script>
              // Auto-close after 5 seconds
              setTimeout(() => {
                window.close();
              }, 5000);
            </script>
          </body>
        </html>
      `);
    } catch (error) {
      logger.error("OAuth callback error:", error);
      res.status(500).send(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Connection Failed</title>
            <style>
              body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
                display: flex;
                justify-content: center;
                align-items: center;
                height: 100vh;
                margin: 0;
                background: #f5f5f5;
              }
              .container {
                background: white;
                padding: 40px;
                border-radius: 10px;
                box-shadow: 0 10px 30px rgba(0,0,0,0.1);
                text-align: center;
                max-width: 400px;
              }
              h1 { color: #e74c3c; }
              p { color: #666; margin: 20px 0; }
              .error-icon { font-size: 48px; margin-bottom: 20px; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="error-icon">❌</div>
              <h1>Connection Failed</h1>
              <p>Failed to connect to GitHub. Please try again.</p>
              <p style="font-size: 14px; color: #999;">Error: ${error instanceof Error ? error.message : "Unknown error"}</p>
            </div>
          </body>
        </html>
      `);
    }
  }

  /**
   * Handle logout/revoke
   */
  async handleLogout(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.body.user_id;
      if (!userId) {
        res.status(400).json({ error: "User ID required" });
        return;
      }

      // Remove GitHub token and username from database
      await this.dbPool.query(
        `DELETE FROM user_environ 
         WHERE user_id = (SELECT id FROM users WHERE platform = 'slack' AND platform_user_id = $1)
         AND name IN ('GITHUB_TOKEN', 'GITHUB_USER')`,
        [userId.toUpperCase()]
      );

      res.json({ success: true });
    } catch (error) {
      logger.error("Logout error:", error);
      res.status(500).json({ error: "Failed to logout" });
    }
  }

  /**
   * Handle OAuth revoke (alias for logout)
   */
  async handleRevoke(req: Request, res: Response): Promise<void> {
    return this.handleLogout(req, res);
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    /* no-op for shared pool */
  }
}

/**
 * Handle GitHub login modal action
 */
export async function handleGitHubLoginModal(
  userId: string,
  body: any,
  client: any
): Promise<void> {
  try {
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

    logger.info(`GitHub login modal opened for user ${userId}`);
  } catch (error) {
    logger.error("Failed to open GitHub login modal:", error);
  }
}

/**
 * Handle GitHub connect action - initiates OAuth flow
 */
export async function handleGitHubConnect(
  userId: string,
  channelId: string,
  client: any
): Promise<void> {
  try {
    // Generate OAuth URL with user ID
    const authUrl = generateGitHubAuthUrl(userId);

    await client.chat.postMessage({
      channel: channelId,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "🔗 *Connect your GitHub account*\n\nClick the link below to authorize Peerbot to access your GitHub repositories:",
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

    logger.info(`GitHub connect initiated for user ${userId}`);
  } catch (error) {
    logger.error("Failed to initiate GitHub connect:", error);
    await client.chat.postMessage({
      channel: channelId,
      text: "Failed to generate GitHub login link. Please try again.",
    });
  }
}

/**
 * Handle GitHub logout
 */
export async function handleGitHubLogout(
  userId: string,
  client: any
): Promise<void> {
  try {
    const dbPool = getDbPool(process.env.DATABASE_URL!);

    // Remove GitHub token and username from database
    await dbPool.query(
      `DELETE FROM user_environ 
       WHERE user_id = (SELECT id FROM users WHERE platform = 'slack' AND platform_user_id = $1)
       AND name IN ('GITHUB_TOKEN', 'GITHUB_USER')`,
      [userId.toUpperCase()]
    );

    logger.info(`GitHub logout completed for user ${userId}`);

    // Send confirmation
    const im = await client.conversations.open({ users: userId });
    if (im.channel?.id) {
      await client.chat.postMessage({
        channel: im.channel.id,
        text: "✅ Successfully logged out from GitHub",
      });
    }
  } catch (error) {
    logger.error(`Failed to logout user ${userId}:`, error);
  }
}

/**
 * Search user's accessible repositories
 */
export async function searchUserRepos(
  query: string,
  token: string
): Promise<any[]> {
  try {
    let url: string;

    if (query) {
      // Search user's repos with query
      url = `https://api.github.com/user/repos?per_page=100&sort=updated`;
    } else {
      // Get recent repos if no query
      url = `https://api.github.com/user/repos?per_page=20&sort=updated`;
    }

    const response = await fetch(url, {
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github.v3+json",
      },
    });

    if (!response.ok) {
      logger.warn(
        `GitHub API error for user repos: ${response.status} ${response.statusText}`
      );
      return [];
    }

    const repos = (await response.json()) as any;

    // Filter by query if provided
    if (query) {
      const lowerQuery = query.toLowerCase();
      return repos.filter(
        (repo: any) =>
          repo.name.toLowerCase().includes(lowerQuery) ||
          repo.full_name.toLowerCase().includes(lowerQuery)
      );
    }

    return repos;
  } catch {
    return [];
  }
}

/**
 * Search organization repositories
 */
export async function searchOrgRepos(
  query: string,
  token: string
): Promise<any[]> {
  const org = process.env.GITHUB_ORGANIZATION;

  if (!org) return [];

  try {
    // Get organization repos
    const response = await fetch(
      `https://api.github.com/orgs/${org}/repos?per_page=100&sort=updated`,
      {
        headers: {
          Authorization: `token ${token}`,
          Accept: "application/vnd.github.v3+json",
        },
      }
    );

    if (!response.ok) {
      logger.warn(
        `GitHub API error for org repos: ${response.status} ${response.statusText}`
      );
      return [];
    }

    const repos = (await response.json()) as any;

    // Filter by query if provided
    if (query) {
      const lowerQuery = query.toLowerCase();
      return repos.filter(
        (repo: any) =>
          repo.name.toLowerCase().includes(lowerQuery) ||
          repo.full_name.toLowerCase().includes(lowerQuery)
      );
    }

    // Return top 20 if no query
    return repos.slice(0, 20);
  } catch {
    return [];
  }
}

/**
 * Handle repository search - provides Slack option format
 */
export async function handleRepositorySearch(
  query: string,
  userId: string
): Promise<any[]> {
  try {
    const { token } = await getUserGitHubInfo(userId);

    if (!token) {
      return [];
    }

    // Search both user repos and org repos in parallel
    const [userRepos, orgRepos] = await Promise.all([
      searchUserRepos(query, token),
      searchOrgRepos(query, token),
    ]);

    // Combine and deduplicate
    const allRepos = [...userRepos, ...orgRepos];
    const uniqueRepos = Array.from(
      new Map(allRepos.map((repo) => [repo.html_url, repo])).values()
    );

    // Format for Slack (limit to 100)
    return uniqueRepos.slice(0, 100).map((repo) => ({
      text: {
        type: "plain_text" as const,
        text: repo.full_name, // Shows "owner/repo"
      },
      value: repo.html_url,
    }));
  } catch (error) {
    logger.error("Error in repository search:", error);
    return [];
  }
}

/**
 * Get user's GitHub info from database
 */
export async function getUserGitHubInfo(userId: string): Promise<{
  token: string | null;
  username: string | null;
}> {
  try {
    const dbPool = getDbPool(process.env.DATABASE_URL!);

    const result = await dbPool.query(
      `SELECT name, value 
       FROM user_environ 
       WHERE user_id = (SELECT id FROM users WHERE platform = 'slack' AND platform_user_id = $1)
       AND name IN ('GITHUB_TOKEN', 'GITHUB_USER')`,
      [userId.toUpperCase()]
    );

    let token = null;
    let username = null;

    for (const row of result.rows) {
      if (row.name === "GITHUB_TOKEN") {
        try {
          // Token is encrypted, decrypt it
          token = decrypt(row.value);
        } catch (error) {
          logger.error(
            `Failed to decrypt GitHub token for user ${userId}:`,
            error
          );
          token = null;
        }
      } else if (row.name === "GITHUB_USER") {
        username = row.value;
      }
    }

    return { token, username };
  } catch (error) {
    logger.error(`Failed to get GitHub info for user ${userId}:`, error);
    return { token: null, username: null };
  }
}
