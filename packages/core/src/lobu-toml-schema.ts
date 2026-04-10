/**
 * Canonical zod schema for `lobu.toml`.
 *
 * This is the single source of truth for both the CLI (validation on disk)
 * and the gateway (runtime loading). Uses zod@4.
 */

import { z } from "zod";

// ── Provider ────────────────────────────────────────────────────────────────

const providerSchema = z
  .object({
    id: z.string(),
    model: z.string().optional(),
    /** API key — literal value or `$ENV_VAR` reference. */
    key: z.string().optional(),
    /** First-class durable secret reference. */
    secret_ref: z.string().optional(),
  })
  .refine((p) => !(p.key && p.secret_ref), {
    message: "provider must set at most one of `key` or `secret_ref`",
  });

// ── Connection ──────────────────────────────────────────────────────────────

const connectionSchema = z.object({
  type: z.string(),
  /** Platform-specific config (e.g. `{ botToken: "$BOT_TOKEN" }`). */
  config: z.record(z.string(), z.string()),
});

// ── MCP Server ──────────────────────────────────────────────────────────────

const mcpOAuthSchema = z.object({
  auth_url: z.string(),
  token_url: z.string(),
  client_id: z.string().optional(),
  client_secret: z.string().optional(),
  scopes: z.array(z.string()).optional(),
  token_endpoint_auth_method: z.string().optional(),
});

const mcpServerSchema = z.object({
  url: z.string().optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  oauth: mcpOAuthSchema.optional(),
});

// ── Skills ──────────────────────────────────────────────────────────────────

const skillsSchema = z.object({
  enabled: z.array(z.string()).default([]),
  mcp: z.record(z.string(), mcpServerSchema).optional(),
});

// ── Network ─────────────────────────────────────────────────────────────────

const networkSchema = z.object({
  allowed: z.array(z.string()).optional(),
  denied: z.array(z.string()).optional(),
});

// ── Tools ───────────────────────────────────────────────────────────────────

/**
 * Accepted `pre_approved` entry formats:
 *   /mcp/<id>/tools/<name>
 *   /mcp/<id>/tools/*
 * Anything else will fail validation — typos like "gmail" silently produced
 * a no-op grant previously.
 */
const MCP_TOOL_PATTERN = /^\/mcp\/[a-zA-Z0-9_-]+\/tools\/([a-zA-Z0-9_-]+|\*)$/;
const mcpToolPatternSchema = z
  .string()
  .refine((value) => MCP_TOOL_PATTERN.test(value), {
    message:
      'pre_approved entries must match "/mcp/<mcp-id>/tools/<tool-name>" or "/mcp/<mcp-id>/tools/*"',
  });

const toolsSchema = z.object({
  /**
   * Operator override: MCP tool grant patterns that bypass the in-thread
   * approval card. Synced to the grant store at deployment time. See
   * {@link AgentSettings.preApprovedTools} for the runtime shape.
   */
  pre_approved: z.array(mcpToolPatternSchema).optional(),
  /**
   * Worker-side tool visibility filter. Patterns follow Claude Code's
   * permission format: `Read`, `Bash(git:*)`, `mcp__github__*`, `*`.
   */
  allowed: z.array(z.string()).optional(),
  denied: z.array(z.string()).optional(),
  /** If true, ONLY `allowed` tools are permitted (ignores worker defaults). */
  strict: z.boolean().optional(),
});

// ── Worker ──────────────────────────────────────────────────────────────────

const workerSchema = z.object({
  nix_packages: z.array(z.string()).optional(),
});

// ── Agent ───────────────────────────────────────────────────────────────────

const agentEntrySchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  /** Path to agent content directory (IDENTITY.md, SOUL.md, USER.md, skills/). */
  dir: z.string(),
  providers: z.array(providerSchema).default([]),
  connections: z.array(connectionSchema).default([]),
  skills: skillsSchema.default({ enabled: [] }),
  network: networkSchema.optional(),
  tools: toolsSchema.optional(),
  worker: workerSchema.optional(),
});

// ── Top Level ───────────────────────────────────────────────────────────────

export const lobuConfigSchema = z.object({
  agents: z.record(z.string().regex(/^[a-z0-9][a-z0-9-]*$/), agentEntrySchema),
});

// ── Inferred Types ──────────────────────────────────────────────────────────

export type LobuTomlConfig = z.infer<typeof lobuConfigSchema>;
export type AgentEntry = z.infer<typeof agentEntrySchema>;
export type ProviderEntry = z.infer<typeof providerSchema>;
export type ConnectionEntry = z.infer<typeof connectionSchema>;
export type McpServerEntry = z.infer<typeof mcpServerSchema>;
export type SkillsEntry = z.infer<typeof skillsSchema>;
export type NetworkEntry = z.infer<typeof networkSchema>;
export type ToolsEntry = z.infer<typeof toolsSchema>;
export type WorkerEntry = z.infer<typeof workerSchema>;
