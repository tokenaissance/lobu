import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import chalk from "chalk";
import { parse as parseToml } from "smol-toml";
import { CONFIG_FILENAME } from "../../config/loader.js";
import { getSkillById } from "./registry.js";

export async function skillsAddCommand(
  cwd: string,
  skillId: string
): Promise<void> {
  const skill = getSkillById(skillId);
  if (!skill) {
    console.log(chalk.red(`\n  Skill "${skillId}" not found.`));
    console.log(
      chalk.dim("  Run `lobu skills list` to see available skills.\n")
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
  const skills = (agent.skills ?? { enabled: [] }) as Record<string, unknown>;
  const enabled = (skills.enabled ?? []) as string[];

  if (enabled.includes(skillId)) {
    console.log(chalk.yellow(`\n  Skill "${skillId}" is already enabled.\n`));
    return;
  }

  // Update the enabled array in-place via regex to preserve file formatting
  const skillsKey = `agents.${agentId}.skills`;
  const enabledPattern = new RegExp(
    `(\\[${skillsKey.replace(/\./g, "\\.")}\\][^\\[]*enabled\\s*=\\s*\\[)([^\\]]*)\\]`
  );
  const match = raw.match(enabledPattern);

  if (match) {
    const existing = match[2]!.trim();
    const newList = existing ? `${existing}, "${skillId}"` : `"${skillId}"`;
    const updated = raw.replace(enabledPattern, `$1${newList}]`);
    await writeFile(configPath, updated);
  } else {
    // No skills section yet — append one
    const tomlBlock = ["", `[${skillsKey}]`, `enabled = ["${skillId}"]`].join(
      "\n"
    );
    await writeFile(configPath, `${raw.trimEnd()}\n${tomlBlock}\n`);
  }

  console.log(chalk.green(`\n  Added "${skillId}" to ${CONFIG_FILENAME}`));

  // Show required secrets if provider
  if (skill.providers) {
    const envVars = skill.providers.map((p) => p.envVarName);
    if (envVars.length > 0) {
      console.log(chalk.dim("\n  Required secrets:"));
      for (const v of envVars) {
        console.log(chalk.cyan(`    lobu secrets set ${v} <your-key>`));
      }
    }
  }
  console.log();
}
