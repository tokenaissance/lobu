import { readFile } from "node:fs/promises";
import { join } from "node:path";
import chalk from "chalk";
import { parse as parseToml } from "smol-toml";
import { CONFIG_FILENAME } from "../../config/loader.js";
import { PLATFORM_LABELS } from "./platforms.js";

export async function connectionsListCommand(cwd: string): Promise<void> {
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

  console.log();
  for (const [agentId, agent] of Object.entries(agents)) {
    const connections = (agent.connections ?? []) as Array<
      Record<string, unknown>
    >;
    console.log(chalk.bold(`  ${agentId}`));
    if (connections.length === 0) {
      console.log(chalk.dim("    (no connections configured)"));
    } else {
      for (const c of connections) {
        const type = c.type as string;
        const label = PLATFORM_LABELS[type] ?? type;
        console.log(
          `    ${chalk.cyan("●")} ${label} ${chalk.dim(`(${type})`)}`
        );
      }
    }
    console.log();
  }
}
