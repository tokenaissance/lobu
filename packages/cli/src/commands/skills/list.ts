import chalk from "chalk";

export async function skillsListCommand(): Promise<void> {
  console.log(chalk.bold("\n  Bundled skill registry removed\n"));
  console.log(
    chalk.dim(
      "  Define local skills in your project instead:\n" +
        "    - skills/<name>/SKILL.md\n" +
        "    - agents/<agent-id>/skills/<name>/SKILL.md\n"
    )
  );
  console.log(
    chalk.dim(
      "  Use `npx @lobu/cli@latest providers list` to browse bundled LLM providers.\n"
    )
  );
}
