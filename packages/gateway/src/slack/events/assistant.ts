#!/usr/bin/env bun

import { createLogger } from "@peerbot/core";
import { Assistant } from "@slack/bolt";
import type { App } from "@slack/bolt";
import type { MessageHandler } from "./messages";
import type { SlackContext, WebClient } from "../types";
import type { MessageHandlerConfig } from "../config";

const logger = createLogger("slack-assistant");

/**
 * Setup Slack Assistant handlers to properly handle assistant threads
 * This allows the bot to respond to messages sent in Slack's native assistant UI
 */
export function setupAssistantHandlers(
  app: App,
  messageHandler: MessageHandler,
  config: MessageHandlerConfig
): void {
  logger.info("Setting up Slack Assistant handlers...");

  const assistant = new Assistant({
    // Called when a user starts a new assistant thread
    threadStarted: async ({ say, setSuggestedPrompts }) => {
      logger.info("Assistant thread started");

      // Set suggested prompts for the user
      await setSuggestedPrompts({
        prompts: [
          {
            title: "Create a project",
            message: "Create a new project",
          },
          {
            title: "Fix a bug",
            message: "Help me fix a bug",
          },
          {
            title: "Ask a question",
            message: "I have a question about my code",
          },
        ],
      });

      // Send welcome message
      await say(
        "👋 Hi! I'm Peerbot, your AI assistant. How can I help you today?"
      );
    },

    // Called when the context changes (e.g., user switches channels)
    threadContextChanged: async ({ saveThreadContext, event }) => {
      logger.info("Assistant thread context changed", {
        channelId: event.assistant_thread.channel_id,
        threadTs: event.assistant_thread.thread_ts,
      });

      // Save the new context
      await saveThreadContext();
    },

    // Called when a user sends a message in an assistant thread
    userMessage: async ({ client, message, say, setStatus, setTitle }) => {
      const assistantMessage = message as {
        channel: string;
        thread_ts?: string;
        ts: string;
        text: string;
        user: string;
        team_id?: string;
        files?: any[];
      };

      logger.info("Assistant user message received", {
        channel: assistantMessage.channel,
        threadTs: assistantMessage.thread_ts,
        user: assistantMessage.user,
        hasFiles: !!assistantMessage.files && assistantMessage.files.length > 0,
      });

      // Skip bot's own messages
      if (assistantMessage.user === config.slack.botUserId) {
        logger.info("Skipping bot's own message in assistant thread");
        return;
      }

      // Skip empty messages
      if (!assistantMessage.text || assistantMessage.text.trim() === "") {
        logger.info("Skipping empty message in assistant thread");
        return;
      }

      try {
        // Set status to show we're processing
        await setStatus("is thinking...");

        // Extract context for message handler
        const context: SlackContext = {
          channelId: assistantMessage.channel,
          userId: assistantMessage.user,
          teamId: assistantMessage.team_id || "",
          threadTs: assistantMessage.thread_ts,
          messageTs: assistantMessage.ts,
          text: assistantMessage.text || "",
          userDisplayName: "User", // We'll get the real name from Slack if needed
        };

        // Extract user request
        const userRequest = messageHandler.extractUserRequest(
          assistantMessage.text || ""
        );

        // Extract file metadata if files are attached
        const files = assistantMessage.files?.map((file: any) => ({
          id: file.id,
          name: file.name,
          mimetype: file.mimetype,
          size: file.size,
          url_private: file.url_private,
          url_private_download: file.url_private_download,
          timestamp: file.timestamp,
        }));

        if (files && files.length > 0) {
          logger.info(`Assistant message includes ${files.length} file(s)`);
        }

        // Set the thread title based on the user's message
        if (userRequest.length > 0 && userRequest.length < 100) {
          await setTitle(userRequest);
        }

        // Handle the message using the existing message handler
        await messageHandler.handleUserRequest(
          context,
          userRequest,
          client as WebClient,
          files
        );

        // Clear status after processing
        await setStatus("");
      } catch (error) {
        logger.error("Failed to process assistant message:", error);

        try {
          await setStatus("encountered an error");
          await say(
            `❌ Sorry, I encountered an error: ${error instanceof Error ? error.message : "Unknown error"}`
          );
        } catch (sayError) {
          logger.error("Failed to send error message:", sayError);
        }
      }
    },
  });

  // Register the assistant with the Slack app
  app.assistant(assistant);

  logger.info("✅ Slack Assistant handlers registered successfully");
}
