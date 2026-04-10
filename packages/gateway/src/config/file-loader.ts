import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import type {
  TomlAgentEntry as AgentEntry,
  AgentSettings,
  LobuTomlConfig,
  TomlMcpServerEntry as McpServerEntry,
  SkillConfig,
  SystemSkillEntry,
  ToolsEntry,
} from "@lobu/core";
import { createLogger, lobuConfigSchema } from "@lobu/core";
import { parse as parseToml } from "smol-toml";
import { parse as parseYaml } from "yaml";

const logger = createLogger("file-loader");

// ── Public Types ──────────────────────────────────────────────────────────

export interface FileLoadedAgent {
  agentId: string;
  name: string;
  description?: string;
  settings: Partial<AgentSettings>;
  credentials: Array<{
    provider: string;
    key?: string;
    secretRef?: string;
  }>;
  connections: Array<{ type: string; config: Record<string, string> }>;
}

// ── Main Entry Point ──────────────────────────────────────────────────────

/**
 * Load agent config directly from lobu.toml + markdown files on disk.
 * Reads agent config directly from project files at startup.
 *
 * @param projectPath - Root directory containing lobu.toml (e.g. /app)
 */
export async function loadAgentConfigFromFiles(
  projectPath: string
): Promise<FileLoadedAgent[]> {
  const config = await loadAndValidateToml(projectPath);
  if (!config) return [];

  const rootSkillsDir = join(projectPath, "skills");
  const registrySkills = await loadSystemSkillsRegistry(projectPath);

  const agents: FileLoadedAgent[] = [];

  for (const [agentId, agentConfig] of Object.entries(config.agents)) {
    try {
      const agent = await buildAgentConfig(
        agentId,
        agentConfig,
        projectPath,
        rootSkillsDir,
        registrySkills
      );
      agents.push(agent);
    } catch (err) {
      logger.error(`Failed to load agent "${agentId}" from files`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info(`Loaded ${agents.length} agent(s) from lobu.toml`);
  return agents;
}

// ── TOML Loading ──────────────────────────────────────────────────────────

async function loadAndValidateToml(
  projectPath: string
): Promise<LobuTomlConfig | null> {
  const configPath = join(projectPath, "lobu.toml");

  let raw: string;
  try {
    raw = await readFile(configPath, "utf-8");
  } catch {
    logger.debug(`No lobu.toml found at ${configPath}`);
    return null;
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = parseToml(raw) as Record<string, unknown>;
  } catch (err) {
    logger.error("Invalid TOML syntax in lobu.toml", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }

  const result = lobuConfigSchema.safeParse(parsed);
  if (!result.success) {
    const details = result.error.issues.map(
      (issue) => `${issue.path.join(".")}: ${issue.message}`
    );
    logger.error("Invalid lobu.toml schema", { details });
    return null;
  }

  return result.data;
}

// ── Agent Config Builder ──────────────────────────────────────────────────

async function buildAgentConfig(
  agentId: string,
  agentConfig: AgentEntry,
  projectPath: string,
  rootSkillsDir: string,
  registrySkills: Map<string, SystemSkillEntry>
): Promise<FileLoadedAgent> {
  const agentDir = resolve(projectPath, agentConfig.dir);
  const markdown = await loadAgentMarkdown(agentDir);
  const skillFiles = await loadSkillFiles([
    rootSkillsDir,
    join(agentDir, "skills"),
  ]);

  const settings: Partial<AgentSettings> = {
    ...markdown,
  };

  // Providers
  if (agentConfig.providers.length > 0) {
    settings.installedProviders = agentConfig.providers.map((p) => ({
      providerId: p.id,
      installedAt: Date.now(),
    }));
    settings.modelSelection = { mode: "auto" };
    const providerModelPreferences = Object.fromEntries(
      agentConfig.providers
        .filter((provider) => !!provider.model?.trim())
        .map((provider) => [provider.id, provider.model!.trim()])
    );
    if (Object.keys(providerModelPreferences).length > 0) {
      settings.providerModelPreferences = providerModelPreferences;
    }
  }

  // Skills (system + local)
  const systemSkills = buildSystemSkills(agentConfig, registrySkills);
  const localSkills = buildLocalSkills(skillFiles);
  if (systemSkills.length > 0 || localSkills.length > 0) {
    settings.skillsConfig = {
      skills: [...systemSkills, ...localSkills],
    };
  }

  // Network — start with agent-level config, then merge skill-level domains
  const mergedAllowedDomains: string[] = [
    ...(agentConfig.network?.allowed || []),
  ];
  const mergedDeniedDomains: string[] = [
    ...(agentConfig.network?.denied || []),
  ];

  // Nix packages — start with agent-level, then merge skill-level
  const mergedNixPackages: string[] = [
    ...(agentConfig.worker?.nix_packages || []),
  ];

  // MCP servers — start with agent-level toml config
  const mcpServers: Record<string, any> = {};
  if (agentConfig.skills.mcp) {
    for (const [id, rawMcp] of Object.entries(agentConfig.skills.mcp)) {
      const mcp = rawMcp as McpServerEntry;
      const mapped: Record<string, any> = {
        url: mcp.url,
        command: mcp.command,
        args: mcp.args,
        headers: mcp.headers,
      };
      if (mcp.oauth) {
        mapped.oauth = {
          authUrl: mcp.oauth.auth_url,
          tokenUrl: mcp.oauth.token_url,
          clientId: resolveEnvVar(mcp.oauth.client_id || ""),
          clientSecret: resolveEnvVar(mcp.oauth.client_secret || ""),
          scopes: mcp.oauth.scopes,
          tokenEndpointAuthMethod: mcp.oauth.token_endpoint_auth_method,
        };
      }
      if (mcp.env) {
        mapped.env = Object.fromEntries(
          Object.entries(mcp.env).map(([k, v]) => [k, resolveEnvVar(v)])
        );
      }
      mcpServers[id] = mapped;
    }
  }

  // Merge skill-level frontmatter configs into agent settings.
  // Note: skills can declare nix packages, network domains, and MCP servers —
  // but NOT tool pre-approvals. Pre-approving destructive MCP tools is an
  // operator-only escape hatch (see `[agents.<id>.tools]` in lobu.toml).
  const allSkills = [...systemSkills, ...localSkills];
  for (const skill of allSkills) {
    if (skill.nixPackages?.length) {
      mergedNixPackages.push(...skill.nixPackages);
    }
    if (skill.networkConfig?.allowedDomains?.length) {
      mergedAllowedDomains.push(...skill.networkConfig.allowedDomains);
    }
    if (skill.networkConfig?.deniedDomains?.length) {
      mergedDeniedDomains.push(...skill.networkConfig.deniedDomains);
    }
    // Merge skill-level MCP servers
    if (skill.mcpServers?.length) {
      for (const mcp of skill.mcpServers) {
        if (!mcpServers[mcp.id]) {
          mcpServers[mcp.id] = {
            url: mcp.url,
            type: mcp.type,
            command: mcp.command,
            args: mcp.args,
          };
        }
      }
    }
  }

  // Apply merged network config
  if (mergedAllowedDomains.length > 0 || mergedDeniedDomains.length > 0) {
    settings.networkConfig = {
      allowedDomains:
        mergedAllowedDomains.length > 0
          ? [...new Set(mergedAllowedDomains)]
          : undefined,
      deniedDomains:
        mergedDeniedDomains.length > 0
          ? [...new Set(mergedDeniedDomains)]
          : undefined,
    };
  }

  // Apply merged nix packages
  if (mergedNixPackages.length > 0) {
    settings.nixConfig = {
      packages: [...new Set(mergedNixPackages)],
    };
  }

  // Apply agent-level tool configuration (worker-side policy + operator
  // pre-approvals that bypass the in-thread approval gate).
  applyAgentToolsConfig(settings, agentConfig.tools);

  // Apply merged MCP servers
  if (Object.keys(mcpServers).length > 0) {
    settings.mcpServers = mcpServers;
  }

  // Credentials
  const credentials = agentConfig.providers
    .filter((p) => p.key || p.secret_ref)
    .map((p) => ({
      provider: p.id,
      ...(p.key ? { key: resolveEnvVar(p.key) } : {}),
      ...(p.secret_ref ? { secretRef: resolveEnvVar(p.secret_ref) } : {}),
    }))
    .filter((c) => c.key || c.secretRef);

  // Connections
  const connections = agentConfig.connections
    .map((conn) => ({
      type: conn.type,
      config: Object.fromEntries(
        Object.entries(conn.config).map(([k, v]) => [
          k,
          resolveEnvVar(v as string),
        ])
      ) as Record<string, string>,
    }))
    .filter((conn) => Object.values(conn.config).every((v) => v !== ""));

  return {
    agentId,
    name: agentConfig.name,
    description: agentConfig.description,
    settings,
    credentials,
    connections,
  };
}

// ── System Skills ─────────────────────────────────────────────────────────

function buildSystemSkills(
  agentConfig: AgentEntry,
  registrySkills: Map<string, SystemSkillEntry>
): SkillConfig[] {
  return agentConfig.skills.enabled
    .map((skillId) => registrySkills.get(skillId))
    .filter((skill): skill is SystemSkillEntry => !!skill)
    .map((skill) => ({
      repo: `system/${skill.id}`,
      name: skill.name,
      description: skill.description,
      instructions: skill.instructions,
      enabled: true,
      system: true,
      mcpServers: skill.mcpServers?.map((mcp) => ({
        id: mcp.id,
        name: mcp.name,
        url: mcp.url,
        type: mcp.type,
        command: mcp.command,
        args: mcp.args,
      })),
      nixPackages: skill.nixPackages,
      networkConfig: skill.networkConfig,
      providers: skill.providers?.length ? [skill.id] : undefined,
    }));
}

/**
 * Translate a `[agents.<id>.tools]` block into AgentSettings fields.
 * `pre_approved` becomes `settings.preApprovedTools`; `allowed`/`denied`/`strict`
 * populate `settings.toolsConfig` for worker-side permission filtering.
 */
function applyAgentToolsConfig(
  settings: Partial<AgentSettings>,
  tools: ToolsEntry | undefined
): void {
  if (!tools) return;

  if (tools.pre_approved?.length) {
    settings.preApprovedTools = [...new Set(tools.pre_approved)];
  }

  if (
    tools.allowed?.length ||
    tools.denied?.length ||
    tools.strict !== undefined
  ) {
    settings.toolsConfig = {
      ...(tools.allowed?.length
        ? { allowedTools: [...new Set(tools.allowed)] }
        : {}),
      ...(tools.denied?.length
        ? { deniedTools: [...new Set(tools.denied)] }
        : {}),
      ...(tools.strict !== undefined ? { strictMode: tools.strict } : {}),
    };
  }
}

function buildLocalSkills(skillFiles: LoadedSkillFile[]): SkillConfig[] {
  return skillFiles.map((skillFile) => {
    const skill: SkillConfig = {
      repo: `local/${skillFile.name}`,
      name: skillFile.name,
      content: skillFile.content,
      enabled: true,
    };

    const fm = skillFile.frontmatter;
    if (fm) {
      if (fm.description) skill.description = fm.description;
      if (fm.nixPackages?.length) skill.nixPackages = fm.nixPackages;
      if (fm.network) {
        skill.networkConfig = {
          allowedDomains: fm.network.allow,
          deniedDomains: fm.network.deny,
        };
      }
      if (fm.mcpServers && Object.keys(fm.mcpServers).length > 0) {
        skill.mcpServers = Object.entries(fm.mcpServers).map(([id, mcp]) => ({
          id,
          url: mcp.url,
          type: mcp.type as "sse" | "stdio" | undefined,
          command: mcp.command,
          args: mcp.args,
        }));
      }
    }

    return skill;
  });
}

// ── Markdown Loading ──────────────────────────────────────────────────────

async function loadAgentMarkdown(
  dir: string
): Promise<{ identityMd?: string; soulMd?: string; userMd?: string }> {
  const result: { identityMd?: string; soulMd?: string; userMd?: string } = {};

  const files = [
    { path: "IDENTITY.md", key: "identityMd" as const },
    { path: "SOUL.md", key: "soulMd" as const },
    { path: "USER.md", key: "userMd" as const },
  ];

  for (const { path, key } of files) {
    try {
      const content = await readFile(join(dir, path), "utf-8");
      if (content.trim()) {
        result[key] = content.trim();
      }
    } catch {
      // File doesn't exist, skip
    }
  }

  return result;
}

// ── Skill File Loading ────────────────────────────────────────────────────

/** Parsed YAML frontmatter from a SKILL.md file. */
interface SkillFrontmatter {
  name?: string;
  description?: string;
  nixPackages?: string[];
  network?: { allow?: string[]; deny?: string[] };
  mcpServers?: Record<
    string,
    {
      url?: string;
      type?: string;
      command?: string;
      args?: string[];
      env?: Record<string, string>;
    }
  >;
}

/** A loaded skill file with optional parsed frontmatter. */
interface LoadedSkillFile {
  name: string;
  content: string;
  frontmatter?: SkillFrontmatter;
}

/**
 * Parse YAML frontmatter from a markdown string.
 * Returns the parsed frontmatter object and the remaining markdown body.
 * If no frontmatter is found, returns null frontmatter and the full content as body.
 */
function parseFrontmatter(raw: string): {
  frontmatter: SkillFrontmatter | null;
  body: string;
} {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match?.[1]) {
    return { frontmatter: null, body: raw };
  }

  try {
    const parsed = parseYaml(match[1]) as SkillFrontmatter;
    return {
      frontmatter: parsed && typeof parsed === "object" ? parsed : null,
      body: (match[2] || "").trim(),
    };
  } catch (err) {
    logger.warn("Failed to parse YAML frontmatter in skill file", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { frontmatter: null, body: raw };
  }
}

async function loadSkillFiles(dirs: string[]): Promise<LoadedSkillFile[]> {
  const skillMap = new Map<string, LoadedSkillFile>();

  for (const dir of dirs) {
    const resolvedDir = resolve(dir);
    let entries: string[];
    try {
      entries = await readdir(resolvedDir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      // Directory-based skill: entry is a directory containing SKILL.md
      const entryPath = join(resolvedDir, entry);
      let entryStat;
      try {
        entryStat = await stat(entryPath);
      } catch {
        continue;
      }

      if (entryStat.isDirectory()) {
        const skillMdPath = join(entryPath, "SKILL.md");
        try {
          const raw = await readFile(skillMdPath, "utf-8");
          if (raw.trim()) {
            const { frontmatter, body } = parseFrontmatter(raw.trim());
            const name = frontmatter?.name || entry;
            skillMap.set(name, {
              name,
              content: body,
              frontmatter: frontmatter || undefined,
            });
          }
        } catch {
          // No SKILL.md in directory, skip
        }
        continue;
      }

      // Flat .md file (backwards compat): no frontmatter parsing
      if (!entry.endsWith(".md")) continue;
      const name = entry.slice(0, -3);
      try {
        const content = await readFile(entryPath, "utf-8");
        if (content.trim()) {
          skillMap.set(name, { name, content: content.trim() });
        }
      } catch {
        // Skip unreadable files
      }
    }
  }

  return Array.from(skillMap.values());
}

// ── System Skills Registry ────────────────────────────────────────────────

async function loadSystemSkillsRegistry(
  projectPath: string
): Promise<Map<string, SystemSkillEntry>> {
  const configPath = resolve(projectPath, "config/system-skills.json");
  try {
    const raw = await readFile(configPath, "utf-8");
    const data = JSON.parse(raw) as { skills: SystemSkillEntry[] };
    if (!Array.isArray(data.skills)) return new Map();
    return new Map(data.skills.map((skill) => [skill.id, skill]));
  } catch {
    // Fallback: try relative to process.cwd() (Docker mounts config/ at repo root)
    try {
      const fallbackPath = resolve(process.cwd(), "config/system-skills.json");
      if (fallbackPath === configPath) return new Map();
      const raw = await readFile(fallbackPath, "utf-8");
      const data = JSON.parse(raw) as { skills: SystemSkillEntry[] };
      if (!Array.isArray(data.skills)) return new Map();
      return new Map(data.skills.map((skill) => [skill.id, skill]));
    } catch {
      logger.debug("No system-skills.json found");
      return new Map();
    }
  }
}

// ── Env Var Resolution ────────────────────────────────────────────────────

/**
 * Resolve a value that may be a $ENV_VAR reference.
 * Returns the resolved value, or empty string if the env var is not set.
 */
function resolveEnvVar(value: string): string {
  if (value.startsWith("$")) {
    const varName = value.slice(1);
    return process.env[varName] || "";
  }
  return value;
}
