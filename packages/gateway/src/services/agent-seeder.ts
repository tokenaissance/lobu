import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createLogger,
  type InstalledProvider,
  type SkillConfig,
} from "@lobu/core";
import type { AgentMetadataStore } from "../auth/agent-metadata-store";
import type {
  AgentSettings,
  AgentSettingsStore,
} from "../auth/settings/agent-settings-store";
import type { AuthProfilesManager } from "../auth/settings/auth-profiles-manager";
import { buildPromotedSettingsFromSource } from "../auth/settings/template-utils";

const logger = createLogger("agent-seeder");

// NOTE: Keep in sync with packages/cli/src/config/agents-manifest.ts
interface ManifestSkill {
  repo: string;
  name: string;
  description?: string;
  content: string;
  enabled: boolean;
  system?: boolean;
  integrations?: SkillConfig["integrations"];
  mcpServers?: SkillConfig["mcpServers"];
  nixPackages?: SkillConfig["nixPackages"];
  permissions?: SkillConfig["permissions"];
  providers?: SkillConfig["providers"];
  modelPreference?: SkillConfig["modelPreference"];
  thinkingLevel?: SkillConfig["thinkingLevel"];
}

interface AgentManifestEntry {
  agentId: string;
  name: string;
  description?: string;
  settings: {
    identityMd?: string;
    soulMd?: string;
    userMd?: string;
    installedProviders?: Array<{
      providerId: string;
    }>;
    modelSelection?: AgentSettings["modelSelection"];
    providerModelPreferences?: AgentSettings["providerModelPreferences"];
    nixConfig?: AgentSettings["nixConfig"];
    skillsConfig?: {
      skills: ManifestSkill[];
    };
    networkConfig?: {
      allowedDomains?: string[];
      deniedDomains?: string[];
    };
    mcpServers?: Record<
      string,
      {
        url?: string;
        command?: string;
        args?: string[];
        env?: Record<string, string>;
        headers?: Record<string, string>;
        oauth?: {
          authUrl: string;
          tokenUrl: string;
          clientId?: string;
          clientSecret?: string;
          scopes?: string[];
          tokenEndpointAuthMethod?: string;
        };
      }
    >;
  };
  credentials?: Array<{
    providerId: string;
    key: string;
  }>;
  connections?: Array<{
    type: string;
    config: Record<string, string>;
  }>;
}

interface AgentsManifest {
  version: number;
  agents: AgentManifestEntry[];
}

/**
 * Reconcile agents from .lobu/agents.json on gateway startup.
 *
 * For each agent in the manifest:
 * - Creates metadata if it doesn't exist
 * - Updates manifest-managed fields in settings while preserving runtime-only state
 *
 * Silent no-op when the file doesn't exist.
 */
export async function seedAgentsFromManifest(
  agentSettingsStore: AgentSettingsStore,
  agentMetadataStore: AgentMetadataStore,
  authProfilesManager?: AuthProfilesManager
): Promise<void> {
  const manifestPath = resolve(process.cwd(), ".lobu/agents.json");

  let raw: string;
  try {
    raw = readFileSync(manifestPath, "utf-8");
  } catch {
    // File doesn't exist — not a CLI-managed project, skip silently
    return;
  }

  let manifest: AgentsManifest;
  try {
    manifest = JSON.parse(raw);
  } catch (err) {
    logger.warn("Failed to parse agents.json", {
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  if (!manifest.agents || manifest.agents.length === 0) {
    return;
  }

  logger.debug(`Seeding ${manifest.agents.length} agent(s) from manifest`);

  for (const entry of manifest.agents) {
    try {
      const existingMetadata = await agentMetadataStore.getMetadata(
        entry.agentId
      );
      if (!existingMetadata) {
        await agentMetadataStore.createAgent(
          entry.agentId,
          entry.name,
          "system",
          "manifest",
          { description: entry.description }
        );
        logger.debug(`Created metadata for agent "${entry.agentId}"`);
      } else if (
        existingMetadata.name !== entry.name ||
        existingMetadata.description !== entry.description
      ) {
        await agentMetadataStore.updateMetadata(entry.agentId, {
          name: entry.name,
          description: entry.description,
        });
        logger.debug(`Updated metadata for agent "${entry.agentId}"`);
      }

      const existingSettings = await agentSettingsStore.getSettings(
        entry.agentId
      );
      const nextSettings = buildReconciledSettings(entry, existingSettings);

      const settingsChanged = settingsDiffer(existingSettings, nextSettings);
      if (settingsChanged) {
        await agentSettingsStore.saveSettings(entry.agentId, nextSettings);
        logger.debug(`Reconciled settings for agent "${entry.agentId}"`);
      } else {
        logger.debug(
          `Settings already match manifest for agent "${entry.agentId}"`
        );
      }

      // Propagate manifest-managed fields to sandbox agents cloned from this template
      const effectiveSettings = settingsChanged
        ? nextSettings
        : existingSettings;
      if (effectiveSettings) {
        await propagateToSandboxAgents(
          agentSettingsStore,
          entry.agentId,
          effectiveSettings
        );
      }

      // Seed provider credentials as auth profiles
      if (authProfilesManager && entry.credentials?.length) {
        for (const cred of entry.credentials) {
          await authProfilesManager.upsertProfile({
            agentId: entry.agentId,
            provider: cred.providerId,
            credential: cred.key,
            authType: "api-key",
            label: `${cred.providerId} (from lobu.toml)`,
            makePrimary: true,
          });
        }
        logger.debug(
          `Seeded ${entry.credentials.length} credential(s) for agent "${entry.agentId}"`
        );
      }
    } catch (err) {
      logger.error(`Failed to seed agent "${entry.agentId}"`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/**
 * Seed connections from the manifest after ChatInstanceManager is ready.
 * Skips connections that already exist for the agent on the same platform.
 */
export async function seedConnectionsFromManifest(chatInstanceManager: {
  listConnections(filter?: {
    platform?: string;
    templateAgentId?: string;
  }): Promise<Array<{ platform: string; templateAgentId?: string }>>;
  addConnection(
    platform: string,
    templateAgentId: string | undefined,
    config: any,
    settings?: { allowGroups?: boolean }
  ): Promise<unknown>;
}): Promise<void> {
  const manifestPath = resolve(process.cwd(), ".lobu/agents.json");

  let raw: string;
  try {
    raw = readFileSync(manifestPath, "utf-8");
  } catch {
    return;
  }

  let manifest: AgentsManifest;
  try {
    manifest = JSON.parse(raw);
  } catch {
    return;
  }

  if (!manifest.agents) return;

  for (const entry of manifest.agents) {
    if (!entry.connections?.length) continue;

    for (const conn of entry.connections) {
      // Skip if a connection already exists for this agent + platform
      const existing = await chatInstanceManager.listConnections({
        platform: conn.type,
        templateAgentId: entry.agentId,
      });
      if (existing.length > 0) continue;

      try {
        await chatInstanceManager.addConnection(
          conn.type,
          entry.agentId,
          { platform: conn.type, ...conn.config },
          { allowGroups: true }
        );
        logger.debug(
          `Created ${conn.type} connection for agent "${entry.agentId}"`
        );
      } catch (err) {
        logger.error(
          `Failed to create ${conn.type} connection for agent "${entry.agentId}"`,
          { error: err instanceof Error ? err.message : String(err) }
        );
      }
    }
  }
}

/**
 * Propagate manifest-managed fields to sandbox agents cloned from a template.
 * Preserves sandbox-specific state (authProfiles, agentIntegrations, etc.).
 */
async function propagateToSandboxAgents(
  agentSettingsStore: AgentSettingsStore,
  templateAgentId: string,
  templateSettings: Omit<AgentSettings, "updatedAt">
): Promise<void> {
  try {
    const sandboxIds =
      await agentSettingsStore.findSandboxAgentIds(templateAgentId);
    if (sandboxIds.length === 0) return;

    const promoted = buildPromotedSettingsFromSource(
      templateSettings as AgentSettings
    );

    let propagatedCount = 0;
    for (const sandboxId of sandboxIds) {
      try {
        const existing = await agentSettingsStore.getSettings(sandboxId);
        if (!existing) continue;

        const updated: Omit<AgentSettings, "updatedAt"> = {
          ...existing,
          ...promoted,
          templateAgentId,
        };

        if (!settingsDiffer(existing, updated)) continue;

        await agentSettingsStore.saveSettings(sandboxId, updated);
        propagatedCount++;
        logger.debug(`Propagated template settings to sandbox "${sandboxId}"`);
      } catch (err) {
        logger.warn(`Failed to propagate settings to sandbox "${sandboxId}"`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (propagatedCount > 0) {
      logger.debug(
        `Propagated settings to ${propagatedCount}/${sandboxIds.length} sandbox(es) of "${templateAgentId}"`
      );
    }
  } catch (err) {
    logger.warn(
      `Failed to find sandbox agents for template "${templateAgentId}"`,
      { error: err instanceof Error ? err.message : String(err) }
    );
  }
}

function buildReconciledSettings(
  entry: AgentManifestEntry,
  existing: AgentSettings | null
): Omit<AgentSettings, "updatedAt"> {
  const { updatedAt, ...base } = existing || {};
  const installedProviders = buildInstalledProviders(
    entry.settings.installedProviders,
    existing?.installedProviders
  );
  const skillsConfig = buildSkillsConfig(
    entry.settings.skillsConfig?.skills,
    existing?.skillsConfig?.skills
  );
  const modelSelection = entry.settings.modelSelection;

  return {
    ...base,
    model:
      modelSelection?.mode === "pinned"
        ? modelSelection.pinnedModel
        : undefined,
    modelSelection,
    providerModelPreferences: entry.settings.providerModelPreferences,
    identityMd: entry.settings.identityMd,
    soulMd: entry.settings.soulMd,
    userMd: entry.settings.userMd,
    installedProviders,
    skillsConfig,
    networkConfig: entry.settings.networkConfig,
    nixConfig: entry.settings.nixConfig,
    mcpServers: entry.settings.mcpServers,
  };
}

function buildInstalledProviders(
  manifestProviders: AgentManifestEntry["settings"]["installedProviders"],
  existingProviders: AgentSettings["installedProviders"]
): InstalledProvider[] | undefined {
  if (!manifestProviders) {
    return undefined;
  }

  const manifestIds = new Set(manifestProviders.map((p) => p.providerId));

  const merged: InstalledProvider[] = manifestProviders.map(
    (provider, index) => {
      const existing = existingProviders?.find(
        (candidate) => candidate.providerId === provider.providerId
      );
      return {
        providerId: provider.providerId,
        installedAt: existing?.installedAt ?? Date.now() + index,
        ...(existing?.config ? { config: existing.config } : {}),
      };
    }
  );

  // Preserve providers added via the API that aren't in the manifest
  if (existingProviders) {
    for (const existing of existingProviders) {
      if (!manifestIds.has(existing.providerId)) {
        merged.push(existing);
      }
    }
  }

  return merged;
}

function buildSkillsConfig(
  manifestSkills: ManifestSkill[] | undefined,
  existingSkills: SkillConfig[] | undefined
): AgentSettings["skillsConfig"] {
  if (!manifestSkills) {
    return undefined;
  }

  return {
    skills: manifestSkills.map((skill): SkillConfig => {
      const existing = existingSkills?.find(
        (candidate) =>
          candidate.repo === skill.repo || candidate.name === skill.name
      );
      const contentFetchedAt =
        existing?.content === skill.content && existing.contentFetchedAt
          ? existing.contentFetchedAt
          : skill.content
            ? Date.now()
            : existing?.contentFetchedAt;

      return {
        repo: skill.repo,
        name: skill.name,
        description: skill.description,
        enabled: skill.enabled,
        system: skill.system,
        content: skill.content || undefined,
        contentFetchedAt,
        integrations: skill.integrations,
        mcpServers: skill.mcpServers,
        nixPackages: skill.nixPackages,
        permissions: skill.permissions,
        providers: skill.providers,
        modelPreference: skill.modelPreference,
        thinkingLevel: skill.thinkingLevel,
      };
    }),
  };
}

function settingsDiffer(
  existing: AgentSettings | null,
  next: Omit<AgentSettings, "updatedAt">
): boolean {
  if (!existing) {
    return true;
  }

  const { updatedAt, ...current } = existing;
  return stableStringify(current) !== stableStringify(next);
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortValue(entry));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortValue(entry)])
    );
  }

  return value;
}
