import { type AuthProfile, createLogger } from "@lobu/core";
import type { WritableSecretStore } from "../../secrets";
import type {
  AgentSettingsStore,
  EphemeralAuthProfileRegistry,
} from "./agent-settings-store";

const logger = createLogger("auth-profiles-manager");

const ANY_MODEL_SCOPE = "*";

export interface UpsertAuthProfileInput {
  agentId: string;
  provider: string;
  credential?: string;
  credentialRef?: string;
  authType: AuthProfile["authType"];
  label: string;
  model?: string;
  metadata?: AuthProfile["metadata"];
  makePrimary?: boolean;
  id?: string;
}

export class AuthProfilesManager {
  /**
   * Ephemeral profile registry is owned by `AgentSettingsStore` so that
   * every `AuthProfilesManager` built against the same store (including
   * the ones each provider module constructs internally) shares the same
   * ephemeral view. Without this, a `provider.key` seeded on the central
   * manager would be invisible to provider modules' own managers.
   */
  private readonly ephemeralProfiles: EphemeralAuthProfileRegistry;

  constructor(
    private readonly agentSettingsStore: AgentSettingsStore,
    private readonly secretStore: WritableSecretStore
  ) {
    this.ephemeralProfiles = agentSettingsStore.getEphemeralAuthProfiles();
  }

  async listProfiles(agentId: string): Promise<AuthProfile[]> {
    const settings =
      await this.agentSettingsStore.getEffectiveSettings(agentId);

    // Persistent profiles take precedence over ephemeral on (provider, model)
    // collision, so the two halves are merged with the persistent set first.
    const merged = this.dedupeByScope([
      ...(settings?.authProfiles || []),
      ...(this.ephemeralProfiles.get(agentId) || []),
    ]);
    const profiles = this.normalizeProfiles(merged);

    const resolved = await Promise.all(
      profiles.map(async (profile) => {
        try {
          return await this.resolveProfile(profile);
        } catch (error) {
          logger.warn(
            {
              agentId,
              profileId: profile.id,
              provider: profile.provider,
              error: error instanceof Error ? error.message : String(error),
            },
            "Dropping auth profile with unresolvable secret ref"
          );
          return null;
        }
      })
    );

    return resolved.filter((p): p is AuthProfile => p !== null);
  }

  async hasProviderProfiles(
    agentId: string,
    provider: string
  ): Promise<boolean> {
    const profiles = await this.listProfiles(agentId);
    return profiles.some((profile) => profile.provider === provider);
  }

  async getProviderProfiles(
    agentId: string,
    provider: string
  ): Promise<AuthProfile[]> {
    const profiles = await this.listProfiles(agentId);
    return profiles.filter((profile) => profile.provider === provider);
  }

  async getBestProfile(
    agentId: string,
    provider: string,
    model?: string
  ): Promise<AuthProfile | null> {
    const providerProfiles = await this.getProviderProfiles(agentId, provider);
    if (providerProfiles.length === 0) {
      return null;
    }

    const now = Date.now();
    const validProfiles = providerProfiles.filter((profile) => {
      const expiresAt = profile.metadata?.expiresAt;
      return !expiresAt || expiresAt > now;
    });

    if (validProfiles.length === 0) {
      logger.warn(
        { agentId, provider, profileCount: providerProfiles.length },
        "All auth profiles for provider are expired"
      );
      return null;
    }

    const candidates = validProfiles;
    if (!model) {
      return candidates[0] || null;
    }

    const exact = candidates.find((profile) => profile.model === model);
    if (exact) return exact;

    const wildcard = candidates.find(
      (profile) => profile.model === ANY_MODEL_SCOPE
    );
    return wildcard || candidates[0] || null;
  }

  async upsertProfile(input: UpsertAuthProfileInput): Promise<AuthProfile> {
    const settings = await this.agentSettingsStore.getSettings(input.agentId);
    const current = this.normalizeProfiles(settings?.authProfiles);
    const modelScope = input.model?.trim() || ANY_MODEL_SCOPE;

    const nextProfile: AuthProfile = {
      id: input.id || crypto.randomUUID(),
      provider: input.provider,
      ...(input.credential ? { credential: input.credential } : {}),
      ...(input.credentialRef ? { credentialRef: input.credentialRef } : {}),
      authType: input.authType,
      label: input.label,
      model: modelScope,
      metadata: input.metadata,
      createdAt: Date.now(),
    };

    let replaced = false;
    const withoutExisting = current.filter((profile) => {
      if (input.id && profile.id === input.id) {
        replaced = true;
        nextProfile.createdAt = profile.createdAt;
        return false;
      }
      return true;
    });

    if (!input.id) {
      const existingPrimary = withoutExisting.find(
        (profile) =>
          profile.provider === input.provider && profile.model === modelScope
      );
      if (existingPrimary) {
        replaced = true;
        nextProfile.createdAt = existingPrimary.createdAt;
      }
    }

    const withoutSameScope = withoutExisting.filter(
      (profile) =>
        !(
          profile.provider === input.provider &&
          profile.model === modelScope &&
          (!input.id || profile.id !== input.id)
        )
    );

    const nextProfiles: AuthProfile[] = [];
    const providerProfiles: AuthProfile[] = [];
    const otherProfiles: AuthProfile[] = [];

    for (const profile of withoutSameScope) {
      if (profile.provider === input.provider) {
        providerProfiles.push(profile);
      } else {
        otherProfiles.push(profile);
      }
    }

    if (input.makePrimary !== false) {
      nextProfiles.push(nextProfile, ...providerProfiles, ...otherProfiles);
    } else {
      nextProfiles.push(...providerProfiles, nextProfile, ...otherProfiles);
    }

    await this.agentSettingsStore.updateSettings(input.agentId, {
      authProfiles: nextProfiles,
    });

    logger.info(
      {
        agentId: input.agentId,
        provider: input.provider,
        profileId: nextProfile.id,
        replaced,
      },
      "Saved auth profile"
    );

    return nextProfile;
  }

  registerEphemeralProfile(input: UpsertAuthProfileInput): AuthProfile {
    const modelScope = input.model?.trim() || ANY_MODEL_SCOPE;
    const nextProfile: AuthProfile = {
      id: input.id || crypto.randomUUID(),
      provider: input.provider,
      ...(input.credential ? { credential: input.credential } : {}),
      ...(input.credentialRef ? { credentialRef: input.credentialRef } : {}),
      authType: input.authType,
      label: input.label,
      model: modelScope,
      metadata: input.metadata,
      createdAt: Date.now(),
    };

    const current = this.ephemeralProfiles.get(input.agentId) || [];
    const withoutSameScope = current.filter(
      (profile) =>
        !(
          profile.provider === input.provider &&
          profile.model === modelScope &&
          (!input.id || profile.id !== input.id)
        )
    );

    const providerProfiles: AuthProfile[] = [];
    const otherProfiles: AuthProfile[] = [];
    for (const profile of withoutSameScope) {
      if (profile.provider === input.provider) {
        providerProfiles.push(profile);
      } else {
        otherProfiles.push(profile);
      }
    }

    const nextProfiles =
      input.makePrimary !== false
        ? [nextProfile, ...providerProfiles, ...otherProfiles]
        : [...providerProfiles, nextProfile, ...otherProfiles];

    this.ephemeralProfiles.set(input.agentId, nextProfiles);
    return nextProfile;
  }

  async deleteProviderProfiles(
    agentId: string,
    provider: string,
    profileId?: string
  ): Promise<void> {
    const settings = await this.agentSettingsStore.getSettings(agentId);
    const current = this.normalizeProfiles(settings?.authProfiles);

    // Collect profiles that are actually being removed so we can clean up
    // their secrets from the secret store before updating settings.
    const removed = current.filter((profile) => {
      if (profile.provider !== provider) return false;
      if (profileId && profile.id !== profileId) return false;
      return true;
    });
    const filtered = current.filter((profile) => !removed.includes(profile));

    await this.agentSettingsStore.updateSettings(agentId, {
      authProfiles: filtered,
    });

    // Delete orphaned secrets for each removed profile. Both kinds
    // (credential + refresh-token) use the deterministic name built by
    // AgentSettingsStore, so we can reconstruct the names here.
    let secretsDeleted = 0;
    for (const profile of removed) {
      for (const kind of ["credential", "refresh-token"] as const) {
        const name = `agents/${agentId}/auth-profiles/${profile.id}/${kind}`;
        try {
          await this.secretStore.delete(name);
          secretsDeleted += 1;
        } catch (error) {
          logger.warn(
            {
              agentId,
              profileId: profile.id,
              kind,
              error: error instanceof Error ? error.message : String(error),
            },
            "Failed to delete auth profile secret"
          );
        }
      }
    }

    const ephemeral = this.ephemeralProfiles.get(agentId);
    if (ephemeral) {
      const filteredEphemeral = ephemeral.filter((profile) => {
        if (profile.provider !== provider) return true;
        if (!profileId) return false;
        return profile.id !== profileId;
      });
      if (filteredEphemeral.length > 0) {
        this.ephemeralProfiles.set(agentId, filteredEphemeral);
      } else {
        this.ephemeralProfiles.delete(agentId);
      }
    }

    logger.info(
      {
        agentId,
        provider,
        profileId: profileId || "all",
        removedCount: removed.length,
        secretsDeleted,
      },
      "Deleted auth profiles"
    );
  }

  private normalizeProfiles(
    profiles: AuthProfile[] | undefined
  ): AuthProfile[] {
    if (!Array.isArray(profiles)) return [];
    return profiles.filter(
      (profile) =>
        typeof profile?.id === "string" &&
        typeof profile?.provider === "string" &&
        (typeof profile?.credential === "string" ||
          typeof profile?.credentialRef === "string") &&
        typeof profile?.authType === "string"
    );
  }

  /**
   * Merge persistent + ephemeral profile lists, preferring whichever came
   * first in the input when two profiles cover the same (provider, model)
   * scope. Callers pass persistent profiles before ephemeral ones so
   * persistent always wins the scope on collision.
   */
  private dedupeByScope(profiles: AuthProfile[]): AuthProfile[] {
    const seenScopes = new Set<string>();
    const seenIds = new Set<string>();
    const result: AuthProfile[] = [];
    for (const profile of profiles) {
      if (seenIds.has(profile.id)) continue;
      const scope = `${profile.provider}:${profile.model ?? ANY_MODEL_SCOPE}`;
      if (seenScopes.has(scope)) continue;
      seenScopes.add(scope);
      seenIds.add(profile.id);
      result.push(profile);
    }
    return result;
  }

  private async resolveProfile(profile: AuthProfile): Promise<AuthProfile> {
    let credential = profile.credential;
    let credentialResolvedFromRef = false;
    if (!credential && profile.credentialRef) {
      const resolved = await this.secretStore.get(profile.credentialRef);
      if (!resolved) {
        throw new Error(
          `Unresolved credential secret ref: ${profile.credentialRef}`
        );
      }
      credential = resolved;
      credentialResolvedFromRef = true;
    }

    let refreshToken = profile.metadata?.refreshToken;
    let refreshTokenResolvedFromRef = false;
    if (!refreshToken && profile.metadata?.refreshTokenRef) {
      const resolved = await this.secretStore.get(
        profile.metadata.refreshTokenRef
      );
      if (!resolved) {
        throw new Error(
          `Unresolved refreshToken secret ref: ${profile.metadata.refreshTokenRef}`
        );
      }
      refreshToken = resolved;
      refreshTokenResolvedFromRef = true;
    }

    // Maintain the AuthProfile invariant: exactly one of credential / credentialRef
    // (and the same for refreshToken / refreshTokenRef). When we inline the
    // resolved plaintext, drop the ref so downstream code can't see both.
    const next: AuthProfile = { ...profile };
    if (credentialResolvedFromRef) {
      next.credential = credential;
      delete next.credentialRef;
    } else if (credential) {
      next.credential = credential;
    }

    if (profile.metadata) {
      const metadata = { ...profile.metadata };
      if (refreshTokenResolvedFromRef) {
        metadata.refreshToken = refreshToken;
        delete metadata.refreshTokenRef;
      } else if (refreshToken) {
        metadata.refreshToken = refreshToken;
      }
      next.metadata = metadata;
    }

    return next;
  }
}

export function createAuthProfileLabel(
  providerDisplayName: string,
  credential: string,
  accountHint?: string
): string {
  if (accountHint?.trim()) {
    return accountHint.trim();
  }

  const trimmed = credential.trim();
  if (trimmed.length <= 8) {
    return `${providerDisplayName} key`;
  }

  return `${providerDisplayName} ${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}
