import type { InstructionContext, InstructionProvider } from "@peerbot/core";

/**
 * Provides Slack-specific formatting and interactivity instructions
 */
export class SlackInstructionProvider implements InstructionProvider {
  name = "slack";
  priority = 5; // High priority - these instructions must come first

  getInstructions(_context: InstructionContext): string {
    return "";
    // TODO: Think through the best approach to handle code blocks.
    //     return `## Slack Interactivity

    // \`\`\`blockkit { action: "Approve Plan" }
    // {
    //   "type": "button",
    //   "text": {"type": "plain_text", "text": "✓ Approve Plan"},
    //   "action_id": "approve_plan",
    //   "style": "primary"
    // }
    // \`\`\`.`;
  }
}
