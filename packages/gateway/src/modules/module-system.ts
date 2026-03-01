import type { CliBackendConfig } from "@lobu/core";
import {
  type ActionButton,
  type ModuleInterface,
  type ModuleSessionContext,
  moduleRegistry,
  type WorkerContext,
  type WorkerModule,
} from "@lobu/core";

// ============================================================================
// Gateway-Only Module Type Definitions
// ============================================================================

export interface HomeTabModule<TModuleData = unknown>
  extends ModuleInterface<TModuleData> {
  /** Render home tab elements */
  renderHomeTab(userId: string): Promise<any[]>;
}

export interface ModelOption {
  value: string;
  label: string;
}

export interface OrchestratorModule<TModuleData = unknown>
  extends ModuleInterface<TModuleData> {
  /** Build environment variables for worker container */
  buildEnvVars(
    agentId: string,
    baseEnv: Record<string, string>
  ): Promise<Record<string, string>>;

  /** Get container address for module-specific services */
  getContainerAddress(): string;
}

export interface ProviderUpstreamConfig {
  slug: string; // "anthropic", "openai-codex", "gemini"
  upstreamBaseUrl: string; // "https://api.anthropic.com"
}

export interface ModelProviderModule extends OrchestratorModule {
  /** Unique identifier for the provider (e.g. "claude", "chatgpt") */
  providerId: string;
  /** Human-readable name shown in auth prompts (e.g. "Claude AI") */
  providerDisplayName: string;
  /** Icon URL for settings UI (favicon or CDN) */
  providerIconUrl?: string;
  /** Auth type hint for settings UI rendering */
  authType?: "oauth" | "device-code" | "api-key";
  /** Multiple auth types supported by this provider (e.g. ["oauth", "api-key"]) */
  supportedAuthTypes?: ("oauth" | "device-code" | "api-key")[];
  /** For api-key providers: instructions shown to user (supports HTML) */
  apiKeyInstructions?: string;
  /** For api-key providers: placeholder text in the input field */
  apiKeyPlaceholder?: string;
  /** Short description for the provider catalog UI */
  catalogDescription?: string;
  /** Whether to show this provider in the catalog (default true) */
  catalogVisible?: boolean;
  /** Env var names that should be treated as secrets for this provider */
  getSecretEnvVarNames(): string[];
  /** Env var name the SDK expects for the API credential (e.g. "ANTHROPIC_API_KEY") */
  getCredentialEnvVarName(): string;
  /** Proxy routing config: slug + upstream base URL. Null if provider doesn't use proxy. */
  getUpstreamConfig?(): ProviderUpstreamConfig | null;
  /** Check if an agent has per-agent credentials for this provider */
  hasCredentials(agentId: string): Promise<boolean>;
  /** Check if a system-level key is available (e.g. from process.env) */
  hasSystemKey(): boolean;
  /** Return env var mappings for routing SDK traffic through the proxy.
   * When agentId is provided, the proxy URL includes /a/{agentId} so the
   * proxy can resolve credentials without inspecting the Authorization header. */
  getProxyBaseUrlMappings(
    proxyUrl: string,
    agentId?: string
  ): Record<string, string>;
  /** Inject system key as fallback if no per-agent credentials are set */
  injectSystemKeyFallback(
    envVars: Record<string, string>
  ): Record<string, string>;
  /** Return Hono app for auth routes, if any */
  getApp?(): any;
  /** Return model list exposed to UI */
  getModelOptions?(agentId: string, userId: string): Promise<ModelOption[]>;
  /** CLI tool config for pi-agent integration. Null if no CLI backend. */
  getCliBackendConfig?(): CliBackendConfig | null;
}

export interface DispatcherContext<TModuleData = unknown> {
  userId: string;
  channelId: string;
  threadTs: string;
  /** Platform-specific client (e.g., Slack WebClient, WhatsApp BaileysClient) */
  platformClient?: unknown;
  moduleData: TModuleData;
}

export interface DispatcherModule<TModuleData = unknown>
  extends ModuleInterface<TModuleData> {
  /** Generate action buttons. Return empty array if none. */
  generateActionButtons(
    context: DispatcherContext<TModuleData>
  ): Promise<ActionButton[]>;

  /** Handle action button clicks. Return true if handled. */
  handleAction(
    actionId: string,
    userId: string,
    agentId: string,
    context: any
  ): Promise<boolean>;

  /** Handle view submission (modal submitted). Optional. */
  handleViewSubmission?(
    viewId: string,
    userId: string,
    values: any,
    privateMetadata: string
  ): Promise<void>;
}

// ============================================================================
// Gateway Module Registry Interface (full version)
// ============================================================================

export interface IGatewayModuleRegistry {
  register(module: ModuleInterface): void;
  getDispatcherModules(): DispatcherModule[];
  getHomeTabModules(): HomeTabModule[];
  getWorkerModules(): WorkerModule[];
  getOrchestratorModules(): OrchestratorModule[];
  getModelProviderModules(): ModelProviderModule[];
  registerAvailableModules(modulePackages?: string[]): Promise<void>;
  initAll(): Promise<void>;
  registerEndpoints(app: any): void;
  getModules(): ModuleInterface[];
}

// ============================================================================
// Base Module Implementation
// ============================================================================

/**
 * Base module class that provides default implementations for all optional methods.
 * Modules can extend this class and override only what they need.
 */
export abstract class BaseModule<TModuleData = unknown>
  implements
    WorkerModule<TModuleData>,
    DispatcherModule<TModuleData>,
    HomeTabModule<TModuleData>,
    OrchestratorModule<TModuleData>
{
  abstract name: string;
  abstract isEnabled(): boolean;

  async init(): Promise<void> {
    // Default: no-op
  }

  registerEndpoints(_app: any): void {
    // Default: no-op
  }

  async renderHomeTab(_userId: string): Promise<any[]> {
    // Default: no home tab blocks
    return [];
  }

  async initWorkspace(_config: any): Promise<void> {
    // Default: no-op
  }

  async onSessionStart(
    context: ModuleSessionContext
  ): Promise<ModuleSessionContext> {
    // Default: pass through unchanged
    return context;
  }

  async onSessionEnd(_context: ModuleSessionContext): Promise<ActionButton[]> {
    // Default: no buttons
    return [];
  }

  async onBeforeResponse(_context: WorkerContext): Promise<TModuleData | null> {
    // Default: no data
    return null;
  }

  async buildEnvVars(
    _agentId: string,
    baseEnv: Record<string, string>
  ): Promise<Record<string, string>> {
    // Default: pass through unchanged
    return baseEnv;
  }

  async getModelOptions(
    _agentId: string,
    _userId: string
  ): Promise<ModelOption[]> {
    return [];
  }

  getContainerAddress(): string {
    // Default: empty string
    return "";
  }

  async generateActionButtons(
    _context: DispatcherContext<TModuleData>
  ): Promise<ActionButton[]> {
    // Default: no buttons
    return [];
  }

  async handleAction(
    _actionId: string,
    _userId: string,
    _agentId: string,
    _context: any
  ): Promise<boolean> {
    // Default: not handled
    return false;
  }
}

// ============================================================================
// Gateway-Specific Module Registry Accessors
// ============================================================================

/**
 * Get home tab modules from the global module registry.
 */
export function getHomeTabModules(): HomeTabModule[] {
  return moduleRegistry
    .getModules()
    .filter((m): m is HomeTabModule => "renderHomeTab" in m);
}

/**
 * Get orchestrator modules from the global module registry.
 */
export function getOrchestratorModules(): OrchestratorModule[] {
  return moduleRegistry
    .getModules()
    .filter((m): m is OrchestratorModule => "buildEnvVars" in m);
}

/**
 * Get model provider modules from the global module registry.
 */
export function getModelProviderModules(): ModelProviderModule[] {
  return moduleRegistry
    .getModules()
    .filter(
      (m): m is ModelProviderModule =>
        "providerId" in m && "getSecretEnvVarNames" in m
    );
}

/**
 * Get dispatcher modules from the global module registry.
 */
export function getDispatcherModules(): DispatcherModule[] {
  return moduleRegistry
    .getModules()
    .filter((m): m is DispatcherModule => "generateActionButtons" in m);
}

// Re-export the core singleton for convenience
export { moduleRegistry } from "@lobu/core";

/**
 * Gateway module registry that wraps the core singleton with gateway-specific accessors.
 * Use this when gateway-specific methods (getDispatcherModules, etc.) are needed
 * on an object rather than as standalone functions.
 */
export const gatewayModuleRegistry: IGatewayModuleRegistry = {
  register: (module) => moduleRegistry.register(module),
  getWorkerModules: () => moduleRegistry.getWorkerModules(),
  registerAvailableModules: (pkgs) =>
    moduleRegistry.registerAvailableModules(pkgs),
  initAll: () => moduleRegistry.initAll(),
  registerEndpoints: (app) => moduleRegistry.registerEndpoints(app),
  getModules: () => moduleRegistry.getModules(),
  getDispatcherModules,
  getHomeTabModules,
  getOrchestratorModules,
  getModelProviderModules,
};
