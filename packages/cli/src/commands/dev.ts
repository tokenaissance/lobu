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

    const { manifest, envVars } = await buildManifest(cwd, config.agents);

    await writeFile(
      join(lobuDir, "agents.json"),
      JSON.stringify(manifest, null, 2)
    );

    // Write .env from lobu.toml-derived vars (merge with existing .env to preserve secrets)
    const envPath = join(cwd, ".env");
    let existingEnv = "";
    try {
      existingEnv = await readFile(envPath, "utf-8");
    } catch {
      // No existing .env, start fresh
    }

    const mergedVars = { ...parseEnvFile(existingEnv), ...envVars };
    const envContent = Object.entries(mergedVars)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n");
    await writeFile(envPath, `${envContent}\n`);

    spinner.succeed("Environment prepared from lobu.toml");

    // Check for docker-compose.yml
    const composePath = join(cwd, "docker-compose.yml");
    let composeContent: string;
    try {
      composeContent = await readFile(composePath, "utf-8");
    } catch {
      console.log(
        chalk.yellow(
          "\n  No docker-compose.yml found. Run `lobu init` to generate one.\n"
        )
      );
      process.exit(1);
    }

    // Parse gateway port from docker-compose.yml
    const portMatch = composeContent.match(/"(\d+):8080"/);
    const gatewayPort = portMatch ? portMatch[1] : "8080";
    const gatewayUrl = `http://localhost:${gatewayPort}`;

    console.log(
      chalk.cyan(`\n  Starting ${manifest.agents.length} agent(s)...\n`)
    );
    const child = spawn("docker", ["compose", "up", ...passthroughArgs], {
      cwd,
      stdio: "inherit",
    });

    child.on("error", (err) => {
      console.error(
        chalk.red(`\n  Failed to start docker compose: ${err.message}`)
      );
      console.log(chalk.dim("  Make sure Docker Desktop is running.\n"));
      process.exit(1);
    });

    child.on("exit", (code) => {
      if (code === 0 && passthroughArgs.includes("-d")) {
        console.log(chalk.green("\n  Lobu is running!\n"));
        console.log(chalk.cyan(`  Admin page:    ${gatewayUrl}/agents`));
        console.log(chalk.cyan(`  Settings:      ${gatewayUrl}/settings`));
        console.log(chalk.cyan(`  API docs:      ${gatewayUrl}/api/docs`));
        console.log(chalk.dim(`\n  View logs:     docker compose logs -f`));
        console.log(chalk.dim(`  Stop:          docker compose down\n`));
      }
      process.exit(code ?? 0);
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
  agents: Record<string, AgentEntry>
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
      entry.settings.mcpServers = agentConfig.skills.mcp;
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

function parseEnvFile(content: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    vars[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1);
  }
  return vars;
}
