#!/usr/bin/env bun

// Shared exports for @lobu/core consumers (gateway, worker, external tools)

export type { CommandContext, CommandDefinition } from "./command-registry";
// Command registry
export { CommandRegistry } from "./command-registry";
export * from "./constants";
// Errors & logging
export * from "./errors";
// Integration types
export type {
  AgentIntegrationConfig,
  IntegrationAccountInfo,
  IntegrationApiKeyConfig,
  IntegrationApiResponse,
  IntegrationAuthType,
  IntegrationConfig,
  IntegrationCredentialRecord,
  IntegrationInfo,
  IntegrationOAuthConfig,
  IntegrationScopesConfig,
  SystemSkillEntry,
  SystemSkillIntegration,
  SystemSkillsConfigFile,
} from "./integration-types";
export * from "./logger";
// Typed memory contracts
export type {
  LinkMemoryRequest,
  LinkMemoryResponse,
  MemoryError,
  MemoryFilter,
  MemoryRecord,
  MemoryRecordType,
  MemoryRelationType,
  MemorySort,
  MemorySortDirection,
  MemorySortField,
  RecallMemoryRequest,
  RecallMemoryResponse,
  SaveMemoryRequest,
  SaveMemoryResponse,
  UpdateMemoryRequest,
  UpdateMemoryResponse,
} from "./memory-types";
// Module system
export type { ActionButton, ModuleSessionContext } from "./modules";
export * from "./modules";
export type { OtelConfig, Span, Tracer } from "./otel";
// OpenTelemetry tracing (Tempo integration)
export {
  createChildSpan,
  createRootSpan,
  createSpan,
  flushTracing,
  getCurrentSpan,
  getTraceparent,
  getTracer,
  initTracing,
  runInSpanContext,
  SpanKind,
  SpanStatusCode,
  shutdownTracing,
  withChildSpan,
  withSpan,
} from "./otel";
// Plugin types
export type {
  PluginConfig,
  PluginManifest,
  PluginSlot,
  PluginsConfig,
  ProviderRegistration,
} from "./plugin-types";
// Config-driven provider types
export type {
  ConfigProviderMeta,
  ProviderConfigEntry,
} from "./provider-config-types";
// Redis & worker helpers
export * from "./redis/base-store";
// Observability
export { getSentry, initSentry } from "./sentry";
export { extractTraceId, generateTraceId } from "./trace";
// Core types
export type {
  AgentMcpConfig,
  AgentOptions,
  AuthProfile,
  CliBackendConfig,
  ConversationMessage,
  HistoryMessage,
  InstalledProvider,
  InstructionContext,
  InstructionProvider,
  LogLevel,
  McpServerConfig,
  NetworkConfig,
  NixConfig,
  RegistryEntry,
  SessionContext,
  SkillConfig,
  SkillIntegration,
  SkillMcpServer,
  SkillsConfig,
  SuggestedPrompt,
  ThinkingLevel,
  ThreadResponsePayload,
  ToolsConfig,
  UserSuggestion,
} from "./types";

export { normalizeSkillIntegration } from "./types";

// Platform constants
export const SUPPORTED_PLATFORMS = [
  "telegram",
  "slack",
  "discord",
  "whatsapp",
  "teams",
] as const;
export type SupportedPlatform = (typeof SUPPORTED_PLATFORMS)[number];

// Utilities
export * from "./utils/encryption";
export * from "./utils/env";
export * from "./utils/json";
export * from "./utils/lock";
export type { McpToolDef } from "./utils/mcp-tool-instructions";
export { buildMcpToolInstructions } from "./utils/mcp-tool-instructions";
export * from "./utils/retry";
export * from "./utils/sanitize";
export * from "./worker/auth";
export type {
  WorkerTransport,
  WorkerTransportConfig,
} from "./worker/transport";
