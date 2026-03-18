import { z } from "zod";

// Provider entry
const providerSchema = z.object({
  id: z.string(),
  model: z.string().optional(),
  key: z.string().optional(), // API key or $ENV_VAR reference
});

// Connection entry (platform-specific config is dynamic)
const connectionSchema = z.object({
  type: z.string(), // "telegram" | "slack" | "discord" | "whatsapp" | "teams"
  config: z.record(z.string()), // platform-specific config (e.g. { botToken: "$BOT_TOKEN" })
});

// MCP server OAuth configuration
const mcpOAuthSchema = z.object({
  auth_url: z.string(),
  token_url: z.string(),
  client_id: z.string().optional(), // $ENV_VAR reference or literal
  client_secret: z.string().optional(),
  scopes: z.array(z.string()).optional(),
  token_endpoint_auth_method: z.string().optional(), // "none", "client_secret_post", "client_secret_basic"
});

// Skills section
const mcpServerSchema = z.object({
  url: z.string().optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  headers: z.record(z.string()).optional(),
  oauth: mcpOAuthSchema.optional(),
});

const skillsSchema = z.object({
  enabled: z.array(z.string()).default([]),
  mcp: z.record(mcpServerSchema).optional(),
});

// Network section
const networkSchema = z.object({
  allowed: z.array(z.string()).optional(),
  denied: z.array(z.string()).optional(),
});

// Worker section
const workerSchema = z.object({
  nix_packages: z.array(z.string()).optional(),
});

// Each [agents.{id}] table
const agentEntrySchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  dir: z.string(), // path to agent content directory (IDENTITY.md, SOUL.md, USER.md, skills/)
  providers: z.array(providerSchema).default([]),
  connections: z.array(connectionSchema).default([]),
  skills: skillsSchema.default({ enabled: [] }),
  network: networkSchema.optional(),
  worker: workerSchema.optional(),
});

// Full lobu.toml schema
export const lobuConfigSchema = z.object({
  agents: z.record(z.string().regex(/^[a-z0-9][a-z0-9-]*$/), agentEntrySchema),
});

export type LobuTomlConfig = z.infer<typeof lobuConfigSchema>;
export type AgentEntry = z.infer<typeof agentEntrySchema>;

export type ProviderEntry = z.infer<typeof providerSchema>;
export type ConnectionEntry = z.infer<typeof connectionSchema>;
export type McpServerEntry = z.infer<typeof mcpServerSchema>;
export type SkillsEntry = z.infer<typeof skillsSchema>;
export type NetworkEntry = z.infer<typeof networkSchema>;
export type WorkerEntry = z.infer<typeof workerSchema>;
