import { createLogger } from "@termosdev/core";
import type { App } from "@slack/bolt";
import type { AnyBlock } from "@slack/types";
import type { WebClient } from "@slack/web-api";
import type { ModalViewWithState } from "../types";
import { sendSlackMessage } from "./message-utils";

const logger = createLogger("dispatcher");

export class ShortcutCommandHandler {
  constructor(private app: App) {}

  /**
   * Setup all shortcut and slash command handlers
   */
  setupHandlers(): void {
    this.setupShortcuts();
    this.setupSlashCommands();
    this.setupViewSubmissions();
  }

  /**
   * Handle text commands that mimic slash commands (for DMs)
   */
  async handleTextCommand(
    command: string,
    userId: string,
    channelId: string,
    client: WebClient,
    threadTs?: string
  ): Promise<void> {
    logger.info(`Handling text command '${command}' from user ${userId}`);

    // All text commands now use the unified context-aware welcome
    if (command === "welcome" || command === "login") {
      await this.sendContextAwareWelcome(userId, channelId, client, threadTs);
    } else {
      logger.warn(`Unknown text command: ${command}`);
    }
  }

  /**
   * Setup shortcut handlers for global shortcuts
   */
  private setupShortcuts(): void {
    logger.info("Setting up shortcut handlers...");

    const shortcutDefinitions: Array<{
      id: string;
      logLabel: string;
      message: string;
    }> = [
      {
        id: "develop_feature",
        logLabel: "Develop feature",
        message:
          "🚀 Ready to experiment with a new feature! Start by describing what you want to build.",
      },
      {
        id: "fix_bug",
        logLabel: "Fix bug",
        message:
          "🐛 Let's fix that bug! Describe the issue you're experiencing.",
      },
      {
        id: "ask_question",
        logLabel: "Ask question",
        message: "❓ What would you like to know about your codebase?",
      },
    ];

    for (const { id, logLabel, message } of shortcutDefinitions) {
      this.app.shortcut(id, async ({ ack, body, client }) => {
        await ack();
        const userId = body.user.id;
        logger.info(`${logLabel} shortcut triggered by ${userId}`);

        try {
          await sendSlackMessage(
            client as WebClient,
            { type: "dm", userId },
            { text: message }
          );
        } catch (error) {
          logger.error(
            `Failed to deliver ${logLabel.toLowerCase()} shortcut message for ${userId}`,
            error
          );
        }
      });
    }
  }

  /**
   * Setup slash command handlers
   */
  private setupSlashCommands(): void {
    logger.info("Setting up slash command handlers...");

    // Handle /termos command - always show context-aware welcome
    this.app.command("/termos", async ({ ack, body, client }) => {
      await ack();

      const { user_id, channel_id } = body;
      logger.info(
        `/termos command received from user=${user_id}, channel=${channel_id}`
      );

      // Send context-aware welcome message (no thread for slash commands)
      await this.sendContextAwareWelcome(user_id, channel_id, client as any);
    });
  }

  /**
   * Send a context-aware welcome message
   */
  public async sendContextAwareWelcome(
    userId: string,
    channelId: string,
    client: WebClient,
    threadTs?: string
  ): Promise<void> {
    // Build simple welcome blocks
    const blocks: AnyBlock[] = [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: "Welcome to Termos! 👋",
          emoji: true,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            "I'm your AI coding assistant powered by Claude. I can help you with:\n\n" +
            "• 💻 Writing and reviewing code\n" +
            "• 🔧 Building features and fixing bugs\n" +
            "• 📚 Understanding codebases\n" +
            "• 🚀 Creating new projects",
        },
      },
      {
        type: "divider",
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: "💡 *Quick Start:* Just @mention me or send me a direct message to start coding!",
          },
        ],
      },
    ];

    // Send as ephemeral message if in channel, regular if in DM
    const isDM = channelId.startsWith("D");

    if (isDM) {
      const messagePayload: {
        channel: string;
        text: string;
        blocks: AnyBlock[];
        thread_ts?: string;
      } = {
        channel: channelId,
        text: "Welcome to Termos! 👋",
        blocks,
      };

      // Add thread_ts if provided to respond in the same thread
      if (threadTs) {
        messagePayload.thread_ts = threadTs;
      }

      await client.chat.postMessage(messagePayload);
    } else {
      // postEphemeral is part of WebClient
      await client.chat.postEphemeral({
        channel: channelId,
        user: userId,
        text: "Welcome to Termos! 👋",
        blocks,
      });
    }
  }

  /**
   * Setup view submission handlers for modals
   */
  private setupViewSubmissions(): void {
    logger.info("Setting up view submission handlers...");

    // Handle environment variable modal submission
    this.app.view("set_environment", async ({ ack, body, view, client }) => {
      const userId = body.user.id;

      try {
        await this.handleSetEnvironment(
          userId,
          view as ModalViewWithState,
          client
        );
        await ack();
      } catch (error) {
        logger.error("Error setting environment:", error);
        await ack({
          response_action: "errors",
          errors: { env_input: "Failed to save environment variables" },
        });
      }
    });
  }

  /**
   * Handle environment variable setting
   */
  private async handleSetEnvironment(
    userId: string,
    view: ModalViewWithState,
    client: WebClient
  ): Promise<void> {
    try {
      // Extract input values
      const inputs = this.extractViewInputs(view.state.values);
      const envVars = this.parseEnvironmentVariables(inputs);

      // Environment variables are not stored anymore
      // Workers use system environment variables only
      logger.info(
        `Environment variable submission received for user ${userId} (${Object.keys(envVars).length} vars) - feature disabled`
      );

      // Send confirmation
      const im = await client.conversations.open({ users: userId });
      if (im.channel?.id) {
        await client.chat.postMessage({
          channel: im.channel.id,
          text: `✅ Environment variables saved successfully:\n${Object.keys(envVars).join(", ")}`,
        });
      }
    } catch (error) {
      logger.error(`Failed to save environment variables:`, error);
      throw error;
    }
  }

  /**
   * Extract view inputs from Slack modal state
   */
  private extractViewInputs(
    stateValues: Record<string, Record<string, { value?: string }>>
  ): string {
    const inputs: string[] = [];

    for (const blockId of Object.keys(stateValues)) {
      const block = stateValues[blockId];
      if (!block) continue;

      for (const actionId of Object.keys(block)) {
        const action = block[actionId];
        if (!action) continue;

        if (action.value) {
          inputs.push(action.value);
        }
      }
    }

    return inputs.join("\n");
  }

  /**
   * Parse environment variables from input text
   */
  private parseEnvironmentVariables(input: string): Record<string, string> {
    const envVars: Record<string, string> = {};
    const lines = input.split("\n");

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed?.includes("=")) {
        const [key, ...valueParts] = trimmed.split("=");
        const value = valueParts.join("=");
        if (key && value) {
          envVars[key.trim()] = value.trim();
        }
      }
    }

    return envVars;
  }
}
