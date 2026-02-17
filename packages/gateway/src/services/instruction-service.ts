#!/usr/bin/env bun

import {
  createLogger,
  type InstructionContext,
  type InstructionProvider,
} from "@lobu/core";
import type { McpConfigService } from "../auth/mcp/config-service";
import type { AgentSettingsStore } from "../auth/settings/agent-settings-store";

const logger = createLogger("instruction-service");

interface McpStatus {
  id: string;
  name: string;
  requiresAuth: boolean;
  requiresInput: boolean;
  authenticated: boolean;
  configured: boolean;
}

interface SessionContextData {
  platformInstructions: string;
  networkInstructions: string;
  skillsInstructions: string;
  workspaceInstructions: string;
  mcpStatus: McpStatus[];
}

/**
 * Strip YAML frontmatter from markdown content.
 * Frontmatter is delimited by --- at the start and end.
 */
function stripFrontMatter(content: string): string {
  if (!content.startsWith("---")) return content;
  const endIndex = content.indexOf("\n---", 3);
  if (endIndex === -1) return content;
  return content.slice(endIndex + "\n---".length).replace(/^\s+/, "");
}

/**
 * Provides workspace identity/instruction files (SOUL.md, USER.md, IDENTITY.md).
 * These define the agent's personality, user context, and identity.
 * Injected at highest priority since they shape all agent behavior.
 */
class WorkspaceFilesInstructionProvider implements InstructionProvider {
  name = "workspace-files";
  priority = 5;

  constructor(private agentSettingsStore?: AgentSettingsStore) {}

  async getInstructions(context: InstructionContext): Promise<string> {
    if (!this.agentSettingsStore || !context.agentId) {
      return "";
    }

    try {
      const settings = await this.agentSettingsStore.getSettings(
        context.agentId
      );
      if (!settings) return "";

      const sections: string[] = [];

      if (settings.identityMd?.trim()) {
        sections.push(
          `## Agent Identity\n\n${stripFrontMatter(settings.identityMd)}`
        );
      }

      if (settings.soulMd?.trim()) {
        sections.push(
          `## Agent Instructions\n\n${stripFrontMatter(settings.soulMd)}`
        );
      }

      if (settings.userMd?.trim()) {
        sections.push(
          `## User Context\n\n${stripFrontMatter(settings.userMd)}`
        );
      }

      if (sections.length === 0) return "";

      return sections.join("\n\n");
    } catch (error) {
      logger.error("Failed to get workspace files instructions", { error });
      return "";
    }
  }
}

/**
 * Provides instructions from enabled skills for the agent.
 * Fetches skill content from AgentSettings and injects as instructions.
 * Falls back to generic skills.sh discovery instructions if no skills configured.
 */
class SkillsInstructionProvider implements InstructionProvider {
  name = "skills";
  priority = 15;

  constructor(private agentSettingsStore?: AgentSettingsStore) {}

  async getInstructions(context: InstructionContext): Promise<string> {
    // If no settings store or agentId, return generic skills.sh instructions
    if (!this.agentSettingsStore || !context.agentId) {
      return this.getGenericSkillsInstructions();
    }

    try {
      const settings = await this.agentSettingsStore.getSettings(
        context.agentId
      );
      const skills = settings?.skillsConfig?.skills || [];
      const enabledSkills = skills.filter((s) => s.enabled && s.content);

      if (enabledSkills.length === 0) {
        return this.getGenericSkillsInstructions();
      }

      // Progressive disclosure: inject only metadata (name + description)
      // to reduce prompt size. Agent reads full SKILL.md on demand.
      const skillSummaries = enabledSkills
        .map((skill) => {
          const desc = skill.description ? ` - ${skill.description}` : "";
          return `- **${skill.name}**${desc} (\`${skill.repo}\`)`;
        })
        .join("\n");

      return `# Enabled Skills

The following skills are installed and available. When a task matches a skill, read the full skill instructions before using it.

${skillSummaries}

**To read full skill instructions:** \`cat ~/.claude/skills/*/SKILL.md\` or \`npx skills list\` to see installed skill paths, then read the relevant SKILL.md file.

---

${this.getGenericSkillsInstructions()}`;
    } catch (error) {
      logger.error("Failed to get skills instructions", { error });
      return this.getGenericSkillsInstructions();
    }
  }

  private getGenericSkillsInstructions(): string {
    return `## Skills

You can extend your capabilities by installing skills from [skills.sh](https://skills.sh), an open ecosystem of agent skills.

**Available commands:**
- \`npx skills find [query]\` - Search for skills interactively or by keyword
- \`npx skills add owner/repo -g -y\` - Install a skill globally
- \`npx skills check\` - Check installed skills for updates
- \`npx skills update\` - Update all skills to latest versions

When the user asks about adding capabilities, finding tools, or extending functionality, search for relevant skills first using \`npx skills find\`.`;
  }
}

/**
 * Provides information about network access rules and allowed domains
 */
class NetworkInstructionProvider implements InstructionProvider {
  name = "network";
  priority = 20;

  getInstructions(_context: InstructionContext): string {
    const allowedDomains = process.env.WORKER_ALLOWED_DOMAINS?.trim() || "";
    const disallowedDomains =
      process.env.WORKER_DISALLOWED_DOMAINS?.trim() || "";

    // Unrestricted mode
    if (allowedDomains === "*") {
      if (disallowedDomains) {
        const blockedList = disallowedDomains
          .split(",")
          .map((d) => `  - ${d.trim()}`)
          .filter((d) => d.length > 4)
          .join("\n");
        return `## Network Access

**Internet Access:** Unrestricted (all domains allowed)

**Blocked domains:**
${blockedList}

You can access any external service except the blocked domains listed above.`;
      }
      return `## Network Access

**Internet Access:** Unrestricted (all domains allowed)

You can access any external service without restrictions.`;
    }

    // Complete isolation
    if (!allowedDomains) {
      return `## Network Access

**Internet Access:** Complete isolation (no external access)

You do NOT have access to the internet. All external requests (curl, wget, npm, pip, etc.) will fail. Only local operations and MCP tools are available.`;
    }

    // Allowlist mode
    const allowedList = allowedDomains
      .split(",")
      .map((d) => `  - ${d.trim()}`)
      .filter((d) => d.length > 4)
      .join("\n");

    let instructions = `## Network Access

**Internet Access:** Filtered (allowlist mode)

**Allowed domains:**
${allowedList}`;

    if (disallowedDomains) {
      const blockedList = disallowedDomains
        .split(",")
        .map((d) => `  - ${d.trim()}`)
        .filter((d) => d.length > 4)
        .join("\n");
      instructions += `

**Blocked domains:**
${blockedList}`;
    }

    instructions += `

You can only access the allowed domains listed above. All other external requests will be blocked by the proxy. Plan your work accordingly and use available MCP tools when possible.`;

    return instructions;
  }
}

/**
 * Aggregates session context data for workers
 * Returns raw data (not built instructions) so workers can format as needed
 */
export class InstructionService {
  private platformProviders = new Map<string, InstructionProvider>();
  private mcpConfigService?: McpConfigService;
  private skillsProvider: SkillsInstructionProvider;
  private workspaceFilesProvider: WorkspaceFilesInstructionProvider;

  constructor(
    mcpConfigService?: McpConfigService,
    agentSettingsStore?: AgentSettingsStore
  ) {
    this.mcpConfigService = mcpConfigService;
    this.skillsProvider = new SkillsInstructionProvider(agentSettingsStore);
    this.workspaceFilesProvider = new WorkspaceFilesInstructionProvider(
      agentSettingsStore
    );
  }

  /**
   * Register a platform-specific instruction provider
   * Called by platform adapters during initialization
   */
  registerPlatformProvider(
    platform: string,
    provider: InstructionProvider
  ): void {
    this.platformProviders.set(platform, provider);
    logger.info(
      `Registered instruction provider for platform: ${platform} (${provider.name})`
    );
  }

  /**
   * Get session context data for a worker
   * Returns platform instructions and MCP status data
   * Worker will build final instructions from this data
   */
  async getSessionContext(
    platform: string,
    context: InstructionContext
  ): Promise<SessionContextData> {
    // Get platform-specific instructions
    let platformInstructions = "";
    const platformProvider = this.platformProviders.get(platform);
    if (platformProvider) {
      try {
        platformInstructions = await platformProvider.getInstructions(context);
        logger.info(
          `Got ${platform} platform instructions (${platformInstructions.length} chars)`
        );
      } catch (error) {
        logger.error(
          `Failed to get instructions from ${platform} provider:`,
          error
        );
      }
    }

    // Get network access instructions
    let networkInstructions = "";
    const networkProvider = new NetworkInstructionProvider();
    try {
      networkInstructions = await networkProvider.getInstructions(context);
      logger.info(
        `Got network instructions (${networkInstructions.length} chars)`
      );
    } catch (error) {
      logger.error("Failed to get network instructions:", error);
    }

    // Get workspace files instructions (SOUL.md, USER.md, IDENTITY.md)
    let workspaceInstructions = "";
    try {
      workspaceInstructions =
        await this.workspaceFilesProvider.getInstructions(context);
      logger.info(
        `Got workspace instructions (${workspaceInstructions.length} chars)`
      );
    } catch (error) {
      logger.error("Failed to get workspace instructions:", error);
    }

    // Get skills instructions (includes enabled skills from agent settings)
    let skillsInstructions = "";
    try {
      skillsInstructions = await this.skillsProvider.getInstructions(context);
      logger.info(
        `Got skills instructions (${skillsInstructions.length} chars)`
      );
    } catch (error) {
      logger.error("Failed to get skills instructions:", error);
    }

    // Get MCP status data
    let mcpStatus: McpStatus[] = [];
    if (this.mcpConfigService) {
      try {
        mcpStatus =
          (await this.mcpConfigService.getMcpStatus(context.agentId)) || [];
        logger.info(`Got MCP status for ${mcpStatus.length} MCPs`);
      } catch (error) {
        logger.error("Failed to get MCP status:", error);
      }
    }

    return {
      platformInstructions,
      networkInstructions,
      skillsInstructions,
      workspaceInstructions,
      mcpStatus,
    };
  }
}
