import type { OAuth2Config } from "../mcp/config-service";

// Local type definitions to avoid dependency on MCP SDK internal paths
interface OAuthTokens {
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
}

interface OAuthErrorResponse {
  error: string;
  error_description?: string;
  error_uri?: string;
}

import type { McpCredentialRecord } from "../mcp/credential-store";
import { BaseOAuth2Client } from "./base-client";

/**
 * Generic OAuth2 client for token exchange
 * Supports multiple OAuth2 providers (GitHub, Google, etc.)
 *
 * Extends base OAuth2 client and adds client secret handling
 */
export class GenericOAuth2Client extends BaseOAuth2Client {
  constructor() {
    super("oauth-client");
  }

  /**
   * Build authorization URL with all parameters
   */
  buildAuthUrl(
    oauth: OAuth2Config,
    state: string,
    redirectUri: string,
    options?: { codeChallenge?: string; resource?: string }
  ): string {
    const url = new URL(oauth.authUrl);
    url.searchParams.set("client_id", oauth.clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", oauth.responseType || "code");
    url.searchParams.set("state", state);

    if (oauth.scopes && oauth.scopes.length > 0) {
      url.searchParams.set("scope", oauth.scopes.join(" "));
    }

    if (options?.codeChallenge) {
      url.searchParams.set("code_challenge", options.codeChallenge);
      url.searchParams.set("code_challenge_method", "S256");
    }

    if (options?.resource) {
      url.searchParams.set("resource", options.resource);
    }

    return url.toString();
  }

  /**
   * Exchange authorization code for access token
   * Supports both JSON and form-encoded responses
   */
  async exchangeCodeForToken(
    code: string,
    oauth: OAuth2Config,
    redirectUri: string,
    options?: { codeVerifier?: string; resource?: string }
  ): Promise<McpCredentialRecord> {
    const authMethod = oauth.tokenEndpointAuthMethod || "client_secret_post";
    const isPKCE = authMethod === "none";
    const isBasicAuth = authMethod === "client_secret_basic";

    let clientSecret = "";
    if (!isPKCE) {
      clientSecret = oauth.clientSecret || "";
      if (!clientSecret) {
        throw new Error("Client secret is not configured");
      }
    }

    // Build request body
    const body = new URLSearchParams({
      grant_type: oauth.grantType || "authorization_code",
      code,
      redirect_uri: redirectUri,
    });

    if (options?.codeVerifier) {
      body.set("code_verifier", options.codeVerifier);
    }

    if (options?.resource) {
      body.set("resource", options.resource);
    }

    // For basic auth, credentials go in the Authorization header, not the body
    const headers: Record<string, string> = {};
    if (isBasicAuth) {
      headers.Authorization = `Basic ${Buffer.from(`${oauth.clientId}:${clientSecret}`).toString("base64")}`;
    } else {
      body.set("client_id", oauth.clientId);
      if (!isPKCE && clientSecret) {
        body.set("client_secret", clientSecret);
      }
    }

    const tokenData = await this.exchangeToken<
      OAuthTokens | OAuthErrorResponse
    >(oauth.tokenUrl, body, "form", headers);

    // Check for error response
    if ("error" in tokenData) {
      throw new Error(
        `OAuth token exchange failed: ${tokenData.error}${tokenData.error_description ? ` - ${tokenData.error_description}` : ""}`
      );
    }

    // Build credential record
    const expiresAt = this.calculateExpiresAt(tokenData.expires_in);

    this.logger.info(
      `Token exchange successful, expires_in: ${tokenData.expires_in}s`
    );

    return {
      accessToken: tokenData.access_token,
      tokenType: tokenData.token_type || "Bearer",
      expiresAt,
      refreshToken: tokenData.refresh_token,
      metadata: {
        scope: tokenData.scope,
        grantedAt: new Date().toISOString(),
      },
    };
  }

  /**
   * Refresh access token using refresh token
   * Uses generic refresh method from base client with MCP config
   */
  async refreshToken(
    refreshToken: string,
    oauth: OAuth2Config
  ): Promise<McpCredentialRecord> {
    const authMethod = oauth.tokenEndpointAuthMethod || "client_secret_post";
    const isBasicAuth = authMethod === "client_secret_basic";

    const clientSecret = oauth.clientSecret || undefined;

    if (!clientSecret && authMethod !== "none") {
      throw new Error("Client secret is not configured");
    }

    // For basic auth, use Authorization header instead of body params
    if (isBasicAuth) {
      const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      });
      const headers: Record<string, string> = {
        Authorization: `Basic ${Buffer.from(`${oauth.clientId}:${clientSecret}`).toString("base64")}`,
      };
      const tokenData = await this.exchangeToken<
        OAuthTokens | OAuthErrorResponse
      >(oauth.tokenUrl, body, "form", headers);

      if ("error" in tokenData) {
        throw new Error(
          `OAuth token refresh failed: ${tokenData.error}${tokenData.error_description ? ` - ${tokenData.error_description}` : ""}`
        );
      }

      const expiresAt = this.calculateExpiresAt(tokenData.expires_in);
      this.logger.info(
        `Token refresh successful, expires_in: ${tokenData.expires_in}s`
      );

      return {
        accessToken: tokenData.access_token,
        tokenType: tokenData.token_type || "Bearer",
        expiresAt,
        refreshToken: tokenData.refresh_token || refreshToken,
        metadata: {
          scope: tokenData.scope,
          refreshedAt: new Date().toISOString(),
        },
      };
    }

    const tokenData = await this.refreshTokenWithConfig<
      OAuthTokens | OAuthErrorResponse
    >(oauth.tokenUrl, oauth.clientId, refreshToken, {
      clientSecret,
      contentType: "form",
      tokenEndpointAuthMethod: authMethod,
    });

    // Check for error response
    if ("error" in tokenData) {
      throw new Error(
        `OAuth token refresh failed: ${tokenData.error}${tokenData.error_description ? ` - ${tokenData.error_description}` : ""}`
      );
    }

    const expiresAt = this.calculateExpiresAt(tokenData.expires_in);

    this.logger.info(
      `Token refresh successful, expires_in: ${tokenData.expires_in}s`
    );

    return {
      accessToken: tokenData.access_token,
      tokenType: tokenData.token_type || "Bearer",
      expiresAt,
      refreshToken: tokenData.refresh_token || refreshToken, // Keep old if not provided
      metadata: {
        scope: tokenData.scope,
        refreshedAt: new Date().toISOString(),
      },
    };
  }
}
