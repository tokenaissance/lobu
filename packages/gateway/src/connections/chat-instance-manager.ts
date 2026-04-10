/**
 * ChatInstanceManager — manages Chat SDK instances for API-driven platform connections.
 * Owns Redis persistence, Chat lifecycle, and webhook dispatch.
 */

import { randomUUID } from "node:crypto";
import { createLogger, isSecretRef } from "@lobu/core";
import type Redis from "ioredis";
import type { CoreServices, PlatformAdapter } from "../platform";
import {
  deleteSecretsByPrefix,
  persistSecretValue,
  resolveSecretValue,
} from "../secrets";
import { SlackConnectionCoordinator } from "./slack-connection-coordinator";
import { registerSlackPlatformHandlers } from "./slack-platform-bridge";
import {
  type ConnectionSettings,
  isSecretField,
  type PlatformAdapterConfig,
  type PlatformConnection,
} from "./types";

/** Shallow structural equality for plain config objects. */
function configsEqual(
  a: Record<string, unknown>,
  b: Record<string, unknown>
): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

type HistoryRecord = {
  role: "user" | "assistant";
  content: string;
  authorName?: string;
  timestamp: number;
};

const logger = createLogger("chat-instance-manager");
export const ADAPTER_FACTORIES: Record<string, (config: any) => Promise<any>> =
  {
    telegram: async (c) =>
      (await import("@chat-adapter/telegram")).createTelegramAdapter(c),
    slack: async (c) =>
      (await import("@chat-adapter/slack")).createSlackAdapter(c),
    discord: async (c) =>
      (await import("@chat-adapter/discord")).createDiscordAdapter(c),
    whatsapp: async (c) =>
      (await import("@chat-adapter/whatsapp")).createWhatsAppAdapter(c),
    teams: async (c) =>
      (await import("@chat-adapter/teams")).createTeamsAdapter(c),
    gchat: async (c) =>
      (await import("@chat-adapter/gchat")).createGoogleChatAdapter(c),
  };

interface ManagedInstance {
  connection: PlatformConnection;
  chat: any; // Chat SDK instance
  cleanup?: () => Promise<void>;
  interactionCleanup?: () => void;
}

export class ChatInstanceManager {
  private instances = new Map<string, ManagedInstance>();
  private redis!: Redis;
  private services!: CoreServices;
  private publicGatewayUrl = "";
  private slackCoordinator!: SlackConnectionCoordinator;

  async initialize(services: CoreServices): Promise<void> {
    this.services = services;
    this.redis = services.getQueue().getRedisClient();
    this.publicGatewayUrl = services.getPublicGatewayUrl();
    this.slackCoordinator = this.buildSlackCoordinator();

    // Load all connections from Redis and start active ones
    const connectionIds = await this.redis.smembers("connections:all");
    logger.debug(
      { count: connectionIds.length },
      "Loading connections from Redis"
    );

    for (const id of connectionIds) {
      const raw = await this.redis.get(`connection:${id}`);
      if (!raw) {
        await this.redis.srem("connections:all", id);
        continue;
      }

      let connection: PlatformConnection;
      try {
        connection = JSON.parse(raw) as PlatformConnection;
      } catch (error) {
        logger.warn(
          { id, error: String(error) },
          "Removing connection with malformed JSON"
        );
        await this.deleteConnectionRecord(id);
        continue;
      }

      try {
        connection.config = await this.resolveConfigForRuntime(
          connection.id,
          connection.config
        );
      } catch (error) {
        logger.warn(
          { id, platform: connection.platform, error: String(error) },
          "Removing connection with unresolved secret refs — reseed from lobu.toml"
        );
        await this.deleteConnectionRecord(connection.id, connection);
        continue;
      }

      try {
        if (connection.status === "active") {
          await this.startInstance(connection);
        }
      } catch (error) {
        logger.error({ id, error: String(error) }, "Failed to load connection");
      }
    }
  }

  private async deleteConnectionRecord(
    id: string,
    connection?: PlatformConnection
  ): Promise<void> {
    await this.redis.del(`connection:${id}`);
    await this.redis.srem("connections:all", id);
    if (connection?.templateAgentId) {
      await this.redis.srem(
        `connections:agent:${connection.templateAgentId}`,
        id
      );
    }
    // Also clear any secrets owned by the torn-down record so a replay
    // of `initialize()` does not inherit stale credential material.
    try {
      await deleteSecretsByPrefix(
        this.services.getSecretStore(),
        `connections/${id}/`
      );
    } catch (error) {
      logger.warn(
        { id, error: String(error) },
        "Failed to purge connection secrets during record cleanup"
      );
    }
  }

  async shutdown(): Promise<void> {
    logger.info(
      { count: this.instances.size },
      "Shutting down all connections"
    );
    const shutdownPromises = Array.from(this.instances.values()).map(
      async (instance) => {
        try {
          instance.interactionCleanup?.();
          await instance.cleanup?.();
        } catch (error) {
          logger.error(
            { id: instance.connection.id, error: String(error) },
            "Error shutting down connection"
          );
        }
      }
    );
    await Promise.allSettled(shutdownPromises);
    this.instances.clear();
  }

  async addConnection(
    platform: string,
    templateAgentId: string | undefined,
    config: PlatformAdapterConfig,
    settings?: ConnectionSettings,
    metadata: Record<string, any> = {}
  ): Promise<PlatformConnection> {
    if (!(platform in ADAPTER_FACTORIES)) {
      throw new Error(`Unsupported platform: ${platform}`);
    }
    if (config.platform !== platform) {
      throw new Error(
        `Config platform mismatch: expected ${platform}, got ${config.platform}`
      );
    }

    const id = randomUUID().replace(/-/g, "").slice(0, 16);
    const now = Date.now();

    const connection: PlatformConnection = {
      id,
      platform,
      ...(templateAgentId ? { templateAgentId } : {}),
      config,
      settings: settings ?? { allowGroups: true },
      metadata,
      status: "active",
      createdAt: now,
      updatedAt: now,
    };

    // Start the Chat SDK instance
    await this.startInstance(connection);

    // Persist (sensitive fields are moved into the secret store as refs)
    await this.persistConnection(connection);

    logger.info({ id, platform, templateAgentId }, "Connection added");
    return connection;
  }

  async removeConnection(id: string): Promise<void> {
    const instance = this.instances.get(id);
    if (instance) {
      instance.interactionCleanup?.();
      await instance.cleanup?.();
      this.instances.delete(id);
    }

    // Clean up Redis
    const raw = await this.redis.get(`connection:${id}`);
    if (raw) {
      const conn = JSON.parse(raw) as PlatformConnection;
      if (conn.templateAgentId) {
        await this.redis.srem(`connections:agent:${conn.templateAgentId}`, id);
      }
    }
    await this.redis.del(`connection:${id}`);
    await this.redis.srem("connections:all", id);

    // Cascade-delete per-channel chat history (populated by the chat
    // response bridge, see `chat:history:{id}:{channelId}`) so that
    // removing a connection also drops its conversation logs.
    const historyDeleted = await this.deleteKeysByPattern(
      `chat:history:${id}:*`
    );

    // Cascade-delete secrets owned by this connection (botToken, signing
    // secrets, etc). Uses the same `connections/{id}/` prefix that
    // `normalizeConfigForStorage` writes under.
    const secretsDeleted = await deleteSecretsByPrefix(
      this.services.getSecretStore(),
      `connections/${id}/`
    );

    logger.info({ id, secretsDeleted, historyDeleted }, "Connection removed");
  }

  /**
   * SCAN-and-DEL every key matching `pattern`. Used by `removeConnection`
   * to garbage-collect per-connection Redis state. Returns the number of
   * keys deleted.
   */
  private async deleteKeysByPattern(pattern: string): Promise<number> {
    let cursor = "0";
    let deleted = 0;
    do {
      const [next, keys] = await this.redis.scan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        100
      );
      cursor = next;
      if (keys.length > 0) {
        deleted += await this.redis.del(...keys);
      }
    } while (cursor !== "0");
    return deleted;
  }

  async restartConnection(id: string): Promise<void> {
    const instance = this.instances.get(id);
    if (instance) {
      instance.interactionCleanup?.();
      await instance.cleanup?.();
      this.instances.delete(id);
    }

    const raw = await this.redis.get(`connection:${id}`);
    if (!raw) throw new Error(`Connection ${id} not found`);

    const connection = JSON.parse(raw) as PlatformConnection;

    // Resolve the (possibly-ref'd) config before we attempt to boot. If
    // this fails — e.g. a secret ref was wiped between restarts — we
    // can't auto-delete the record (that's initialize()'s startup job,
    // not a user-initiated restart), so stamp the row with the error
    // and re-throw so the caller (and UI) can surface it.
    try {
      connection.config = await this.resolveConfigForRuntime(
        connection.id,
        connection.config
      );
    } catch (error) {
      connection.status = "error";
      connection.errorMessage = `Failed to resolve connection secrets: ${
        error instanceof Error ? error.message : String(error)
      }`;
      connection.updatedAt = Date.now();
      await this.persistConnection(connection);
      logger.error(
        { id, error: String(error) },
        "restartConnection: failed to resolve secrets"
      );
      throw error;
    }

    connection.status = "active";
    connection.errorMessage = undefined;
    connection.updatedAt = Date.now();

    try {
      await this.startInstance(connection);
    } catch (error) {
      // startInstance sets connection.status = "error" — persist so UI reflects it
      await this.persistConnection(connection);
      throw error;
    }
    await this.persistConnection(connection);

    logger.info({ id }, "Connection restarted");
  }

  async stopConnection(id: string): Promise<void> {
    const instance = this.instances.get(id);
    if (instance) {
      instance.interactionCleanup?.();
      await instance.cleanup?.();
      this.instances.delete(id);
    }

    const raw = await this.redis.get(`connection:${id}`);
    if (!raw) throw new Error(`Connection ${id} not found`);

    const connection = JSON.parse(raw) as PlatformConnection;
    connection.config = await this.resolveConfigForRuntime(
      connection.id,
      connection.config
    );
    connection.status = "stopped";
    connection.updatedAt = Date.now();
    await this.persistConnection(connection);

    logger.info({ id }, "Connection stopped");
  }

  async updateConnection(
    id: string,
    updates: {
      templateAgentId?: string | null;
      config?: PlatformAdapterConfig;
      settings?: ConnectionSettings;
      metadata?: Record<string, any>;
    }
  ): Promise<PlatformConnection> {
    const raw = await this.redis.get(`connection:${id}`);
    if (!raw) throw new Error(`Connection ${id} not found`);

    const connection = JSON.parse(raw) as PlatformConnection;
    connection.config = await this.resolveConfigForRuntime(
      connection.id,
      connection.config
    );

    // Compute the merged config first (skipping sanitized `***...`
    // placeholder values), then decide whether a restart is needed by
    // comparing merged-vs-current. A previous version compared the raw
    // `updates.config` to `connection.config`, which would trigger a
    // spurious restart every time the UI posted back a sanitized form.
    const previousConfig = connection.config as Record<string, unknown>;
    let nextConfig: Record<string, unknown> | undefined;
    if (updates.config !== undefined) {
      const merged = { ...previousConfig };
      for (const [key, value] of Object.entries(updates.config)) {
        if (typeof value === "string" && value.startsWith("***")) continue;
        merged[key] = value;
      }
      merged.platform = updates.config.platform;
      nextConfig = merged;
    }

    const needsRestart =
      nextConfig !== undefined && !configsEqual(nextConfig, previousConfig);

    if (updates.templateAgentId !== undefined) {
      // Update agent index — remove old, add new
      if (connection.templateAgentId) {
        await this.redis.srem(
          `connections:agent:${connection.templateAgentId}`,
          id
        );
      }
      if (updates.templateAgentId) {
        connection.templateAgentId = updates.templateAgentId;
        await this.redis.sadd(
          `connections:agent:${connection.templateAgentId}`,
          id
        );
      } else {
        delete connection.templateAgentId;
      }
    }
    if (nextConfig !== undefined) {
      connection.config = nextConfig as PlatformAdapterConfig;
    }
    if (updates.settings !== undefined) {
      connection.settings = { ...connection.settings, ...updates.settings };
    }
    if (updates.metadata !== undefined) {
      connection.metadata = {
        ...(connection.metadata || {}),
        ...updates.metadata,
      };
    }
    connection.updatedAt = Date.now();

    if (needsRestart && connection.status === "active") {
      const instance = this.instances.get(id);
      if (instance) {
        instance.interactionCleanup?.();
        await instance.cleanup?.();
        this.instances.delete(id);
      }
      await this.startInstance(connection);
    } else {
      const instance = this.instances.get(id);
      if (instance) {
        instance.connection = connection;
      }
    }

    await this.persistConnection(connection);
    return this.sanitizeConnection(connection);
  }

  async listConnections(filter?: {
    platform?: string;
    templateAgentId?: string;
  }): Promise<PlatformConnection[]> {
    let ids: string[];
    if (filter?.templateAgentId) {
      ids = await this.redis.smembers(
        `connections:agent:${filter.templateAgentId}`
      );
    } else {
      ids = await this.redis.smembers("connections:all");
    }

    const connections: PlatformConnection[] = [];
    for (const id of ids) {
      const raw = await this.redis.get(`connection:${id}`);
      if (!raw) continue;
      const conn = JSON.parse(raw) as PlatformConnection;
      if (filter?.platform && conn.platform !== filter.platform) continue;
      connections.push(this.sanitizeConnection(conn));
    }
    return connections;
  }

  async getConnection(id: string): Promise<PlatformConnection | null> {
    const raw = await this.redis.get(`connection:${id}`);
    if (!raw) return null;
    return this.sanitizeConnection(JSON.parse(raw));
  }

  has(id: string): boolean {
    return this.instances.has(id);
  }

  getInstance(id: string): ManagedInstance | undefined {
    return this.instances.get(id);
  }

  /** Get a resolved secret value from a running connection's config. */
  getConnectionConfigSecret(
    connectionId: string,
    field: string
  ): string | undefined {
    const instance = this.instances.get(connectionId);
    if (!instance) return undefined;
    const config = instance.connection.config as Record<string, unknown>;
    const val = config[field];
    return typeof val === "string" ? val : undefined;
  }

  async handleWebhook(
    connectionId: string,
    request: Request
  ): Promise<Response> {
    const instance = this.instances.get(connectionId);
    if (!instance) {
      return new Response("Connection not found", { status: 404 });
    }

    const { platform } = instance.connection;
    const webhookHandler = instance.chat.webhooks?.[platform];
    if (!webhookHandler) {
      logger.warn(
        { connectionId, platform },
        "No webhook handler found for platform"
      );
      return new Response("No webhook handler", { status: 404 });
    }

    try {
      return await webhookHandler(request);
    } catch (error) {
      logger.error(
        { connectionId, platform, error: String(error) },
        "Webhook handling failed"
      );
      return new Response("Internal error", { status: 500 });
    }
  }

  getServices(): CoreServices {
    return this.services;
  }

  async findSlackConnectionByTeamId(
    teamId: string
  ): Promise<PlatformConnection | null> {
    return this.slackCoordinator.findConnectionByTeamId(teamId);
  }

  async getDefaultSlackConnection(): Promise<PlatformConnection | null> {
    return this.slackCoordinator.getDefaultConnection();
  }

  async ensureSlackWorkspaceConnection(
    teamId: string,
    installation: {
      botToken: string;
      botUserId?: string;
      teamName?: string;
    }
  ): Promise<PlatformConnection> {
    return this.slackCoordinator.ensureWorkspaceConnection(
      teamId,
      installation
    );
  }

  async completeSlackOAuthInstall(
    request: Request,
    redirectUri?: string
  ): Promise<{
    teamId: string;
    teamName?: string;
    connectionId: string;
  }> {
    return this.slackCoordinator.completeOAuthInstall(request, redirectUri);
  }

  async handleSlackAppWebhook(request: Request): Promise<Response> {
    return this.slackCoordinator.handleAppWebhook(request);
  }

  // --- Private ---

  private async startInstance(connection: PlatformConnection): Promise<void> {
    try {
      const { Chat } = await import("chat");
      const adapter = await this.createAdapter(connection);
      const stateAdapter = await this.createStateAdapter();

      const adapterKey = connection.platform;
      const chat = new Chat({
        userName: connection.metadata.botUsername || `bot-${connection.id}`,
        adapters: { [adapterKey]: adapter },
        state: stateAdapter,
        logger: "warn",
      });

      // Register message handlers (imported lazily to avoid circular deps)
      const { registerMessageHandlers } = await import(
        "./message-handler-bridge"
      );
      const { CommandDispatcher } = await import(
        "../commands/command-dispatcher"
      );
      const commandDispatcher = new CommandDispatcher({
        registry: this.services.getCommandRegistry(),
        channelBindingService: this.services.getChannelBindingService(),
      });
      registerMessageHandlers(
        chat,
        connection,
        this.services,
        this,
        commandDispatcher
      );
      registerSlackPlatformHandlers(chat, connection, commandDispatcher);

      chat.registerSingleton();

      // Initialize adapters (starts long-polling for Telegram, etc.)
      await chat.initialize();

      // Set webhook URL if applicable
      const mode = (connection.config as any).mode ?? "auto";
      const useWebhook =
        mode === "webhook" || (mode === "auto" && !!this.publicGatewayUrl);
      if (useWebhook && this.publicGatewayUrl) {
        const webhookUrl = `${this.publicGatewayUrl}/api/v1/webhooks/${connection.id}`;
        logger.info({ id: connection.id, webhookUrl }, "Setting webhook");
      }

      const cleanup = async () => {
        try {
          await chat.shutdown();
        } catch {
          // best effort
        }
      };

      // Populate metadata (bot username etc.) from adapter properties
      if (!connection.metadata.botUsername) {
        try {
          const userName = adapter.userName || adapter.botUsername;
          if (userName) {
            connection.metadata.botUsername = userName;
            await this.updateConnection(connection.id, {
              metadata: { botUsername: userName },
            });
          }
        } catch {
          // non-critical
        }
      }

      this.instances.set(connection.id, { connection, chat, cleanup });

      const { registerInteractionBridge } = await import(
        "./interaction-bridge"
      );
      const mcpProxy = this.services.getMcpProxy();
      const interactionCleanup = registerInteractionBridge(
        this.services.getInteractionService(),
        this,
        connection,
        chat,
        this.services.getGrantStore(),
        mcpProxy?.executeToolDirect.bind(mcpProxy)
      );
      this.instances.get(connection.id)!.interactionCleanup =
        interactionCleanup;

      // Register slash commands with the platform (e.g. Telegram menu)
      this.registerPlatformCommands(connection).catch((err) => {
        logger.warn(
          { id: connection.id, error: String(err) },
          "Failed to register platform commands"
        );
      });

      logger.info(
        { id: connection.id, platform: connection.platform },
        "Chat instance started"
      );
    } catch (error) {
      connection.status = "error";
      connection.errorMessage = String(error);
      logger.error(
        { id: connection.id, error: String(error) },
        "Failed to start Chat instance"
      );
      throw error;
    }
  }

  private async createAdapter(connection: PlatformConnection): Promise<any> {
    const factory = ADAPTER_FACTORIES[connection.platform];
    if (!factory) {
      throw new Error(`No adapter factory for: ${connection.platform}`);
    }
    return factory(connection.config);
  }

  private async createStateAdapter(): Promise<any> {
    const { createIoRedisState } = await import("@chat-adapter/state-ioredis");
    return createIoRedisState({
      client: this.redis,
      keyPrefix: "chat-conn",
      logger: "warn",
    } as any);
  }

  /**
   * Register slash commands with the platform's native command menu.
   * Currently supports Telegram (setMyCommands) and Slack (via manifest).
   */
  private async registerPlatformCommands(
    connection: PlatformConnection
  ): Promise<void> {
    const commands = this.services
      .getCommandRegistry()
      .getAll()
      .map((cmd) => ({
        command: cmd.name,
        description: cmd.description,
      }));

    if (connection.platform === "telegram") {
      const botToken = (connection.config as any).botToken;
      if (!botToken) return;

      const apiBase =
        (connection.config as any).apiBaseUrl || "https://api.telegram.org";
      const resp = await fetch(`${apiBase}/bot${botToken}/setMyCommands`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commands }),
      });

      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(
          `Telegram setMyCommands failed: ${resp.status} ${text}`
        );
      }

      logger.info(
        { id: connection.id, count: commands.length },
        "Telegram bot commands menu registered"
      );
    }
  }

  private findRunningInstanceByPlatform(
    platform: string
  ): ManagedInstance | undefined {
    return Array.from(this.instances.values()).find(
      (instance) => instance.connection.platform === platform
    );
  }

  private buildSlackCoordinator(): SlackConnectionCoordinator {
    return new SlackConnectionCoordinator({
      addConnection: this.addConnection.bind(this),
      createStateAdapter: this.createStateAdapter.bind(this),
      ensureConnectionRunning: this.ensureConnectionRunning.bind(this),
      forwardWebhook: this.handleWebhook.bind(this),
      getCurrentSlackConfig: () => {
        const slackInstance = this.findRunningInstanceByPlatform("slack");
        const currentConfig = (slackInstance?.connection.config || {}) as
          | Record<string, any>
          | undefined;

        return {
          signingSecret: currentConfig?.signingSecret,
          clientId: currentConfig?.clientId,
          clientSecret: currentConfig?.clientSecret,
          encryptionKey: currentConfig?.encryptionKey,
          installationKeyPrefix: currentConfig?.installationKeyPrefix,
          userName:
            currentConfig?.userName ||
            slackInstance?.connection.metadata?.botUsername,
          botToken: currentConfig?.botToken,
        };
      },
      getRunningChat: (connectionId) => this.getInstance(connectionId)?.chat,
      hasConnection: this.has.bind(this),
      listSlackConnections: () => this.listConnections({ platform: "slack" }),
      restartConnection: this.restartConnection.bind(this),
      updateConnection: this.updateConnection.bind(this),
    });
  }

  private async ensureConnectionRunning(id: string): Promise<boolean> {
    if (this.has(id)) {
      return true;
    }

    // Don't auto-restart intentionally stopped connections
    const raw = await this.redis.get(`connection:${id}`);
    if (raw) {
      const connection = JSON.parse(raw) as PlatformConnection;
      if (connection.status === "stopped") {
        logger.info({ id }, "Connection is stopped, not auto-restarting");
        return false;
      }
    }

    try {
      await this.restartConnection(id);
      return this.has(id);
    } catch (error) {
      logger.error(
        { id, error: String(error) },
        "Failed to restart connection"
      );
      return false;
    }
  }

  private async persistConnection(
    connection: PlatformConnection
  ): Promise<void> {
    const persistedConfig = await this.normalizeConfigForStorage(
      connection.id,
      connection.config
    );
    const json = JSON.stringify({ ...connection, config: persistedConfig });

    const pipeline = this.redis
      .pipeline()
      .set(`connection:${connection.id}`, json)
      .sadd("connections:all", connection.id);

    if (connection.templateAgentId) {
      pipeline.sadd(
        `connections:agent:${connection.templateAgentId}`,
        connection.id
      );
    }

    await pipeline.exec();
  }

  private async normalizeConfigForStorage(
    connectionId: string,
    config: PlatformAdapterConfig
  ): Promise<PlatformAdapterConfig> {
    const normalized = { ...config } as Record<string, unknown>;
    const secretStore = this.services.getSecretStore();

    for (const field of Object.keys(normalized)) {
      const value = normalized[field];
      if (!isSecretField(field) || typeof value !== "string") continue;
      normalized[field] = await persistSecretValue(
        secretStore,
        `connections/${connectionId}/${field}`,
        value
      );
    }

    return normalized as PlatformAdapterConfig;
  }

  private async resolveConfigForRuntime(
    connectionId: string,
    config: PlatformAdapterConfig
  ): Promise<PlatformAdapterConfig> {
    const resolved = { ...config } as Record<string, unknown>;
    const secretStore = this.services.getSecretStore();

    for (const field of Object.keys(resolved)) {
      const value = resolved[field];
      if (!isSecretField(field) || typeof value !== "string") continue;

      if (isSecretRef(value)) {
        const secretValue = await resolveSecretValue(secretStore, value);
        if (secretValue === undefined) {
          throw new Error(
            `Failed to resolve secret ref for connection ${connectionId} field "${field}"`
          );
        }
        resolved[field] = secretValue;
      }
    }

    return resolved as PlatformAdapterConfig;
  }

  /** Return connection with secrets redacted for API responses. */
  private sanitizeConnection(
    connection: PlatformConnection
  ): PlatformConnection {
    const sanitized = {
      ...connection,
      config: { ...connection.config } as any,
    };
    for (const field of Object.keys(sanitized.config)) {
      if (isSecretField(field) && sanitized.config[field]) {
        const val = String(sanitized.config[field]);
        sanitized.config[field] = `***${val.slice(-4)}`;
      }
    }
    return sanitized;
  }

  // ============================================================================
  // Platform adapter methods (used via PlatformRegistry)
  // ============================================================================

  /**
   * Create PlatformAdapter objects for each chat platform.
   * These are lightweight adapters that delegate to this manager.
   */
  createPlatformAdapters(): PlatformAdapter[] {
    return Object.keys(ADAPTER_FACTORIES).map((name) =>
      this.createPlatformAdapter(name)
    );
  }

  private createPlatformAdapter(name: string): PlatformAdapter {
    return {
      name,
      initialize: async () => {
        /* no-op: lifecycle managed by ChatInstanceManager */
      },
      start: async () => {
        /* no-op: lifecycle managed by ChatInstanceManager */
      },
      stop: async () => {
        /* no-op: lifecycle managed by ChatInstanceManager */
      },
      isHealthy: () => true,
      buildDeploymentMetadata: (
        conversationId: string,
        channelId: string,
        platformMetadata: Record<string, any>
      ) => ({
        platform: name,
        channelId,
        conversationId,
        ...(typeof platformMetadata.connectionId === "string"
          ? { connectionId: platformMetadata.connectionId }
          : {}),
      }),
      extractRoutingInfo: (body: Record<string, unknown>) =>
        this.extractPlatformRoutingInfo(name, body),
      sendMessage: (
        _token: string,
        message: string,
        options: {
          agentId: string;
          channelId: string;
          conversationId?: string;
          teamId: string;
          files?: Array<{ buffer: Buffer; filename: string }>;
        }
      ) => this.sendPlatformMessage(name, message, options),
      getConversationHistory: (
        channelId: string,
        conversationId: string | undefined,
        limit: number,
        before: string | undefined
      ) =>
        this.getPlatformConversationHistory(
          name,
          channelId,
          conversationId,
          limit,
          before
        ),
    };
  }

  private extractPlatformRoutingInfo(
    name: string,
    body: Record<string, unknown>
  ): { channelId: string; conversationId?: string; teamId?: string } | null {
    if (name === "slack") {
      const slack = body.slack as
        | { channel?: string; thread?: string; team?: string }
        | undefined;
      if (!slack?.channel) return null;
      return {
        channelId: slack.channel,
        conversationId: slack.thread,
        teamId: slack.team,
      };
    }

    if (name === "telegram") {
      const telegram = body.telegram as
        | { chatId?: string | number }
        | undefined;
      if (!telegram?.chatId) return null;
      return {
        channelId: String(telegram.chatId),
        conversationId: String(telegram.chatId),
      };
    }

    const whatsapp = body.whatsapp as { chat?: string } | undefined;
    if (!whatsapp?.chat) return null;
    return {
      channelId: whatsapp.chat,
      conversationId: whatsapp.chat,
    };
  }

  async sendPlatformMessage(
    name: string,
    message: string,
    options: {
      agentId: string;
      channelId: string;
      conversationId?: string;
      teamId: string;
      files?: Array<{ buffer: Buffer; filename: string }>;
    }
  ): Promise<{
    messageId: string;
    eventsUrl?: string;
    queued?: boolean;
  }> {
    if (options.files?.length) {
      throw new Error(
        `Platform "${name}" does not support file uploads via Chat SDK routing yet`
      );
    }

    const connection = await this.selectConnectionForPlatform(
      name,
      options.channelId,
      options.teamId
    );
    if (!connection) {
      throw new Error(`No active ${name} connection is available`);
    }

    const instance = this.getInstance(connection.id);
    if (!instance) {
      throw new Error(`Connection ${connection.id} is not running`);
    }

    const content =
      name === "slack" ? message : message.replace(/@me\s*/g, "").trim();
    if (!content) {
      throw new Error("Cannot send an empty message");
    }

    const useThread = name === "slack" && !!options.conversationId;

    let sent;
    if (useThread) {
      const adapter = instance.chat.getAdapter?.(connection.platform);
      const createThread = (instance.chat as any).createThread;
      const threadId = `${connection.platform}:${options.channelId}:${options.conversationId}`;
      const thread =
        adapter && typeof createThread === "function"
          ? await createThread.call(instance.chat, adapter, threadId, {}, false)
          : null;
      if (!thread) {
        throw new Error(`Unable to resolve ${name} thread`);
      }
      sent = await thread.post(content);
    } else {
      const channel = instance.chat.channel?.(
        `${connection.platform}:${options.channelId}`
      );
      if (!channel) {
        throw new Error(`Unable to resolve ${name} channel`);
      }
      sent = await channel.post(content);
    }

    return {
      messageId: String(sent?.id || sent?.messageId || sent?.ts || Date.now()),
    };
  }

  async getPlatformConversationHistory(
    name: string,
    channelId: string,
    _conversationId: string | undefined,
    limit: number,
    before: string | undefined
  ): Promise<{
    messages: Array<{
      timestamp: string;
      user: string;
      text: string;
      isBot?: boolean;
    }>;
    nextCursor: string | null;
    hasMore: boolean;
  }> {
    const connection = await this.selectConnectionForPlatform(name, channelId);
    if (!connection) {
      return { messages: [], nextCursor: null, hasMore: false };
    }

    const redis = this.services.getQueue().getRedisClient();
    const key = `chat:history:${connection.id}:${channelId}`;
    const raw = await redis.lrange(key, 0, -1);
    const parsed: HistoryRecord[] = [];
    for (const entry of raw) {
      try {
        parsed.push(JSON.parse(entry) as HistoryRecord);
      } catch (err) {
        logger.warn(
          { key, error: String(err) },
          "Skipping corrupt history entry"
        );
      }
    }
    let entries = parsed;

    if (before) {
      const cutoff = Date.parse(before);
      if (!Number.isNaN(cutoff)) {
        entries = entries.filter(
          (entry: HistoryRecord) => entry.timestamp < cutoff
        );
      }
    }

    const hasMore = entries.length > limit;
    const selected = entries.slice(-limit);
    const nextCursor =
      hasMore && selected[0]
        ? new Date(selected[0].timestamp).toISOString()
        : null;

    return {
      messages: selected.map((entry: HistoryRecord) => ({
        timestamp: new Date(entry.timestamp).toISOString(),
        user:
          entry.authorName ||
          (entry.role === "assistant" ? "assistant" : "user"),
        text: entry.content,
        isBot: entry.role === "assistant",
      })),
      nextCursor,
      hasMore,
    };
  }

  private async selectConnectionForPlatform(
    name: string,
    channelId: string,
    teamId?: string
  ): Promise<PlatformConnection | null> {
    const connections = await this.listConnections({ platform: name });
    const activeConnections = connections.filter((connection) =>
      this.has(connection.id)
    );
    if (activeConnections.length === 0) return null;
    if (activeConnections.length === 1) return activeConnections[0] || null;

    const teamMatch = activeConnections.find(
      (connection) => connection.metadata?.teamId === teamId
    );
    if (teamMatch) return teamMatch;

    const redis = this.services.getQueue().getRedisClient();
    for (const connection of activeConnections) {
      const exists = await redis.exists(
        `chat:history:${connection.id}:${channelId}`
      );
      if (exists === 1) {
        return connection;
      }
    }

    return activeConnections[0] || null;
  }
}
