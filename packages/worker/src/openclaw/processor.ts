import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";
import { createLogger } from "@lobu/core";

const logger = createLogger("openclaw-processor");

/**
 * Tool display configuration - maps tool names to emoji and description formatting.
 * Shared display format with Claude processor.
 */
const TOOL_DISPLAY_CONFIG: Record<
  string,
  {
    emoji: string;
    action: string;
    getParam: (params: Record<string, unknown>) => string;
  }
> = {
  Write: {
    emoji: "✏️",
    action: "Writing",
    getParam: (p) => `\`${p.file_path || ""}\``,
  },
  Edit: {
    emoji: "✏️",
    action: "Editing",
    getParam: (p) => `\`${p.file_path || ""}\``,
  },
  Bash: {
    emoji: "👾",
    action: "Running",
    getParam: (p) => {
      const cmd = String(p.command || p.description || "command");
      return `\`${cmd.length > 50 ? `${cmd.substring(0, 50)}...` : cmd}\``;
    },
  },
  bash: {
    emoji: "👾",
    action: "Running",
    getParam: (p) => {
      const cmd = String(p.command || p.description || "command");
      return `\`${cmd.length > 50 ? `${cmd.substring(0, 50)}...` : cmd}\``;
    },
  },
  Read: {
    emoji: "📖",
    action: "Reading",
    getParam: (p) => `\`${p.file_path || ""}\``,
  },
  read: {
    emoji: "📖",
    action: "Reading",
    getParam: (p) => `\`${p.file_path || p.path || ""}\``,
  },
  write: {
    emoji: "✏️",
    action: "Writing",
    getParam: (p) => `\`${p.file_path || p.path || ""}\``,
  },
  Grep: {
    emoji: "🔍",
    action: "Searching",
    getParam: (p) => `\`${p.pattern || ""}\``,
  },
  grep: {
    emoji: "🔍",
    action: "Searching",
    getParam: (p) => `\`${p.pattern || ""}\``,
  },
  Glob: {
    emoji: "🔍",
    action: "Finding",
    getParam: (p) => `\`${p.pattern || ""}\``,
  },
  glob: {
    emoji: "🔍",
    action: "Finding",
    getParam: (p) => `\`${p.pattern || ""}\``,
  },
  WebFetch: {
    emoji: "🌐",
    action: "Fetching",
    getParam: (p) => `\`${p.url || ""}\``,
  },
  WebSearch: {
    emoji: "🔎",
    action: "Searching web",
    getParam: (p) => `\`${p.query || ""}\``,
  },
};

/**
 * Format MCP-style tool names: prefix__server__tool -> prefix.server.tool
 */
function formatMcpToolName(toolName: string): string {
  const pattern = /^([^_]+)__([^_]+)__(.+)$/;
  const match = toolName.match(pattern);
  if (match) {
    const [, prefix, server, tool] = match;
    return `${prefix}.${server}.${tool}`;
  }
  return toolName;
}

/**
 * Format tool execution for user-friendly display
 */
function formatToolExecution(
  toolName: string,
  args: unknown,
  verboseLogging: boolean
): string {
  const params =
    args && typeof args === "object" ? (args as Record<string, unknown>) : {};

  const config = TOOL_DISPLAY_CONFIG[toolName];

  if (verboseLogging) {
    const formattedName = config ? toolName : formatMcpToolName(toolName);
    const emoji = config?.emoji || "🔧";
    const inputStr =
      Object.keys(params).length > 0
        ? `\n\`\`\`json\n${JSON.stringify(params, null, 2)}\n\`\`\``
        : "";
    return `└ ${emoji} **${formattedName}**${inputStr}`;
  }

  if (!config) {
    const formattedName = formatMcpToolName(toolName);
    return `└ 🔧 **Using** ${formattedName}`;
  }

  const param = config.getParam(params);
  const description = param ? `**${config.action}** ${param}` : config.action;
  return `└ ${config.emoji} ${description}`;
}

/**
 * Processes Pi agent streaming events and extracts user-friendly content.
 * Implements chronological display with tool progress and mixed text/tool output.
 */
export class OpenClawProgressProcessor {
  private chronologicalOutput = "";
  private lastSentContent = "";
  private currentThinking = "";
  private verboseLogging = false;
  private finalResult: { text: string; isFinal: boolean } | null = null;
  private hasStreamedText = false;

  setVerboseLogging(enabled: boolean): void {
    this.verboseLogging = enabled;
    logger.info(`Verbose logging ${enabled ? "enabled" : "disabled"}`);
  }

  /**
   * Process a Pi agent session event and append to chronological output.
   * Returns true if new content was appended.
   */
  processEvent(event: AgentSessionEvent): boolean {
    switch (event.type) {
      case "message_update": {
        if (event.message.role !== "assistant") {
          return false;
        }
        const assistantEvent = event.assistantMessageEvent;

        if (assistantEvent.type === "text_delta") {
          this.hasStreamedText = true;
          this.chronologicalOutput += assistantEvent.delta;
          return true;
        }

        if (assistantEvent.type === "thinking_delta") {
          this.currentThinking += assistantEvent.delta;
          if (this.verboseLogging) {
            this.chronologicalOutput += assistantEvent.delta;
            return true;
          }
          return false;
        }

        if (assistantEvent.type === "thinking_start" && this.verboseLogging) {
          this.chronologicalOutput += "\n💭 *Reasoning:*\n";
          return true;
        }

        if (assistantEvent.type === "thinking_end" && this.verboseLogging) {
          this.chronologicalOutput += "\n\n";
          return true;
        }

        return false;
      }

      case "message_end": {
        if (event.message.role !== "assistant") {
          return false;
        }
        // If text was already streamed via deltas, skip extraction
        if (this.hasStreamedText) {
          return false;
        }
        // Fallback: extract text from final message content
        const content = event.message.content;
        if (!Array.isArray(content)) {
          return false;
        }
        let extracted = false;
        for (const block of content) {
          if (
            block &&
            typeof block === "object" &&
            "type" in block &&
            (block as { type: string }).type === "text" &&
            "text" in block &&
            typeof (block as { text: unknown }).text === "string"
          ) {
            const text = (block as { text: string }).text;
            if (text.trim()) {
              this.chronologicalOutput += text;
              extracted = true;
            }
          }
        }
        return extracted;
      }

      case "tool_execution_start": {
        const formatted = formatToolExecution(
          event.toolName,
          event.args,
          this.verboseLogging
        );
        if (formatted) {
          this.chronologicalOutput += `${formatted}\n`;
          return true;
        }
        return false;
      }

      case "auto_compaction_start": {
        this.chronologicalOutput += "🗜️ *Compacting context...*\n";
        return true;
      }

      case "auto_compaction_end": {
        if (event.aborted) {
          this.chronologicalOutput += "🗜️ *Compaction aborted*\n";
        } else if (event.result) {
          this.chronologicalOutput += "🗜️ *Context compacted*\n";
        }
        return true;
      }

      case "auto_retry_start": {
        this.chronologicalOutput += `🔄 *Retrying (attempt ${event.attempt}/${event.maxAttempts})...*\n`;
        return true;
      }

      case "auto_retry_end": {
        if (!event.success && event.finalError) {
          this.chronologicalOutput += `🔄 *Retry failed: ${event.finalError}*\n`;
          return true;
        }
        return false;
      }

      default:
        return false;
    }
  }

  /**
   * Get delta since last sent content.
   * Returns null if no new content.
   */
  getDelta(): string | null {
    const fullContent = this.chronologicalOutput.trim();

    if (!fullContent) {
      return null;
    }

    if (fullContent === this.lastSentContent) {
      return null;
    }

    if (this.lastSentContent && fullContent.startsWith(this.lastSentContent)) {
      const delta = fullContent.slice(this.lastSentContent.length);
      this.lastSentContent = fullContent;
      return delta;
    }

    this.lastSentContent = fullContent;
    return fullContent;
  }

  setFinalResult(result: { text: string; isFinal: boolean }): void {
    this.finalResult = result;
  }

  getFinalResult(): { text: string; isFinal: boolean } | null {
    const result = this.finalResult;
    this.finalResult = null;
    return result;
  }

  getCurrentThinking(): string | null {
    return this.currentThinking || null;
  }

  reset(): void {
    this.lastSentContent = "";
    this.chronologicalOutput = "";
    this.currentThinking = "";
    this.finalResult = null;
    this.hasStreamedText = false;
  }
}
