import chalk from "chalk";

export async function skillsInfoCommand(skillId: string): Promise<void> {
  console.log(chalk.yellow(`\n  No bundled skill metadata for "${skillId}".`));
  console.log(
    chalk.dim(
      "  Define local skills with SKILL.md files under skills/ or agents/<id>/skills/.\n"
    )
  );
  console.log(
    chalk.dim(
      "  Use `npx @lobu/cli@latest providers list` to browse bundled providers.\n"
    )
  );
}
