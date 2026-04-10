import {
  type AgentSettings,
  type AuthProfile,
  BaseRedisStore,
  safeJsonParse,
  safeJsonStringify,
} from "@lobu/core";
import type Redis from "ioredis";
import { deleteSecretsByPrefix, type WritableSecretStore } from "../../secrets";

// Re-export so existing imports from this module keep working.
export type { AgentSettings };

export interface AgentSettingsContext {
  localSettings: AgentSettings | null;
  effectiveSettings: AgentSettings | null;
  templateAgentId?: string;
}

/**
 * Shared in-memory ephemeral auth profile registry. Lives on
 * AgentSettingsStore because it's the single shared instance every
 * `AuthProfilesManager` (including the ones each provider module constructs)
 * is built against. Storing the map here keeps all managers in sync — a
 * must-have for SDK-embedded use where `provider.key` seeds a credential on
 * the central manager and a provider module later asks "does this agent have
 * credentials?".
 */
export class EphemeralAuthProfileRegistry {
  private readonly profiles = new Map<string, AuthProfile[]>();

  get(agentId: string): AuthProfile[] | undefined {
    return this.profiles.get(agentId);
  }

  set(agentId: string, profiles: AuthProfile[]): void {
    this.profiles.set(agentId, profiles);
  }

  delete(agentId: string): void {
    this.profiles.delete(agentId);
  }
}

/**
 * Store and retrieve agent settings from Redis
 * Pattern: agent:settings:{agentId}
 *
 * Sensitive values (auth profile credentials and refresh tokens) are never
 * persisted inline. They are written to the secret store on save and the
 * stored JSON only holds the resulting `credentialRef` / `refreshTokenRef`.
 */
export class AgentSettingsStore extends BaseRedisStore<AgentSettings> {
  private readonly ephemeralAuthProfiles = new EphemeralAuthProfileRegistry();

  constructor(
    redis: Redis,
    private readonly secretStore: WritableSecretStore
  ) {
    super({
      redis,
      keyPrefix: "agent:settings",
      loggerName: "agent-settings-store",
    });
  }

  getSecretStore(): WritableSecretStore {
    return this.secretStore;
  }

  getEphemeralAuthProfiles(): EphemeralAuthProfileRegistry {
    return this.ephemeralAuthProfiles;
  }

  /**
   * Get raw settings for an agent. Sensitive values are returned as refs;
   * callers that need plaintext must resolve them through the secret store
   * (e.g., via AuthProfilesManager.listProfiles).
   */
  async getSettings(agentId: string): Promise<AgentSettings | null> {
    const key = this.buildKey(agentId);
    try {
      const data = await this.redis.get(key);
      if (!data) return null;

      const parsed = safeJsonParse<AgentSettings>(data);
      if (!parsed) {
        this.logger.warn("Failed to parse agent settings from Redis", { key });
        return null;
      }
      return parsed;
    } catch (error) {
      this.logger.error("Failed to get settings from Redis", {
        error: error instanceof Error ? error.message : String(error),
        key,
      });
      return null;
    }
  }

  /**
   * Get effective settings for an agent, with template agent fallback.
   * For sandbox agents, inherits from the template agent when own settings
   * are missing or have no providers configured.
   */
  async getEffectiveSettings(agentId: string): Promise<AgentSettings | null> {
    const context = await this.getSettingsContext(agentId);
    return context.effectiveSettings;
  }

  async getSettingsContext(agentId: string): Promise<AgentSettingsContext> {
    const localSettings = await this.getSettings(agentId);

    const templateAgentId = await this.resolveTemplateAgentId(
      agentId,
      localSettings
    );
    if (!templateAgentId) {
      return { localSettings, effectiveSettings: localSettings };
    }

    const templateSettings = await this.getSettings(templateAgentId);
    if (!templateSettings) {
      return {
        localSettings,
        effectiveSettings: localSettings,
        templateAgentId,
      };
    }

    if (!localSettings) {
      return {
        localSettings,
        effectiveSettings: { ...templateSettings, templateAgentId },
        templateAgentId,
      };
    }

    return {
      localSettings,
      effectiveSettings: {
        ...templateSettings,
        ...Object.fromEntries(
          Object.entries(localSettings).filter(([, v]) => v !== undefined)
        ),
        templateAgentId,
      } as AgentSettings,
      templateAgentId,
    };
  }

  /**
   * Resolve the template agent ID for a sandbox agent.
   * Chain: settings.templateAgentId → metadata.parentConnectionId → connection.templateAgentId
   */
  private async resolveTemplateAgentId(
    agentId: string,
    settings: AgentSettings | null
  ): Promise<string | undefined> {
    if (settings?.templateAgentId) return settings.templateAgentId;

    try {
      const metaRaw = await this.redis.get(`agent_metadata:${agentId}`);
      if (!metaRaw) return undefined;
      const meta = safeJsonParse<{ parentConnectionId?: string }>(metaRaw);
      if (!meta?.parentConnectionId) return undefined;

      const connRaw = await this.redis.get(
        `connection:${meta.parentConnectionId}`
      );
      if (!connRaw) return undefined;
      const conn = safeJsonParse<{ templateAgentId?: string }>(connRaw);
      return conn?.templateAgentId;
    } catch {
      return undefined;
    }
  }

  /**
   * Save settings for an agent. Any plaintext credential/refreshToken on
   * authProfiles is moved into the secret store and replaced with a ref.
   */
  async saveSettings(
    agentId: string,
    settings: Omit<AgentSettings, "updatedAt">
  ): Promise<void> {
    const key = this.buildKey(agentId);
    const fullSettings = await this.persistAuthProfileSecrets(agentId, {
      ...settings,
      updatedAt: Date.now(),
    });
    await this.set(key, fullSettings);
    this.logger.info(`Saved settings for agent ${agentId}`);
  }

  /**
   * Update specific settings fields (partial update). Existing secret refs
   * are preserved.
   */
  async updateSettings(
    agentId: string,
    updates: Partial<Omit<AgentSettings, "updatedAt">>
  ): Promise<void> {
    const existing = await this.getSettings(agentId);
    const merged = await this.persistAuthProfileSecrets(agentId, {
      ...existing,
      ...updates,
      updatedAt: Date.now(),
    });
    const key = this.buildKey(agentId);
    await this.set(key, merged);
    this.logger.info(`Updated settings for agent ${agentId}`);
  }

  async deleteSettings(agentId: string): Promise<void> {
    const key = this.buildKey(agentId);

    // Cascade-delete every secret owned by this agent's auth profiles.
    // Using a prefix sweep catches credentials and refresh tokens for all
    // profile IDs without requiring us to re-read + parse the JSON.
    const secretsDeleted = await deleteSecretsByPrefix(
      this.secretStore,
      `agents/${agentId}/auth-profiles/`
    );

    // Drop ephemeral profiles too so a subsequent getProfiles doesn't
    // surface stale in-memory entries after the agent is torn down.
    this.ephemeralAuthProfiles.delete(agentId);

    await this.delete(key);
    this.logger.info(
      `Deleted settings for agent ${agentId} (cascade-deleted ${secretsDeleted} secret(s))`
    );
  }

  /**
   * Find all sandbox agent IDs that reference a given template agent.
   */
  async findSandboxAgentIds(templateAgentId: string): Promise<string[]> {
    const prefix = `${this.keyPrefix}:`;
    const keys = await this.scanByPrefix(prefix);
    const sandboxIds: string[] = [];

    for (const key of keys) {
      try {
        const raw = await this.redis.get(key);
        if (!raw) continue;
        const parsed = safeJsonParse<AgentSettings>(raw);
        if (parsed?.templateAgentId === templateAgentId) {
          sandboxIds.push(key.slice(prefix.length));
        }
      } catch {
        // Skip unparseable entries
      }
    }

    return sandboxIds;
  }

  async hasSettings(agentId: string): Promise<boolean> {
    const key = this.buildKey(agentId);
    return this.exists(key);
  }

  /**
   * Find the first agent that has installed providers configured.
   * Used to find a template for ephemeral agents.
   */
  async findTemplateAgentId(): Promise<string | null> {
    const prefix = `${this.keyPrefix}:`;
    const keys = await this.scanByPrefix(prefix);
    for (const key of keys) {
      try {
        const data = await this.redis.get(key);
        if (!data) continue;
        const parsed = safeJsonParse<AgentSettings>(data);
        if (
          parsed?.installedProviders &&
          parsed.installedProviders.length > 0
        ) {
          return key.slice(prefix.length);
        }
      } catch {
        /* skip unparseable key */
      }
    }
    return null;
  }

  protected override serialize(value: AgentSettings): string {
    const json = safeJsonStringify(value);
    if (json === null) {
      throw new Error("Failed to serialize value to JSON");
    }
    return json;
  }

  /**
   * Walk authProfiles, move any plaintext credential or refreshToken into the
   * secret store, and replace them with credentialRef / refreshTokenRef.
   */
  private async persistAuthProfileSecrets(
    agentId: string,
    settings: AgentSettings
  ): Promise<AgentSettings> {
    if (
      !Array.isArray(settings.authProfiles) ||
      settings.authProfiles.length === 0
    ) {
      return settings;
    }

    const authProfiles = await Promise.all(
      settings.authProfiles.map((profile) =>
        this.persistProfileSecrets(agentId, profile)
      )
    );

    return { ...settings, authProfiles };
  }

  private async persistProfileSecrets(
    agentId: string,
    profile: AuthProfile
  ): Promise<AuthProfile> {
    const next: AuthProfile = { ...profile };
    const metadata = profile.metadata ? { ...profile.metadata } : undefined;

    // Always rewrite plaintext into the secret store when it's present —
    // even if a ref already exists. Callers like TokenRefreshJob update
    // profiles with a freshly-rotated refresh token on top of the existing
    // ref, and we must not drop it on the floor. `secretStore.put` uses a
    // deterministic secret name so the returned ref is stable.
    if (profile.credential) {
      next.credentialRef = await this.secretStore.put(
        this.buildAuthProfileSecretName(agentId, profile, "credential"),
        profile.credential
      );
    }
    delete next.credential;

    if (metadata) {
      if (metadata.refreshToken) {
        metadata.refreshTokenRef = await this.secretStore.put(
          this.buildAuthProfileSecretName(agentId, profile, "refresh-token"),
          metadata.refreshToken
        );
      }
      delete metadata.refreshToken;
      next.metadata = metadata;
    }

    return next;
  }

  private buildAuthProfileSecretName(
    agentId: string,
    profile: AuthProfile,
    kind: "credential" | "refresh-token"
  ): string {
    return `agents/${agentId}/auth-profiles/${profile.id}/${kind}`;
  }
}
