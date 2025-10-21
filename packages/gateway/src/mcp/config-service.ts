import { createLogger } from "@peerbot/core";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const logger = createLogger("mcp-config-service");

const McpServersSchema = z.object({
  mcpServers: z.record(z.string(), z.any()),
});

type RawMcpConfig = z.infer<typeof McpServersSchema>;

export interface OAuth2Config {
  authUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string; // Supports ${env:VAR_NAME} substitution
  scopes?: string[];
  grantType?: string;
  responseType?: string;
}

export interface McpInput {
  type: "promptString";
  id: string;
  description: string;
}

export interface HttpMcpServerConfig {
  id: string;
  upstreamUrl: string;
  oauth?: OAuth2Config;
  inputs?: McpInput[];
  headers?: Record<string, string>;
}

export interface WorkerMcpConfig {
  mcpServers: Record<string, any>;
}

interface LoadedConfig {
  rawServers: Record<string, any>;
  httpServers: Map<string, HttpMcpServerConfig>;
  mtimeMs: number;
}

type ConfigSource = { type: "file"; path: string } | { type: "http"; url: URL };

export interface McpConfigServiceOptions {
  configUrl?: string;
  configPath?: string;
}

export class McpConfigService {
  private source?: ConfigSource;
  private cache?: LoadedConfig;

  constructor(options: McpConfigServiceOptions = {}) {
    const rawLocation =
      options.configUrl ||
      options.configPath ||
      process.env.PEERBOT_MCP_SERVERS_URL ||
      process.env.PEERBOT_MCP_SERVERS_FILE;

    if (!rawLocation) {
      return;
    }

    this.source = this.resolveConfigSource(rawLocation);
  }

  /**
   * Return MCP config tailored for a worker request.
   */
  async getWorkerConfig(options: {
    baseUrl: string;
    workerToken: string;
  }): Promise<WorkerMcpConfig> {
    const { baseUrl, workerToken } = options;
    const config = await this.loadConfig();
    const workerConfig: WorkerMcpConfig = { mcpServers: {} };

    for (const [id, serverConfig] of Object.entries(config.rawServers)) {
      const cloned = cloneConfig(serverConfig);
      if (config.httpServers.has(id)) {
        const proxiedUrl = buildProxyUrl(baseUrl, id);
        cloned.url = proxiedUrl;
        cloned.headers = mergeHeaders(cloned.headers, workerToken);
      }
      workerConfig.mcpServers[id] = cloned;
    }

    return workerConfig;
  }

  /**
   * Get HTTP proxy metadata for a specific MCP server.
   */
  async getHttpServer(id: string): Promise<HttpMcpServerConfig | undefined> {
    const config = await this.loadConfig();
    return config.httpServers.get(id);
  }

  /**
   * Get all HTTP proxy metadata for all MCP servers.
   */
  async getAllHttpServers(): Promise<Map<string, HttpMcpServerConfig>> {
    const config = await this.loadConfig();
    return config.httpServers;
  }

  private async loadConfig(): Promise<LoadedConfig> {
    if (!this.source) {
      if (!this.cache) {
        this.cache = {
          rawServers: {},
          httpServers: new Map(),
          mtimeMs: 0,
        };
      }
      return this.cache;
    }

    const fallback = this.cache ?? {
      rawServers: {},
      httpServers: new Map(),
      mtimeMs: 0,
    };

    try {
      if (this.source.type === "file") {
        const fileStat = await stat(this.source.path);
        const fileContents = await readFile(this.source.path, "utf-8");
        return this.parseAndCache(fileContents, fileStat.mtimeMs);
      }

      const response = await fetch(this.source.url);
      if (!response.ok) {
        logger.error("Failed to fetch MCP config from remote URL", {
          url: this.source.url.toString(),
          status: response.status,
          statusText: response.statusText,
        });
        return fallback;
      }

      const text = await response.text();
      return this.parseAndCache(text, Date.now());
    } catch (error) {
      logger.error("Error loading MCP config", {
        error,
        source:
          this.source.type === "file"
            ? this.source.path
            : this.source.url.toString(),
      });
      return fallback;
    }
  }

  private resolveConfigSource(location: string): ConfigSource | undefined {
    try {
      const parsed = new URL(location);
      if (parsed.protocol === "file:") {
        return { type: "file", path: fileURLToPath(parsed) };
      }

      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        return { type: "http", url: parsed };
      }

      logger.warn("Unsupported MCP config URL protocol; falling back to file", {
        location,
      });
    } catch (_err) {
      // Not a valid URL, treat as path
      return { type: "file", path: path.resolve(location) };
    }

    return { type: "file", path: path.resolve(location) };
  }

  private parseAndCache(rawContents: string, mtimeMs: number): LoadedConfig {
    try {
      const parsed = McpServersSchema.safeParse(JSON.parse(rawContents));
      if (!parsed.success) {
        logger.error("Failed to parse MCP config", {
          issues: parsed.error.issues,
        });
        return (
          this.cache ?? {
            rawServers: {},
            httpServers: new Map(),
            mtimeMs,
          }
        );
      }

      const normalized = normalizeConfig(parsed.data);
      this.cache = {
        rawServers: normalized.rawServers,
        httpServers: normalized.httpServers,
        mtimeMs,
      };
      return this.cache;
    } catch (error) {
      logger.error("Failed to parse MCP config contents", { error });
      return (
        this.cache ?? {
          rawServers: {},
          httpServers: new Map(),
          mtimeMs,
        }
      );
    }
  }
}

function normalizeConfig(config: RawMcpConfig) {
  const rawServers: Record<string, any> = {};
  const httpServers = new Map<string, HttpMcpServerConfig>();

  for (const [id, serverConfig] of Object.entries(config.mcpServers)) {
    if (!serverConfig || typeof serverConfig !== "object") {
      continue;
    }

    const cloned = cloneConfig(serverConfig);
    rawServers[id] = cloned;

    if (typeof cloned.url === "string" && isHttpUrl(cloned.url)) {
      httpServers.set(id, {
        id,
        upstreamUrl: cloned.url,
        oauth:
          cloned.oauth && typeof cloned.oauth === "object"
            ? {
                authUrl: cloned.oauth.authUrl,
                tokenUrl: cloned.oauth.tokenUrl,
                clientId: cloned.oauth.clientId,
                clientSecret: cloned.oauth.clientSecret,
                scopes: cloned.oauth.scopes,
                grantType: cloned.oauth.grantType || "authorization_code",
                responseType: cloned.oauth.responseType || "code",
              }
            : undefined,
        inputs: Array.isArray(cloned.inputs)
          ? cloned.inputs.filter(
              (input: any) =>
                input &&
                typeof input === "object" &&
                input.type === "promptString"
            )
          : undefined,
        headers:
          cloned.headers && typeof cloned.headers === "object"
            ? cloned.headers
            : undefined,
      });
    }
  }

  return { rawServers, httpServers };
}

function cloneConfig(config: any) {
  return JSON.parse(JSON.stringify(config));
}

function buildProxyUrl(baseUrl: string, id: string) {
  const url = new URL(
    `/mcp/${encodeURIComponent(id)}`,
    ensureTrailingSlash(baseUrl)
  );
  return url.toString();
}

function ensureTrailingSlash(baseUrl: string): string {
  if (!baseUrl.endsWith("/")) {
    return `${baseUrl}/`;
  }
  return baseUrl;
}

function isHttpUrl(candidate: string): boolean {
  return candidate.startsWith("http://") || candidate.startsWith("https://");
}

function mergeHeaders(
  existingHeaders: unknown,
  workerToken: string
): Record<string, string> {
  const normalized: Record<string, string> = {};

  if (existingHeaders && typeof existingHeaders === "object") {
    for (const [key, value] of Object.entries(existingHeaders as any)) {
      if (typeof value === "string") {
        normalized[key] = value;
      } else if (value != null) {
        normalized[key] = String(value);
      }
    }
  }

  normalized.Authorization = `Bearer ${workerToken}`;
  return normalized;
}
