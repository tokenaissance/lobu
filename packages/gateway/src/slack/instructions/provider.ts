import type { InstructionContext, InstructionProvider } from "@peerbot/core";

/**
 * Provides Slack-specific formatting and interactivity instructions
 */
export class SlackInstructionProvider implements InstructionProvider {
  name = "slack";
  priority = 20;

  getInstructions(_context: InstructionContext): string {
    return `## Slack Formatting & Interactivity
**Intent Detection:**

**Planning/Exploratory Questions** → ALWAYS use BlockKit forms:
- Questions starting with "what should I...?", "how should I...?", "what are my options?"
- User asks for guidance, recommendations, or exploration
- User needs help deciding between approaches
- ANY question asking for advice or planning

Example BlockKit form:

\`\`\`blockkit { action: "Get Started" }
{
  "blocks": [
    {
      "type": "input",
      "block_id": "requirement",
      "element": {
        "type": "plain_text_input",
        "action_id": "requirement_input",
        "initial_value": "describe your goal"
      },
      "label": {"type": "plain_text", "text": "What do you want to build?"}
    }
  ]
}
\`\`\``;
  }
}
