import { createLogger } from "@lobu/core";
import type {
  SkillContent,
  SkillRegistry,
  SkillRegistryResult,
} from "./skill-registry";
import { SystemSkillsService } from "./system-skills-service";

const logger = createLogger("system-skills-registry");

/** System skills rank above remote results (ClawHub scores are typically 0–5) */
const SYSTEM_SKILL_SCORE = 10;

/**
 * Registry adapter that exposes local system skills (config/system-skills.json)
 * through the SkillRegistry interface, making them discoverable via SearchSkills.
 */
export class SystemSkillsRegistry implements SkillRegistry {
  id = "lobu";
  private service: SystemSkillsService;

  constructor(configUrl: string) {
    this.service = new SystemSkillsService(configUrl);
  }

  async search(query: string, limit: number): Promise<SkillRegistryResult[]> {
    const skills = await this.service.getSearchableSkills();
    const q = query.toLowerCase().trim();

    const filtered = q
      ? skills.filter(
          (s) =>
            s.name.toLowerCase().includes(q) ||
            s.repo.toLowerCase().includes(q) ||
            (s.description?.toLowerCase().includes(q) ?? false)
        )
      : skills;

    return filtered.slice(0, limit).map((s) => ({
      id: s.repo,
      name: s.name,
      description: s.description,
      score: SYSTEM_SKILL_SCORE,
      integrations: s.integrations,
      source: "system",
    }));
  }

  async fetch(id: string): Promise<SkillContent> {
    const skills = await this.service.getSystemSkills();
    const skill = skills.find(
      (s) => s.repo === id || s.repo === `system/${id}`
    );
    if (!skill) {
      throw new Error(`System skill "${id}" not found`);
    }

    // Get runtime content (formatted markdown)
    const runtimeSkills = await this.service.getRuntimeSystemSkills();
    const runtime = runtimeSkills.find((s) => s.repo === skill.repo);

    logger.debug(`Fetched system skill: ${skill.repo}`);

    return {
      name: skill.name,
      description: skill.description || "",
      content: runtime?.content || "",
      integrations: skill.integrations,
      mcpServers: skill.mcpServers,
      nixPackages: skill.nixPackages,
      permissions: skill.permissions,
    };
  }
}
