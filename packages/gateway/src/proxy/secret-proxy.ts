import { createLogger } from "@termosdev/core";
import type { Context } from "hono";
import { Hono } from "hono";
import type Redis from "ioredis";

const logger = createLogger("secret-proxy");

const PLACEHOLDER_PREFIX = "termos_secret_";
const REDIS_KEY_PREFIX = "termos:secret:";

export interface SecretMapping {
  agentId: string;
  envVarName: string;
  value: string;
  deploymentName: string;
}

export interface SecretProxyConfig {
  defaultUpstreamUrl: string;
}

/**
 * Generic secret injection proxy.
 *
 * Workers receive random placeholder tokens instead of real secrets.
 * This proxy intercepts requests, swaps placeholders back to real values
 * in auth headers, and forwards to the upstream API.
 *
 * Zero provider-specific logic — works for any API that uses
 * X-Api-Key or Authorization: Bearer headers.
 */
export class SecretProxy {
  private app: Hono;
  private redis!: Redis;
  private config: SecretProxyConfig;

  constructor(config: SecretProxyConfig) {
    this.config = config;
    this.app = new Hono();
    this.setupRoutes();
  }

  initialize(redis: Redis): void {
    this.redis = redis;
  }

  getApp(): Hono {
    return this.app;
  }

  private setupRoutes(): void {
    this.app.get("/health", (c) =>
      c.json({
        service: "secret-proxy",
        status: "enabled",
        timestamp: new Date().toISOString(),
      })
    );

    this.app.all("/*", (c) => this.handleRequest(c));
  }

  private async handleRequest(c: Context): Promise<Response> {
    try {
      return await this.forward(c);
    } catch (error) {
      logger.error("Secret proxy error:", error);
      return c.json({ error: "Internal proxy error" }, 500);
    }
  }

  /**
   * Resolve a placeholder token to its real value via Redis.
   */
  private async resolveSecret(placeholder: string): Promise<string | null> {
    const uuid = placeholder.slice(PLACEHOLDER_PREFIX.length);
    const key = `${REDIS_KEY_PREFIX}${uuid}`;
    const raw = await this.redis.get(key);
    if (!raw) return null;
    try {
      const mapping: SecretMapping = JSON.parse(raw);
      return mapping.value;
    } catch {
      return null;
    }
  }

  /**
   * If the value starts with the placeholder prefix, swap it for the real secret.
   * Returns the value unchanged if it's not a placeholder.
   */
  private async swap(value: string): Promise<string> {
    if (!value.startsWith(PLACEHOLDER_PREFIX)) return value;
    const real = await this.resolveSecret(value);
    if (!real) {
      logger.warn("Failed to resolve secret placeholder");
      return value;
    }
    return real;
  }

  private async forward(c: Context): Promise<Response> {
    // Build upstream URL — strip the proxy mount prefix
    const url = new URL(c.req.url);
    const path = url.pathname.replace(/^\/api\/proxy/, "");
    const upstream = `${this.config.defaultUpstreamUrl}${path}${url.search}`;

    // Copy request body for non-GET/HEAD
    const method = c.req.method;
    let body: string | undefined;
    if (method !== "GET" && method !== "HEAD") {
      body = await c.req.text();
    }

    // Build headers, swapping placeholder secrets in auth headers
    const headers: Record<string, string> = {};

    // Forward all original headers (except host/connection)
    const skip = new Set(["host", "connection", "transfer-encoding"]);
    for (const [key, val] of Object.entries(c.req.header())) {
      if (val && !skip.has(key.toLowerCase())) {
        headers[key] = val;
      }
    }

    // Swap secrets in auth headers
    const apiKey = headers["x-api-key"];
    if (apiKey) {
      headers["x-api-key"] = await this.swap(apiKey);
    }

    const auth = headers["authorization"] || headers["Authorization"];
    if (auth) {
      const parts = auth.split(" ");
      if (parts.length === 2 && parts[0]!.toLowerCase() === "bearer") {
        const swapped = await this.swap(parts[1]!);
        const headerName = headers["authorization"]
          ? "authorization"
          : "Authorization";
        headers[headerName] = `Bearer ${swapped}`;
      }
    }

    logger.info(`Forwarding to upstream: ${method} ${upstream}`);

    const response = await fetch(upstream, { method, headers, body });

    // Build response headers (skip hop-by-hop)
    const responseHeaders = new Headers();
    response.headers.forEach((value, key) => {
      if (
        ![
          "transfer-encoding",
          "connection",
          "upgrade",
          "content-encoding",
        ].includes(key.toLowerCase())
      ) {
        responseHeaders.set(key, value);
      }
    });

    // Stream SSE / chunked responses directly
    if (
      response.headers.get("content-type")?.includes("text/event-stream") ||
      response.headers.get("transfer-encoding") === "chunked"
    ) {
      responseHeaders.set("Cache-Control", "no-cache");
      responseHeaders.set("Connection", "keep-alive");
      if (response.body) {
        return new Response(response.body as ReadableStream, {
          status: response.status,
          headers: responseHeaders,
        });
      }
      return c.json({ error: "No response body from upstream" }, 502);
    }

    // Regular response pass-through
    const text = await response.text();
    return new Response(text, {
      status: response.status,
      headers: responseHeaders,
    });
  }
}

// ============================================================================
// Utility: store / delete placeholder mappings in Redis
// ============================================================================

/**
 * Store a secret placeholder mapping in Redis.
 * Called by the deployment manager when generating env vars.
 */
export async function storeSecretMapping(
  redis: Redis,
  uuid: string,
  mapping: SecretMapping,
  ttlSeconds: number = 7 * 24 * 60 * 60 // 7 days default
): Promise<void> {
  const key = `${REDIS_KEY_PREFIX}${uuid}`;
  await redis.set(key, JSON.stringify(mapping), "EX", ttlSeconds);
}

/**
 * Delete all secret placeholder mappings for a given deployment.
 * Called during deployment teardown.
 */
export async function deleteSecretMappings(
  redis: Redis,
  deploymentName: string
): Promise<void> {
  const pattern = `${REDIS_KEY_PREFIX}*`;
  let cursor = "0";
  do {
    const [next, keys] = await redis.scan(
      cursor,
      "MATCH",
      pattern,
      "COUNT",
      100
    );
    cursor = next;
    for (const key of keys) {
      try {
        const raw = await redis.get(key);
        if (raw) {
          const mapping: SecretMapping = JSON.parse(raw);
          if (mapping.deploymentName === deploymentName) {
            await redis.del(key);
          }
        }
      } catch {
        // Skip malformed entries
      }
    }
  } while (cursor !== "0");
}

/**
 * Update the real value for all active placeholder mappings that reference
 * a given agentId + envVarName. Used by the token refresh job.
 */
export async function updateSecretValue(
  redis: Redis,
  agentId: string,
  envVarName: string,
  newValue: string
): Promise<number> {
  const pattern = `${REDIS_KEY_PREFIX}*`;
  let cursor = "0";
  let updated = 0;
  do {
    const [next, keys] = await redis.scan(
      cursor,
      "MATCH",
      pattern,
      "COUNT",
      100
    );
    cursor = next;
    for (const key of keys) {
      try {
        const raw = await redis.get(key);
        if (!raw) continue;
        const mapping: SecretMapping = JSON.parse(raw);
        if (mapping.agentId === agentId && mapping.envVarName === envVarName) {
          mapping.value = newValue;
          const ttl = await redis.ttl(key);
          if (ttl > 0) {
            await redis.set(key, JSON.stringify(mapping), "EX", ttl);
          } else {
            await redis.set(key, JSON.stringify(mapping));
          }
          updated++;
        }
      } catch {
        // Skip malformed entries
      }
    }
  } while (cursor !== "0");
  return updated;
}

/**
 * Generate a placeholder token and store its mapping.
 * Returns the placeholder string to pass to the worker.
 */
export async function generatePlaceholder(
  redis: Redis,
  agentId: string,
  envVarName: string,
  realValue: string,
  deploymentName: string,
  ttlSeconds?: number
): Promise<string> {
  const uuid = crypto.randomUUID();
  await storeSecretMapping(
    redis,
    uuid,
    { agentId, envVarName, value: realValue, deploymentName },
    ttlSeconds
  );
  return `${PLACEHOLDER_PREFIX}${uuid}`;
}
