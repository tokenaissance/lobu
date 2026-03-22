/**
 * Shared types for the integration system.
 *
 * OAuth credential management for third-party APIs (GitHub, Google, etc.)
 * is handled by Owletto. Types here support MCP server OAuth configs
 * and API-key integrations created by agents at runtime.
 */

import type { ProviderConfigEntry } from "./provider-config-types";

export interface IntegrationOAuthConfig {
  authUrl: string;
  tokenUrl: string;
  clientId?: string;
  clientSecret?: string;
  incrementalAuth?: boolean;
  tokenEndpointAuthMethod?: string;
  extraAuthParams?: Record<string, string>;
}

export interface IntegrationApiKeyConfig {
  headerName: string;
  headerTemplate: string;
}

export type IntegrationAuthType = "oauth" | "api-key";

export interface IntegrationScopesConfig {
  default: string[];
  available: string[];
}

export interface IntegrationConfig {
  label?: string;
  authType?: IntegrationAuthType;
  oauth?: IntegrationOAuthConfig;
  apiKey?: IntegrationApiKeyConfig;
  scopes?: IntegrationScopesConfig;
  apiDomains?: string[];
}

export interface IntegrationCredentialRecord {
  accessToken: string;
  tokenType?: string;
  expiresAt?: number;
  refreshToken?: string;
  grantedScopes?: string[];
  metadata?: Record<string, unknown>;
}

export interface IntegrationAccountInfo {
  accountId: string;
  grantedScopes?: string[];
}

export interface IntegrationInfo {
  id: string;
  label?: string;
  authType: IntegrationAuthType;
  connected: boolean;
  configured: boolean;
  accounts: IntegrationAccountInfo[];
  availableScopes: string[];
}

export interface IntegrationApiResponse {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
}

/** Per-agent integration config (stored in AgentSettings, used by worker routes) */
export interface AgentIntegrationConfig {
  label: string;
  authType: "api-key";
  apiKey: IntegrationApiKeyConfig;
  apiDomains: string[];
}

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
  permissions?: string[];
  integrations?: Record<string, IntegrationConfig>;
}

export interface SystemSkillsConfigFile {
  skills: SystemSkillEntry[];
}
