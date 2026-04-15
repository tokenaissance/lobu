import chalk from "chalk";

export async function skillsAddCommand(
  cwd: string,
  skillId: string
): Promise<void> {
  console.log(
    chalk.yellow(`\n  Bundled skill installation for "${skillId}" has been removed.`)
  );
  console.log(
    chalk.dim(
      `  Define a local skill in ${cwd}/skills/${skillId}/SKILL.md or agents/<id>/skills/${skillId}/SKILL.md instead.\n`
    )
  );
}
