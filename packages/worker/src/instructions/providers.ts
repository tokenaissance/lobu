/**
 * Instruction providers for worker
 */

import type { InstructionContext, InstructionProvider } from "@lobu/core";

/**
 * Provides instructions for using the process manager MCP
 */
export class ProcessManagerInstructionProvider implements InstructionProvider {
  name = "process-manager";
  priority = 40;

  getInstructions(_context: InstructionContext): string {
    return `## Long-running Process Management

- You MUST use MCP process manager tools (start_process, get_process_status, get_process_logs, stop_process) for long-running processes.
- If the process exposes a port, you MUST pass it to the start_process tool to expose the port via tunnel. You can't share localhost url to the user because the user doesn't have access to that environment.
- **IMPORTANT for web apps**: When creating or running local dev servers, you MUST configure allowHosts to be anywhere *.lobu.ai as we will use tunnel to expose the host, the user won't use 127.0.0.1 or localhost to prevent "blocked request".
- Processes persist across agent sessions with auto-restart and logging
- Use descriptive process IDs like "dev-server", "api-backend" (unique per session)`;
  }
}

/**
 * Provides information about available projects in the workspace
 */
export class ProjectsInstructionProvider implements InstructionProvider {
  name = "projects";
  priority = 30;

  getInstructions(context: InstructionContext): string {
    if (!context.availableProjects || context.availableProjects.length === 0) {
      return `**Available projects:**
  - none`;
    }

    const projectList = context.availableProjects
      .map((project: string) => `  - ${project}`)
      .join("\n");

    return `**Available projects:**
${projectList}`;
  }
}
