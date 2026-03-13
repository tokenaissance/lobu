import { z } from "zod";

// Agent section — identity lives in IDENTITY.md, SOUL.md, USER.md files
const agentSchema = z.object({
  name: z
    .string()
    .regex(
      /^[a-z0-9][a-z0-9-]*$/,
      "Agent name must be lowercase alphanumeric with hyphens, starting with alphanumeric"
    ),
  description: z.string().optional(),
});

// Provider entry
const providerSchema = z.object({
  id: z.string(),
  model: z.string().optional(),
});

// Skills section
const mcpServerSchema = z.object({
  url: z.string().optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  headers: z.record(z.string()).optional(),
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
  timeout_minutes: z.number().positive().optional(),
});

// Platforms section — accept any platform name with any config object.
// Field-level validation happens at the gateway when connections are created.
const platformsSchema = z.record(z.string(), z.record(z.unknown()));

// Full lobu.toml schema
export const lobuConfigSchema = z.object({
  agent: agentSchema,
  providers: z.array(providerSchema).default([]),
  skills: skillsSchema.default({ enabled: [] }),
  network: networkSchema.optional(),
  worker: workerSchema.optional(),
  platforms: platformsSchema.optional(),
});

export type LobuTomlConfig = z.infer<typeof lobuConfigSchema>;

export type ProviderEntry = z.infer<typeof providerSchema>;
export type McpServerEntry = z.infer<typeof mcpServerSchema>;
export type SkillsEntry = z.infer<typeof skillsSchema>;
export type NetworkEntry = z.infer<typeof networkSchema>;
export type WorkerEntry = z.infer<typeof workerSchema>;
