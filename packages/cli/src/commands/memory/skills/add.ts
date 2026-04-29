import { installBundledSkill, listBundledSkills } from "../_lib/bundled-skills.js";
import { isJson, printError, printJson, printText } from "../_lib/output.js";

interface AddOptions {
  dir?: string;
  force?: boolean;
}

export function memorySkillsAddCommand(skillId: string, options: AddOptions = {}): void {
  try {
    const { skill, destinationDir } = installBundledSkill(
      skillId,
      options.dir || process.cwd(),
      { force: options.force }
    );

    if (isJson()) {
      printJson({
        skill: { id: skill.id, name: skill.name, description: skill.description },
        destinationDir,
      });
      return;
    }

    printText(`Installed "${skill.name}"`);
    printText(`→ ${destinationDir}`);
    printText("");
    printText("Next steps:");
    printText("1. Point your agent or workspace at that local skills/ directory.");
    printText("2. Run `lobu memory init` to configure MCP/auth for your client.");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isJson()) {
      printJson({ error: message, available: listBundledSkills().map((skill) => skill.id) });
      process.exitCode = 1;
      return;
    }

    printError(message);
    printText(
      `Available starter skills: ${listBundledSkills().map((skill) => skill.id).join(", ")}`
    );
    process.exitCode = 1;
  }
}
