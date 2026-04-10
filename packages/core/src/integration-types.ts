/**
 * Shared types for the integration system.
 *
 * OAuth credential management for third-party APIs (GitHub, Google, etc.)
 * is handled by Owletto.
 */

import type { ProviderConfigEntry } from "./provider-config-types";

// System Skills Config (config/system-skills.json)

export interface SystemSkillEntry {
  id: string;
  name: string;
  description?: string;
  instructions?: string;
  hidden?: boolean;
  mcpServers?: import("./types").SkillMcpServer[];
  providers?: ProviderConfigEntry[];
  nixPackages?: string[];
  /**
   * Network access the skill requires.
   * When the skill is enabled on an agent, these domains are merged into
   * the agent's `networkConfig.allowedDomains` at load time.
   */
  networkConfig?: {
    allowedDomains?: string[];
    deniedDomains?: string[];
  };
}

export interface SystemSkillsConfigFile {
  skills: SystemSkillEntry[];
}
