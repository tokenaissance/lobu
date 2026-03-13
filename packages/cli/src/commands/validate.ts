import chalk from "chalk";
import { isLoadError, loadConfig } from "../config/loader.js";
import { loadSkillsRegistry } from "./skills/registry.js";

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

  // Validate skill IDs against system-skills.json
  const systemSkills = loadSkillsRegistry();
  const skillIds = new Set(systemSkills.map((s) => s.id));

  for (const skillId of config.skills.enabled) {
    if (!skillIds.has(skillId)) {
      errors.push(
        `Unknown skill "${skillId}". Run \`lobu skills list\` to see available skills.`
      );
    }
  }

  // Validate provider IDs
  const providerSkills = systemSkills.filter(
    (s) => s.providers && s.providers.length > 0
  );
  const providerIds = new Set(providerSkills.map((s) => s.id));

  for (const provider of config.providers) {
    if (!providerIds.has(provider.id)) {
      warnings.push(
        `Provider "${provider.id}" not found in registry. It may require manual configuration.`
      );
    }
    if (!provider.model) {
      warnings.push(`Provider "${provider.id}" has no model specified.`);
    }
  }

  // Check for empty providers
  if (config.providers.length === 0) {
    warnings.push(
      "No providers configured. Agent will need provider keys at runtime."
    );
  }

  // Collect configured platforms
  const configuredPlatforms = config.platforms
    ? Object.keys(config.platforms)
    : [];

  // Print results
  console.log();
  if (errors.length === 0) {
    const platformSummary =
      configuredPlatforms.length > 0
        ? `, ${configuredPlatforms.length} platform${configuredPlatforms.length > 1 ? "s" : ""}: ${configuredPlatforms.join(", ")}`
        : "";
    console.log(chalk.green(`  lobu.toml is valid`));
    console.log(
      chalk.dim(
        `  Agent: ${config.agent.name} (${config.providers.length} providers, ${config.skills.enabled.length} skills${platformSummary})`
      )
    );
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
