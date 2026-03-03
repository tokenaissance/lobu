/**
 * Shared types for config-driven LLM providers.
 * Loaded from the `providers` section of system skills config.
 */

export interface ProviderConfigEntry {
  /** Display name in settings page (e.g. "Groq") */
  displayName: string;
  /** Provider icon URL */
  iconUrl: string;
  /** Env var name for API key (e.g. "GROQ_API_KEY") */
  envVarName: string;
  /** Provider's API base URL (e.g. "https://api.groq.com/openai") */
  upstreamBaseUrl: string;
  /** HTML help text for the settings page API key input */
  apiKeyInstructions: string;
  /** Placeholder text for the API key input */
  apiKeyPlaceholder: string;
  /** SDK compatibility hint — "openai" means OpenAI-compatible API format */
  sdkCompat?: "openai";
  /** Default model ID when none is configured */
  defaultModel?: string;
  /** Relative path to fetch model list (e.g. "/v1/models") */
  modelsEndpoint?: string;
  /** Override provider name for model registry lookup */
  registryAlias?: string;
  /** Whether to show in "Add Provider" catalog (default: true) */
  catalogVisible?: boolean;
}

/** Metadata passed from gateway to worker for config-driven providers. */
export interface ConfigProviderMeta {
  sdkCompat?: "openai";
  defaultModel?: string;
  registryAlias?: string;
  baseUrlEnvVar: string;
}
