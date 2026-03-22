import type { AgentSettings } from "./index";

function cloneSettingValue<T>(value: T): T {
  return structuredClone(value);
}

export function buildDefaultSettingsFromSource(
  source: AgentSettings | null
): Omit<AgentSettings, "updatedAt"> {
  if (!source) return {};

  const defaults: Omit<AgentSettings, "updatedAt"> = {};

  if (source.model !== undefined) defaults.model = source.model;
  if (source.modelSelection)
    defaults.modelSelection = cloneSettingValue(source.modelSelection);
  if (source.providerModelPreferences)
    defaults.providerModelPreferences = cloneSettingValue(
      source.providerModelPreferences
    );
  if (source.networkConfig)
    defaults.networkConfig = cloneSettingValue(source.networkConfig);
  if (source.nixConfig)
    defaults.nixConfig = cloneSettingValue(source.nixConfig);
  if (source.mcpServers)
    defaults.mcpServers = cloneSettingValue(source.mcpServers);
  if (source.soulMd !== undefined) defaults.soulMd = source.soulMd;
  if (source.userMd !== undefined) defaults.userMd = source.userMd;
  if (source.identityMd !== undefined) defaults.identityMd = source.identityMd;
  if (source.skillsConfig)
    defaults.skillsConfig = cloneSettingValue(source.skillsConfig);
  if (source.toolsConfig)
    defaults.toolsConfig = cloneSettingValue(source.toolsConfig);
  if (source.pluginsConfig)
    defaults.pluginsConfig = cloneSettingValue(source.pluginsConfig);
  if (source.installedProviders) {
    defaults.installedProviders = cloneSettingValue(source.installedProviders);
  }
  if (source.skillRegistries) {
    defaults.skillRegistries = cloneSettingValue(source.skillRegistries);
  }
  if (source.verboseLogging !== undefined) {
    defaults.verboseLogging = source.verboseLogging;
  }

  return defaults;
}

export function buildPromotedSettingsFromSource(
  source: AgentSettings | null
): Partial<Omit<AgentSettings, "updatedAt">> {
  return {
    model: source?.model,
    modelSelection: source?.modelSelection
      ? cloneSettingValue(source.modelSelection)
      : undefined,
    providerModelPreferences: source?.providerModelPreferences
      ? cloneSettingValue(source.providerModelPreferences)
      : undefined,
    networkConfig: source?.networkConfig
      ? cloneSettingValue(source.networkConfig)
      : undefined,
    nixConfig: source?.nixConfig
      ? cloneSettingValue(source.nixConfig)
      : undefined,
    mcpServers: source?.mcpServers ? cloneSettingValue(source.mcpServers) : {},
    soulMd: source?.soulMd,
    userMd: source?.userMd,
    identityMd: source?.identityMd,
    skillsConfig: source?.skillsConfig
      ? cloneSettingValue(source.skillsConfig)
      : undefined,
    toolsConfig: source?.toolsConfig
      ? cloneSettingValue(source.toolsConfig)
      : undefined,
    pluginsConfig: source?.pluginsConfig
      ? cloneSettingValue(source.pluginsConfig)
      : undefined,
    installedProviders: cloneSettingValue(source?.installedProviders || []),
    skillRegistries: cloneSettingValue(source?.skillRegistries || []),
    verboseLogging: source?.verboseLogging,
  };
}
