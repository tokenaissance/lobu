import { createLogger } from "@lobu/core";

const logger = createLogger("oauth-discovery");

/**
 * OAuth 2.0 Authorization Server Metadata (RFC 8414)
 */
interface OAuthServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  scopes_supported?: string[];
  response_types_supported?: string[];
  response_modes_supported?: string[];
  grant_types_supported?: string[];
  token_endpoint_auth_methods_supported?: string[];
  revocation_endpoint?: string;
  code_challenge_methods_supported?: string[];
}

/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728)
 */
interface ProtectedResourceMetadata {
  resource?: string;
  resource_name?: string;
  authorization_servers?: string[];
  bearer_methods_supported?: string[];
  scopes_supported?: string[];
}

/**
 * Dynamic Client Registration Response (RFC 7591)
 */
interface ClientCredentials {
  client_id: string;
  client_secret?: string;
  redirect_uris: string[];
  client_name: string;
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: string;
  registration_client_uri?: string;
  client_id_issued_at?: number;
  client_secret_expires_at?: number;
}

/**
 * Cached discovered OAuth metadata
 */
export interface DiscoveredOAuthMetadata {
  mcpId: string;
  mcpUrl: string;
  metadata: OAuthServerMetadata;
  clientCredentials?: ClientCredentials;
  discoveredAt: number;
  expiresAt: number;
}

interface OAuthDiscoveryServiceOptions {
  /**
   * Redis or cache store for discovered metadata
   */
  cacheStore?: {
    get: (key: string) => Promise<string | null>;
    set: (key: string, value: string, ttl: number) => Promise<void>;
    delete: (key: string) => Promise<void>;
  };

  /**
   * Callback URL for OAuth redirects
   */
  callbackUrl: string;

  /**
   * MCP protocol version header
   */
  protocolVersion?: string;

  /**
   * Cache TTL in seconds (default: 24 hours)
   */
  cacheTtl?: number;
}

/**
 * Service for discovering OAuth capabilities of any OAuth-enabled server
 * Implements RFC 8414 (OAuth 2.0 Authorization Server Metadata)
 * and RFC 7591 (Dynamic Client Registration)
 */
export class OAuthDiscoveryService {
  private readonly protocolVersion: string;
  private readonly cacheTtl: number;
  private readonly cacheStore?: OAuthDiscoveryServiceOptions["cacheStore"];
  private readonly callbackUrl: string;

  constructor(options: OAuthDiscoveryServiceOptions) {
    this.protocolVersion = options.protocolVersion || "2025-03-26";
    this.cacheTtl = options.cacheTtl || 86400; // 24 hours
    this.cacheStore = options.cacheStore;
    this.callbackUrl = options.callbackUrl;
  }

  /**
   * Discover OAuth metadata for an MCP server
   * Tries RFC 8414 first, then RFC 9728 (Protected Resource Metadata)
   * Returns null if discovery fails or OAuth is not supported
   */
  async discoverOAuthMetadata(
    mcpId: string,
    mcpUrl: string
  ): Promise<DiscoveredOAuthMetadata | null> {
    try {
      // Check cache first
      const cached = await this.getCachedMetadata(mcpId);
      if (cached && cached.expiresAt > Date.now()) {
        logger.debug(`Using cached OAuth metadata for ${mcpId}`);
        return cached;
      }

      logger.info(`Discovering OAuth metadata for ${mcpId} at ${mcpUrl}`);

      // Try RFC 8414 first (Authorization Server Metadata)
      const rfc8414Result = await this.discoverViaRFC8414(mcpId, mcpUrl);
      if (rfc8414Result) {
        return rfc8414Result;
      }

      // Try RFC 9728 (Protected Resource Metadata via 401 response)
      logger.debug(`RFC 8414 failed for ${mcpId}, trying RFC 9728...`);
      const rfc9728Result = await this.discoverViaRFC9728(mcpId, mcpUrl);
      if (rfc9728Result) {
        return rfc9728Result;
      }

      logger.debug(`No OAuth metadata found for ${mcpId}`);
      return null;
    } catch (error) {
      logger.error(`Failed to discover OAuth for ${mcpId}`, {
        error,
        mcpUrl,
      });
      return null;
    }
  }

  /**
   * Discover OAuth via RFC 8414 (Authorization Server Metadata)
   */
  private async discoverViaRFC8414(
    mcpId: string,
    mcpUrl: string
  ): Promise<DiscoveredOAuthMetadata | null> {
    try {
      // Parse base URL from MCP URL
      const baseUrl = this.extractBaseUrl(mcpUrl);
      logger.debug(`RFC 8414: Base URL for ${mcpId}: ${baseUrl}`);

      // Query /.well-known/oauth-authorization-server
      const metadataUrl = `${baseUrl}/.well-known/oauth-authorization-server`;
      const metadata = await this.fetchOAuthMetadata(metadataUrl);

      if (!metadata) {
        logger.debug(`RFC 8414: No OAuth metadata found at ${metadataUrl}`);
        return null;
      }

      // Validate metadata
      if (!this.validateMetadata(metadata)) {
        logger.warn(`RFC 8414: Invalid OAuth metadata for ${mcpId}`, {
          metadata,
        });
        return null;
      }

      const discovered: DiscoveredOAuthMetadata = {
        mcpId,
        mcpUrl,
        metadata,
        discoveredAt: Date.now(),
        expiresAt: Date.now() + this.cacheTtl * 1000,
      };

      // Cache the discovered metadata
      await this.cacheMetadata(discovered);

      logger.info(
        `✅ RFC 8414: Discovered OAuth for ${mcpId}. Endpoints: auth=${metadata.authorization_endpoint}, token=${metadata.token_endpoint}`
      );

      return discovered;
    } catch (error) {
      logger.debug(`RFC 8414: Discovery failed for ${mcpId}`, { error });
      return null;
    }
  }

  /**
   * Discover OAuth via RFC 9728 (Protected Resource Metadata)
   * Makes a request to the MCP, checks for 401 with WWW-Authenticate header
   */
  private async discoverViaRFC9728(
    mcpId: string,
    mcpUrl: string
  ): Promise<DiscoveredOAuthMetadata | null> {
    try {
      logger.debug(`RFC 9728: Probing ${mcpUrl} for WWW-Authenticate header`);

      // Make request to MCP URL to get 401 response
      const response = await fetch(mcpUrl, {
        method: "GET",
        headers: {
          "MCP-Protocol-Version": this.protocolVersion,
        },
        redirect: "manual",
      });

      // Check for 401 with WWW-Authenticate header
      if (response.status !== 401) {
        logger.debug(`RFC 9728: Expected 401, got ${response.status}`);
        return null;
      }

      const wwwAuth = response.headers.get("www-authenticate");
      if (!wwwAuth) {
        logger.debug(`RFC 9728: No WWW-Authenticate header in 401 response`);
        return null;
      }

      // Parse resource_metadata URL from WWW-Authenticate header
      const resourceMetadataUrl = this.parseResourceMetadataUrl(wwwAuth);
      if (!resourceMetadataUrl) {
        logger.debug(
          `RFC 9728: No resource_metadata in WWW-Authenticate header`
        );
        return null;
      }

      logger.debug(
        `RFC 9728: Fetching protected resource metadata from ${resourceMetadataUrl}`
      );

      // Fetch protected resource metadata
      const prm =
        await this.fetchProtectedResourceMetadata(resourceMetadataUrl);
      if (
        !prm ||
        !prm.authorization_servers ||
        prm.authorization_servers.length === 0
      ) {
        logger.debug(
          `RFC 9728: No authorization servers in protected resource metadata`
        );
        return null;
      }

      // Get authorization server URL
      const authServerUrl = prm.authorization_servers[0];
      if (!authServerUrl) {
        logger.debug(`RFC 9728: First authorization server is undefined`);
        return null;
      }

      logger.debug(`RFC 9728: Authorization server: ${authServerUrl}`);

      // Try RFC 8414 discovery on the authorization server
      const discoveredAuth = await this.discoverViaRFC8414(
        mcpId,
        authServerUrl
      );

      if (!discoveredAuth) {
        logger.debug(
          `RFC 9728: Failed to discover OAuth endpoints for auth server ${authServerUrl}`
        );
        return null;
      }

      logger.info(
        `✅ RFC 9728: Discovered OAuth endpoints for ${authServerUrl} via RFC 8414`
      );

      // Add scopes from protected resource metadata if available
      let metadata = discoveredAuth.metadata;
      if (prm.scopes_supported && prm.scopes_supported.length > 0) {
        metadata = {
          ...discoveredAuth.metadata,
          scopes_supported: prm.scopes_supported,
        };
      }

      const discovered: DiscoveredOAuthMetadata = {
        mcpId,
        mcpUrl,
        metadata,
        discoveredAt: Date.now(),
        expiresAt: Date.now() + this.cacheTtl * 1000,
      };

      // Cache the discovered metadata
      await this.cacheMetadata(discovered);

      logger.info(
        `✅ RFC 9728: Discovered OAuth for ${mcpId} via ${authServerUrl}. Endpoints: auth=${metadata.authorization_endpoint}, token=${metadata.token_endpoint}`
      );

      return discovered;
    } catch (error) {
      logger.debug(`RFC 9728: Discovery failed for ${mcpId}`, { error });
      return null;
    }
  }

  /**
   * Parse resource_metadata URL from WWW-Authenticate header
   * Example: Bearer error="invalid_request", resource_metadata="https://..."
   */
  private parseResourceMetadataUrl(wwwAuth: string): string | null {
    const match = wwwAuth.match(/resource_metadata="([^"]+)"/);
    return match?.[1] || null;
  }

  /**
   * Fetch Protected Resource Metadata (RFC 9728)
   */
  private async fetchProtectedResourceMetadata(
    url: string
  ): Promise<ProtectedResourceMetadata | null> {
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "MCP-Protocol-Version": this.protocolVersion,
        },
      });

      if (!response.ok) {
        logger.debug(
          `Failed to fetch protected resource metadata: ${response.status}`
        );
        return null;
      }

      const metadata = (await response.json()) as ProtectedResourceMetadata;
      return metadata;
    } catch (error) {
      logger.debug(`Error fetching protected resource metadata from ${url}`, {
        error,
      });
      return null;
    }
  }

  /**
   * Register a client dynamically with the MCP server
   * Implements RFC 7591 (Dynamic Client Registration)
   */
  async registerClient(
    mcpId: string,
    metadata: OAuthServerMetadata
  ): Promise<ClientCredentials | null> {
    try {
      if (!metadata.registration_endpoint) {
        logger.debug(
          `No registration endpoint for ${mcpId}, dynamic registration not supported`
        );
        return null;
      }

      logger.info(
        `Attempting dynamic client registration for ${mcpId} at ${metadata.registration_endpoint}`
      );

      // Prepare registration request
      const registrationRequest = {
        client_name: "Lobu",
        redirect_uris: [this.callbackUrl],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none", // PKCE - no client secret
      };

      // Send registration request
      const response = await fetch(metadata.registration_endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "MCP-Protocol-Version": this.protocolVersion,
        },
        body: JSON.stringify(registrationRequest),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.warn(
          `Failed to register client for ${mcpId}: ${response.status} ${response.statusText}`,
          { errorText }
        );
        return null;
      }

      const credentials = (await response.json()) as ClientCredentials;

      logger.info(`Successfully registered client for ${mcpId}`, {
        client_id: credentials.client_id,
        has_secret: !!credentials.client_secret,
        auth_method: credentials.token_endpoint_auth_method,
      });

      return credentials;
    } catch (error) {
      logger.error(`Failed to register client for ${mcpId}`, { error });
      return null;
    }
  }

  /**
   * Get or create client credentials for an MCP
   * Uses cached credentials if available, otherwise performs dynamic registration
   */
  async getOrCreateClientCredentials(
    mcpId: string,
    metadata: OAuthServerMetadata
  ): Promise<ClientCredentials | null> {
    try {
      // Check if we have cached credentials
      const cached = await this.getCachedMetadata(mcpId);
      if (cached?.clientCredentials) {
        logger.debug(`Using cached client credentials for ${mcpId}`);
        return cached.clientCredentials;
      }

      // Perform dynamic registration
      const credentials = await this.registerClient(mcpId, metadata);
      if (!credentials) {
        return null;
      }

      // Update cache with credentials
      if (cached) {
        cached.clientCredentials = credentials;
        await this.cacheMetadata(cached);
      }

      return credentials;
    } catch (error) {
      logger.error(`Failed to get or create client credentials for ${mcpId}`, {
        error,
      });
      return null;
    }
  }

  /**
   * Extract base URL from MCP URL
   * Example: https://mcp.sentry.dev/mcp -> https://mcp.sentry.dev
   */
  private extractBaseUrl(mcpUrl: string): string {
    try {
      const url = new URL(mcpUrl);
      return `${url.protocol}//${url.host}`;
    } catch (error) {
      logger.error("Failed to parse MCP URL", { mcpUrl, error });
      throw new Error(`Invalid MCP URL: ${mcpUrl}`);
    }
  }

  /**
   * Fetch OAuth metadata from well-known endpoint
   */
  private async fetchOAuthMetadata(
    metadataUrl: string
  ): Promise<OAuthServerMetadata | null> {
    try {
      const response = await fetch(metadataUrl, {
        method: "GET",
        headers: {
          "MCP-Protocol-Version": this.protocolVersion,
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          logger.debug(`OAuth metadata endpoint not found: ${metadataUrl}`);
        } else {
          logger.warn(
            `Failed to fetch OAuth metadata: ${response.status} ${response.statusText}`,
            { metadataUrl }
          );
        }
        return null;
      }

      const metadata = (await response.json()) as OAuthServerMetadata;
      return metadata;
    } catch (error) {
      logger.debug(`Error fetching OAuth metadata from ${metadataUrl}`, {
        error,
      });
      return null;
    }
  }

  /**
   * Validate OAuth metadata has required fields
   */
  private validateMetadata(metadata: OAuthServerMetadata): boolean {
    if (!metadata.issuer) {
      logger.debug("Missing issuer in OAuth metadata");
      return false;
    }

    if (!metadata.authorization_endpoint) {
      logger.debug("Missing authorization_endpoint in OAuth metadata");
      return false;
    }

    if (!metadata.token_endpoint) {
      logger.debug("Missing token_endpoint in OAuth metadata");
      return false;
    }

    return true;
  }

  /**
   * Cache discovered metadata
   */
  private async cacheMetadata(
    discovered: DiscoveredOAuthMetadata
  ): Promise<void> {
    if (!this.cacheStore) {
      return;
    }

    try {
      const cacheKey = this.getCacheKey(discovered.mcpId);
      const ttl = Math.floor((discovered.expiresAt - Date.now()) / 1000);

      if (ttl > 0) {
        await this.cacheStore.set(cacheKey, JSON.stringify(discovered), ttl);
        logger.debug(`Cached OAuth metadata for ${discovered.mcpId}`, { ttl });
      }
    } catch (error) {
      logger.error(`Failed to cache metadata for ${discovered.mcpId}`, {
        error,
      });
    }
  }

  /**
   * Get cached metadata
   */
  async getCachedMetadata(
    mcpId: string
  ): Promise<DiscoveredOAuthMetadata | null> {
    if (!this.cacheStore) {
      return null;
    }

    try {
      const cacheKey = this.getCacheKey(mcpId);
      const cached = await this.cacheStore.get(cacheKey);

      if (!cached) {
        return null;
      }

      const discovered: DiscoveredOAuthMetadata = JSON.parse(cached);

      // Check if expired
      if (discovered.expiresAt <= Date.now()) {
        logger.debug(`Cached metadata expired for ${mcpId}`);
        await this.cacheStore.delete(cacheKey);
        return null;
      }

      return discovered;
    } catch (error) {
      logger.error(`Failed to get cached metadata for ${mcpId}`, { error });
      return null;
    }
  }

  /**
   * Clear cached metadata for an MCP
   */
  async clearCache(mcpId: string): Promise<void> {
    if (!this.cacheStore) {
      return;
    }

    try {
      const cacheKey = this.getCacheKey(mcpId);
      await this.cacheStore.delete(cacheKey);
      logger.info(`Cleared cached OAuth metadata for ${mcpId}`);
    } catch (error) {
      logger.error(`Failed to clear cache for ${mcpId}`, { error });
    }
  }

  /**
   * Get cache key for an MCP
   */
  private getCacheKey(mcpId: string): string {
    return `mcp:oauth:discovery:${mcpId}`;
  }
}
