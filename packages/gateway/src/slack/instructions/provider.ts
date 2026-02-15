import type { InstructionContext, InstructionProvider } from "@lobu/core";

/**
 * Provides Slack-specific formatting and interactivity instructions
 */
export class SlackInstructionProvider implements InstructionProvider {
  name = "slack";
  priority = 5; // High priority - these instructions must come first

  getInstructions(_context: InstructionContext): string {
    return `## Slack Platform Context

You are communicating via Slack, a professional messaging platform. Users can see:
- Channel names, descriptions, and purposes
- Thread context and conversation history
- File attachments and shared media
- Team member presence and status

## Interactive Elements (BlockKit)

You can create interactive buttons using BlockKit code blocks with action metadata:

\`\`\`blockkit { action: "Button Label" }
{
  "type": "button",
  "text": {"type": "plain_text", "text": "✓ Approve Plan"},
  "action_id": "approve_plan",
  "style": "primary"
}
\`\`\`

**Button Guidelines:**
- The code block will be hidden from the message
- A clickable button appears with the specified action label
- When clicked, the BlockKit form/action is executed
- Useful for: approvals, confirmations, form submissions, workflow actions
- Button styles: \`"primary"\` (green), \`"danger"\` (red), or default
- Keep BlockKit JSON under 2000 characters (Slack limit)

**Common Use Cases:**
- Plan approval workflows: "Approve Plan", "Reject Plan"
- File operations: "Create PR", "Deploy Changes"
- User confirmations: "Confirm Action", "Cancel"
- Form submissions: "Submit Feedback", "Configure Settings"

The button will trigger an interactive dialog or action handler when clicked.`;
  }
}
