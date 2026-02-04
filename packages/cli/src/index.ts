// Export all commands

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import chalk from "chalk";
import { Command } from "commander";

export { initCommand } from "./commands/init.js";

export * from "./types.js";

export { checkConfigExists } from "./utils/config.js";
export { renderTemplate } from "./utils/template.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function getPackageVersion(): Promise<string> {
  const pkgPath = join(__dirname, "..", "package.json");
  const pkgContent = await readFile(pkgPath, "utf-8");
  const pkg = JSON.parse(pkgContent) as { version?: string };
  return pkg.version ?? "0.0.0";
}

export async function runCli(
  argv: readonly string[] = process.argv
): Promise<void> {
  const program = new Command();
  program
    .name("create-termos")
    .description(
      "Initialize a new Termos project and generate docker-compose.yml"
    )
    .argument("[project-name]", "Name of the project (optional)")
    .version(await getPackageVersion())
    .action(async (projectName?: string) => {
      try {
        const { initCommand } = await import("./commands/init.js");
        await initCommand(process.cwd(), projectName);
      } catch (error) {
        console.error(chalk.red("\n✗ Error:"), error);
        process.exit(1);
      }
    });

  await program.parseAsync(argv);
}
