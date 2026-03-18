/**
 * Shared types for the generic integration system.
 * Used by both gateway and worker packages.
 */

import type { ProviderConfigEntry } from "./provider-config-types";

// ============================================================================
// Config types (integration runtime configs)
// ============================================================================

export type IntegrationAuthType = "oauth" | "api-key";

export interface IntegrationOAuthConfig {
  authUrl: string;
  tokenUrl: string;
  clientId?: string;
  clientSecret?: string;
  incrementalAuth?: boolean;
  tokenEndpointAuthMethod?: string; // "client_secret_post" (default), "client_secret_basic", or "none" (PKCE)
  extraAuthParams?: Record<string, string>; // Extra query params for authorization URL (e.g. access_type, prompt)
}

export interface IntegrationApiKeyConfig {
  headerName: string; // e.g. "Authorization", "X-Api-Key"
  headerTemplate: string; // e.g. "Bearer {{key}}", "{{key}}"
}

export interface IntegrationScopesConfig {
  default: string[];
  available: string[];
}

export interface IntegrationConfig {
  label: string;
  authType?: IntegrationAuthType; // defaults to "oauth" for backward compat
  oauth?: IntegrationOAuthConfig;
  apiKey?: IntegrationApiKeyConfig;
  scopes?: IntegrationScopesConfig;
  apiDomains: string[];
  apiBase?: string;
  apiHints?: string;
  openapi?: {
    specUrl: string;
    operations?: string[];
  };
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
  hidden?: boolean;
  integrations?: SystemSkillIntegration[];
  mcpServers?: import("./types").SkillMcpServer[];
  providers?: ProviderConfigEntry[];
  nixPackages?: string[];
  permissions?: string[];
}

export interface SystemSkillIntegration {
  id: string;
  label: string;
  authType?: IntegrationAuthType;
  oauth?: IntegrationOAuthConfig;
  scopesConfig?: IntegrationScopesConfig;
  scopes?: string[];
  apiDomains?: string[];
  apiBase?: string;
  apiHints?: string;
}

export interface SystemSkillsConfigFile {
  skills: SystemSkillEntry[];
}

// ============================================================================
// Credential types (stored in Redis)
// ============================================================================

export interface IntegrationCredentialRecord {
  accessToken: string;
  tokenType?: string;
  expiresAt?: number;
  refreshToken?: string;
  grantedScopes: string[];
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Worker-facing types (returned by internal API endpoints)
// ============================================================================

export interface IntegrationAccountInfo {
  accountId: string;
  grantedScopes: string[];
}

export interface IntegrationInfo {
  id: string;
  label: string;
  authType: IntegrationAuthType;
  connected: boolean;
  configured: boolean;
  accounts: IntegrationAccountInfo[];
  availableScopes: string[];
  apiBase?: string;
  apiHints?: string;
}

export interface IntegrationApiResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}
