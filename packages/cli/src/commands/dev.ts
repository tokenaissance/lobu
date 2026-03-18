import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import chalk from "chalk";
import ora from "ora";
import { loadSkillsRegistry } from "../commands/skills/registry.js";
import type {
  AgentManifestEntry,
  AgentsManifest,
} from "../config/agents-manifest.js";
import {
  isLoadError,
  loadAgentMarkdown,
  loadConfig,
  loadSkillFiles,
} from "../config/loader.js";
import type { AgentEntry } from "../config/schema.js";

/**
 * `lobu dev` — smart wrapper around `docker compose up`.
 * Reads lobu.toml, seeds .env + agents manifest, then passes all args through.
 */
export async function devCommand(
  cwd: string,
  passthroughArgs: string[]
): Promise<void> {
  const result = await loadConfig(cwd);

  if (isLoadError(result)) {
    console.error(chalk.red(`\n  ${result.error}`));
    if (result.details) {
      for (const detail of result.details) {
        console.error(chalk.dim(`  ${detail}`));
      }
    }
    console.log();
    process.exit(1);
  }

  const { config } = result;
  const spinner = ora("Preparing local dev environment...").start();

  try {
    const lobuDir = join(cwd, ".lobu");
    await mkdir(lobuDir, { recursive: true });

    // Parse .env first so we can resolve $VAR references in lobu.toml
    const envPath = join(cwd, ".env");
    let existingEnv = "";
    try {
      existingEnv = await readFile(envPath, "utf-8");
    } catch {
      // No existing .env, start fresh
    }
    const dotenvVars = parseEnvFile(existingEnv);

    const { manifest, envVars } = await buildManifest(
      cwd,
      config.agents,
      dotenvVars
    );

    await writeFile(
      join(lobuDir, "agents.json"),
      JSON.stringify(manifest, null, 2)
    );

    // Merge derived vars into existing .env (preserves comments and formatting)
    await mergeEnvFile(envPath, existingEnv, envVars);

    spinner.succeed("Environment prepared from lobu.toml");

    // Check for docker-compose.yml
    try {
      await readFile(join(cwd, "docker-compose.yml"), "utf-8");
    } catch {
      console.log(
        chalk.yellow(
          "\n  No docker-compose.yml found. Run `lobu init` to generate one.\n"
        )
      );
      process.exit(1);
    }

    const fallbackPort = dotenvVars.GATEWAY_PORT || "8080";

    console.log(
      chalk.cyan(`\n  Starting ${manifest.agents.length} agent(s)...\n`)
    );

    const explicitDetach =
      passthroughArgs.includes("-d") || passthroughArgs.includes("--detach");

    // Always start detached so we can print the banner before logs
    const upArgs = explicitDetach
      ? ["compose", "up", ...passthroughArgs]
      : ["compose", "up", "-d", ...passthroughArgs];

    const up = spawn("docker", upArgs, { cwd, stdio: "inherit" });

    up.on("error", (err) => {
      console.error(
        chalk.red(`\n  Failed to start docker compose: ${err.message}`)
      );
      console.log(chalk.dim("  Make sure Docker Desktop is running.\n"));
      process.exit(1);
    });

    up.on("exit", (code) => {
      if (code !== 0) {
        process.exit(code ?? 1);
      }

      // Detect actual host port from the running container
      const portProbe = spawn(
        "docker",
        ["compose", "port", "gateway", "8080"],
        { cwd, stdio: ["ignore", "pipe", "ignore"] }
      );

      let portOutput = "";
      portProbe.stdout.on("data", (data: Buffer) => {
        portOutput += data.toString();
      });

      portProbe.on("exit", () => {
        const match = portOutput.trim().match(/:(\d+)$/);
        const port = match ? match[1] : fallbackPort;
        const gatewayUrl = `http://localhost:${port}`;

        console.log(chalk.green("\n  Lobu is running!\n"));
        console.log(chalk.cyan(`  Admin page:    ${gatewayUrl}/agents`));
        console.log(chalk.dim(`\n  Stop:          docker compose down`));

        if (explicitDetach) {
          console.log(
            chalk.dim(`  View logs:     docker compose logs -f gateway\n`)
          );
          process.exit(0);
        }

        console.log(
          chalk.dim(`  Ctrl+C stops log tail, containers keep running.\n`)
        );

        // Tail only gateway logs (skip redis noise)
        const logs = spawn("docker", ["compose", "logs", "-f", "gateway"], {
          cwd,
          stdio: "inherit",
        });

        logs.on("exit", (logCode) => {
          process.exit(logCode ?? 0);
        });
      });
    });
  } catch (err) {
    spinner.fail("Failed to prepare environment");
    console.error(
      chalk.red(`  ${err instanceof Error ? err.message : String(err)}`)
    );
    process.exit(1);
  }
}

/**
 * Build agents manifest and merged env vars from [agents.*] config.
 */
async function buildManifest(
  cwd: string,
  agents: Record<string, AgentEntry>,
  dotenvVars: Record<string, string>
): Promise<{ manifest: AgentsManifest; envVars: Record<string, string> }> {
  const entries: AgentManifestEntry[] = [];
  const rootSkillsDir = join(cwd, "skills");
  const registrySkills = new Map(
    loadSkillsRegistry().map((skill) => [skill.id, skill])
  );

  for (const [agentId, agentConfig] of Object.entries(agents)) {
    const agentDir = resolve(cwd, agentConfig.dir);
    const markdown = await loadAgentMarkdown(agentDir);
    const skillFiles = await loadSkillFiles([
      rootSkillsDir,
      join(agentDir, "skills"),
    ]);
    const systemSkills = agentConfig.skills.enabled
      .map((skillId) => registrySkills.get(skillId))
      .filter((skill): skill is NonNullable<typeof skill> => !!skill)
      .map((skill) => ({
        repo: `system/${skill.id}`,
        name: skill.name,
        description: skill.description,
        enabled: true,
        system: true,
        content: "",
        integrations: skill.integrations?.map((integration) => ({
          id: integration.id,
          label: integration.label,
          authType: integration.authType,
          scopesConfig: integration.scopesConfig,
          apiDomains: integration.apiDomains,
        })),
        mcpServers: skill.mcpServers?.map((mcp) => ({
          id: mcp.id,
          name: mcp.name,
          url: mcp.url,
          type: mcp.type,
          command: mcp.command,
          args: mcp.args,
        })),
        nixPackages: skill.nixPackages,
        permissions: skill.permissions,
        providers: skill.providers?.length ? [skill.id] : undefined,
      }));
    const localSkills = skillFiles.map((skillFile) => ({
      repo: `local/${skillFile.name}`,
      name: skillFile.name,
      content: skillFile.content,
      enabled: true,
    }));

    const entry: AgentManifestEntry = {
      agentId,
      name: agentConfig.name,
      description: agentConfig.description,
      settings: { ...markdown },
    };

    if (agentConfig.providers.length > 0) {
      entry.settings.installedProviders = agentConfig.providers.map((p) => ({
        providerId: p.id,
      }));
      entry.settings.modelSelection = { mode: "auto" };
      const providerModelPreferences = Object.fromEntries(
        agentConfig.providers
          .filter((provider) => !!provider.model?.trim())
          .map((provider) => [provider.id, provider.model!.trim()])
      );
      if (Object.keys(providerModelPreferences).length > 0) {
        entry.settings.providerModelPreferences = providerModelPreferences;
      }
    }

    if (systemSkills.length > 0 || localSkills.length > 0) {
      entry.settings.skillsConfig = {
        skills: [...systemSkills, ...localSkills],
      };
    }

    if (agentConfig.network) {
      entry.settings.networkConfig = {
        allowedDomains: agentConfig.network.allowed,
        deniedDomains: agentConfig.network.denied,
      };
    }

    if (agentConfig.worker?.nix_packages?.length) {
      entry.settings.nixConfig = {
        packages: agentConfig.worker.nix_packages,
      };
    }

    if (agentConfig.skills.mcp) {
      const mcpServers: Record<string, any> = {};
      for (const [id, mcp] of Object.entries(agentConfig.skills.mcp)) {
        const mapped: Record<string, any> = { ...mcp };
        if (mcp.oauth) {
          mapped.oauth = {
            authUrl: mcp.oauth.auth_url,
            tokenUrl: mcp.oauth.token_url,
            clientId: resolveEnvVar(mcp.oauth.client_id || "", dotenvVars),
            clientSecret: resolveEnvVar(
              mcp.oauth.client_secret || "",
              dotenvVars
            ),
            scopes: mcp.oauth.scopes,
            tokenEndpointAuthMethod: mcp.oauth.token_endpoint_auth_method,
          };
        }
        // Resolve env vars in MCP env block
        if (mcp.env) {
          mapped.env = Object.fromEntries(
            Object.entries(mcp.env).map(([k, v]) => [
              k,
              resolveEnvVar(v, dotenvVars),
            ])
          );
        }
        mcpServers[id] = mapped;
      }
      entry.settings.mcpServers = mcpServers;
    }

    // Resolve provider credentials from $ENV_VAR references
    const credentials = agentConfig.providers
      .filter((p) => p.key)
      .map((p) => ({
        providerId: p.id,
        key: resolveEnvVar(p.key!, dotenvVars),
      }))
      .filter((c) => c.key); // skip if env var not found

    if (credentials.length > 0) {
      entry.credentials = credentials;
    }

    // Resolve connection configs from $ENV_VAR references
    const connections = agentConfig.connections
      .map((conn) => ({
        type: conn.type,
        config: Object.fromEntries(
          Object.entries(conn.config).map(([k, v]) => [
            k,
            resolveEnvVar(v, dotenvVars),
          ])
        ),
      }))
      .filter((conn) => Object.values(conn.config).every((v) => v !== "")); // skip if any env var missing

    if (connections.length > 0) {
      entry.connections = connections;
    }

    entries.push(entry);
  }

  const envVars: Record<string, string> = {
    COMPOSE_PROJECT_NAME: entries[0]?.name
      ? entries[0].name.toLowerCase().replace(/\s+/g, "-")
      : basename(cwd),
  };

  return { manifest: { version: 1, agents: entries }, envVars };
}

/**
 * Resolve a value that may be a $ENV_VAR reference.
 * Returns the resolved value, or empty string if the env var is not set.
 */
function resolveEnvVar(value: string, envVars: Record<string, string>): string {
  if (value.startsWith("$")) {
    const varName = value.slice(1);
    return envVars[varName] || process.env[varName] || "";
  }
  return value;
}

function parseEnvFile(content: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx);
    let value = trimmed.slice(eqIdx + 1);
    // Strip surrounding quotes (double or single)
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    vars[key] = value;
  }
  return vars;
}

/**
 * Merge derived env vars into an existing .env file.
 * Updates existing keys in-place and appends new ones at the end.
 * Preserves comments, blank lines, and formatting.
 */
async function mergeEnvFile(
  envPath: string,
  existingContent: string,
  newVars: Record<string, string>
): Promise<void> {
  const remaining = { ...newVars };
  const lines = existingContent.split("\n");

  const updated = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return line;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) return line;
    const key = trimmed.slice(0, eqIdx);
    if (key in remaining) {
      const val = remaining[key]!;
      delete remaining[key];
      return `${key}=${val}`;
    }
    return line;
  });

  // Append any new vars that weren't already in the file
  for (const [key, value] of Object.entries(remaining)) {
    updated.push(`${key}=${value}`);
  }

  // Ensure trailing newline
  const content = `${updated.join("\n").trimEnd()}\n`;
  await writeFile(envPath, content);
}
