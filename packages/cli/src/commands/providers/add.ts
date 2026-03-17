import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import chalk from "chalk";
import { parse as parseToml } from "smol-toml";
import { CONFIG_FILENAME } from "../../config/loader.js";
import { getSkillById, isProviderSkill } from "../skills/registry.js";

export async function providersAddCommand(
  cwd: string,
  providerId: string
): Promise<void> {
  const skill = getSkillById(providerId);
  if (!skill || !isProviderSkill(skill)) {
    console.log(chalk.red(`\n  Provider "${providerId}" not found.`));
    console.log(
      chalk.dim("  Run `lobu providers list` to see available providers.\n")
    );
    return;
  }

  const configPath = join(cwd, CONFIG_FILENAME);
  let raw: string;
  try {
    raw = await readFile(configPath, "utf-8");
  } catch {
    console.log(
      chalk.red(`\n  No ${CONFIG_FILENAME} found. Run \`lobu init\` first.\n`)
    );
    return;
  }

  const parsed = parseToml(raw) as Record<string, unknown>;
  const agents = parsed.agents as
    | Record<string, Record<string, unknown>>
    | undefined;
  if (!agents || Object.keys(agents).length === 0) {
    console.log(chalk.red("\n  No agents found in lobu.toml.\n"));
    return;
  }

  const agentId = Object.keys(agents)[0]!;
  const agent = agents[agentId]!;
  const providers = (agent.providers ?? []) as Array<Record<string, unknown>>;

  if (providers.some((p) => p.id === providerId)) {
    console.log(
      chalk.yellow(`\n  Provider "${providerId}" is already configured.\n`)
    );
    return;
  }

  const provider = skill.providers?.[0];
  if (!provider) return;

  const defaultModel = provider.defaultModel;
  const envVar = provider.envVarName;

  // Append provider entry to the TOML file (preserves comments/formatting)
  const tomlBlock = [
    "",
    `[[agents.${agentId}.providers]]`,
    `id = "${providerId}"`,
    ...(defaultModel ? [`model = "${defaultModel}"`] : []),
    `key = "$${envVar}"`,
  ].join("\n");

  await writeFile(configPath, `${raw.trimEnd()}\n${tomlBlock}\n`);

  console.log(
    chalk.green(`\n  Added provider "${providerId}" to ${CONFIG_FILENAME}`)
  );
  if (defaultModel) {
    console.log(chalk.dim(`  Default model: ${defaultModel}`));
  }

  console.log(chalk.dim("\n  Set the API key:"));
  console.log(chalk.cyan(`    lobu secrets set ${envVar} <your-key>`));
  console.log();
}
