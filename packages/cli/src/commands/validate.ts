import chalk from "chalk";
import { isLoadError, loadConfig } from "../config/loader.js";

export async function validateCommand(cwd: string): Promise<boolean> {
  const result = await loadConfig(cwd);

  if (isLoadError(result)) {
    console.error(chalk.red(`\n  ${result.error}`));
    if (result.details) {
      for (const detail of result.details) {
        console.error(chalk.dim(`  ${detail}`));
      }
    }
    console.log();
    return false;
  }

  const { config } = result;
  const warnings: string[] = [];
  const errors: string[] = [];

  for (const [agentId, agentEntry] of Object.entries(config.agents)) {
    if (agentEntry.providers.length === 0) {
      warnings.push(
        `[agents.${agentId}] No providers configured. Agent will need provider keys at runtime.`
      );
    }
  }

  console.log();
  if (errors.length === 0) {
    const agentCount = Object.keys(config.agents).length;
    console.log(chalk.green(`  lobu.toml is valid`));
    console.log(chalk.dim(`  ${agentCount} agent(s) configured`));
  } else {
    console.log(chalk.red(`  Validation failed`));
  }

  for (const err of errors) {
    console.log(chalk.red(`  ${err}`));
  }
  for (const warn of warnings) {
    console.log(chalk.yellow(`  ${warn}`));
  }
  console.log();

  return errors.length === 0;
}
