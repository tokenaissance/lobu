import { listBundledSkills } from "../_lib/bundled-skills.js";
import { isJson, printJson, printTable, printText } from "../_lib/output.js";

export function memorySkillsListCommand(): void {
  const skills = listBundledSkills().map((skill) => ({
    id: skill.id,
    name: skill.name,
    description: skill.description,
    files: skill.files,
  }));

  if (isJson()) {
    printJson({ skills });
    return;
  }

  if (skills.length === 0) {
    printText("No bundled memory starter skills are available.");
    return;
  }

  printText("Bundled memory starter skills");
  printTable(
    ["ID", "Name", "Description"],
    skills.map((skill) => [skill.id, skill.name, skill.description])
  );
}
