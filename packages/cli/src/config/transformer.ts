import type { LobuTomlConfig, McpServerEntry } from "./schema.js";

export interface TransformResult {
  envVars: Record<string, string>;
  mcpConfig: Record<string, McpServerEntry> | null;
}

/**
 * Transform lobu.toml config into docker-compose environment variables
 * and MCP config JSON for local dev mode.
 *
 * Platform connection credentials are managed via the settings page /
 * connections API and stored in Redis — they are NOT emitted as env vars.
 */
export function transformConfig(config: LobuTomlConfig): TransformResult {
  const envVars: Record<string, string> = {};

  // Agent name as compose project name
  envVars.COMPOSE_PROJECT_NAME = config.agent.name;

  // Network config
  if (config.network?.allowed) {
    envVars.WORKER_ALLOWED_DOMAINS = config.network.allowed.join(",");
  }
  if (config.network?.denied) {
    envVars.WORKER_DISALLOWED_DOMAINS = config.network.denied.join(",");
  }

  // Worker config
  if (config.worker?.timeout_minutes) {
    envVars.WORKER_TIMEOUT_MINUTES = String(config.worker.timeout_minutes);
  }
  if (config.worker?.nix_packages?.length) {
    envVars.WORKER_NIX_PACKAGES = config.worker.nix_packages.join(",");
  }

  // Provider config - stored as JSON for gateway to parse
  if (config.providers.length > 0) {
    envVars.AGENT_PROVIDERS = JSON.stringify(
      config.providers.map((p) => ({
        id: p.id,
        model: p.model,
      }))
    );
  }

  // Skills config
  if (config.skills.enabled.length > 0) {
    envVars.AGENT_SKILLS = config.skills.enabled.join(",");
  }

  // MCP servers from skills.mcp section
  let mcpConfig: Record<string, McpServerEntry> | null = null;
  if (config.skills.mcp && Object.keys(config.skills.mcp).length > 0) {
    mcpConfig = config.skills.mcp;
  }

  return { envVars, mcpConfig };
}
