/**
 * Utility functions for GitHub-related operations
 */

/**
 * Generate GitHub OAuth URL for user authentication
 */
export function generateGitHubAuthUrl(userId: string): string {
  const baseUrl = process.env.INGRESS_URL || "http://localhost:8080";
  return `${baseUrl}/api/github/oauth/authorize?user_id=${userId}`;
}
