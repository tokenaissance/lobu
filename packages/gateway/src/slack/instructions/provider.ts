import type { InstructionContext, InstructionProvider } from "@peerbot/core";

/**
 * Provides Slack-specific formatting and interactivity instructions
 */
export class SlackInstructionProvider implements InstructionProvider {
  name = "slack";
  priority = 20;

  getInstructions(_context: InstructionContext): string {
    return `## Slack Formatting & Interactivity

**NEVER create HTML files** - always use BlockKit for forms/UIs.

**Use BlockKit forms when user mentions:**
- "plan", "planning", "form", "survey", "questionnaire"
- "interactive", "collect input"
- Questions: "what should I...?", "how should I...?", "what are my options?"

Example:

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
