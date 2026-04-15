import chalk from "chalk";
import { loadProviderRegistry } from "./registry.js";

export async function providersListCommand(): Promise<void> {
  const providers = loadProviderRegistry();

  if (providers.length === 0) {
    console.log(chalk.yellow("\n  No providers found in the bundled registry.\n"));
    return;
  }

  console.log(chalk.bold("\n  Available LLM Providers:\n"));

  const maxIdLen = Math.max(...providers.map((provider) => provider.id.length));

  for (const provider of providers) {
    const meta = provider.providers[0];
    if (!meta) continue;
    const model = meta.defaultModel
      ? chalk.dim(` default: ${meta.defaultModel}`)
      : "";
    console.log(
      `  ${chalk.cyan(provider.id.padEnd(maxIdLen))}  ${meta.displayName}${model}`
    );
  }

  console.log(
    chalk.dim(
      "\n  Use `npx @lobu/cli@latest providers add <id>` to add a provider to lobu.toml.\n"
    )
  );
}
