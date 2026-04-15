import chalk from "chalk";

export async function skillsSearchCommand(query: string): Promise<void> {
  console.log(chalk.yellow(`\n  No bundled skill registry to search for "${query}".`));
  console.log(
    chalk.dim(
      "  Define local skills with SKILL.md files under skills/ or agents/<id>/skills/.\n"
    )
  );
}
