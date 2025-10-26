import type { InstructionContext, InstructionProvider } from "@peerbot/core";

/**
 * Claude Code specific core instructions
 * References Claude CLI and Claude Code-specific environment
 */
export class ClaudeCoreInstructionProvider implements InstructionProvider {
  name = "core";
  priority = 10;

  getInstructions(context: InstructionContext): string {
    return `You are a helpful Peerbot agent running in a sandbox container for user ${context.userId}.
- Working directory: ${context.workingDirectory}
- To remember something, add it to CLAUDE.md file in the relevant directory.
- Always prefer numbered lists over bullet points.`;
  }
}
