/**
 * WhatsApp interaction renderer.
 * Uses list messages with numbered text fallback.
 */

import {
  createLogger,
  type UserInteraction,
  type UserSuggestion,
} from "@termosdev/core";
import type { AnyMessageContent } from "@whiskeysockets/baileys";
import type { InteractionService } from "../interactions";
import {
  APPROVAL_OPTIONS,
  formatNumberedOptions,
  isApprovalInteraction,
  parseOptionResponse,
} from "../platform/interaction-utils";
import type { WhatsAppConfig } from "./config";
import type { BaileysClient } from "./connection/baileys-client";

const logger = createLogger("whatsapp-interactions");

/**
 * WhatsApp interaction renderer.
 */
const INTERACTION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// Maximum options for list messages (WhatsApp limit is 10)
const MAX_LIST_OPTIONS = 10;

// Use native list messages (more reliable than buttons, but may not work on all clients)
const USE_NATIVE_LIST = true;

export class WhatsAppInteractionRenderer {
  // Queue of pending interactions per chat (FIFO order)
  private pendingInteractions = new Map<
    string,
    Array<{
      interactionId: string;
      question: string;
      options: string[];
      chatJid: string;
    }>
  >();
  private interactionTimeouts = new Map<string, NodeJS.Timeout>();

  constructor(
    private client: BaileysClient,
    private interactionService: InteractionService,
    _config: WhatsAppConfig // Reserved for future configuration
  ) {}

  /**
   * Register handler for button/text responses.
   */
  registerButtonHandler(): void {
    // Listen for messages that might be responses to interactions
    this.client.on("message", async (upsert) => {
      if (upsert.type !== "notify") return;

      for (const msg of upsert.messages ?? []) {
        await this.handlePossibleResponse(msg);
      }
    });

    // Subscribe to interaction:created events to render them
    this.interactionService.on("interaction:created", (interaction) => {
      // Only handle WhatsApp interactions (teamId is "whatsapp" for WhatsApp messages)
      if (interaction.teamId !== "whatsapp") return;

      this.renderInteraction(interaction).catch((error) => {
        logger.error("Failed to render interaction:", error);
      });
    });

    logger.info("WhatsApp interaction button handler registered");
  }

  /**
   * Handle a possible response to an interaction.
   */
  private async handlePossibleResponse(msg: any): Promise<void> {
    const remoteJid = msg.key?.remoteJid;
    if (!remoteJid) return;

    // Check if there's a pending interaction queue for this chat
    const queue = this.pendingInteractions.get(remoteJid);
    if (!queue || queue.length === 0) return;

    // Get the first pending interaction (FIFO)
    const pending = queue[0];
    if (!pending) return;

    // Extract values before any queue modifications
    const { interactionId, options } = pending;

    // Extract response text
    const text = this.extractText(msg.message);
    if (!text) return;

    // Try to match the response
    const selectedIndex = this.parseResponse(text, options);
    if (selectedIndex === null) {
      // Invalid response, ask again
      await this.sendInvalidResponseMessage(remoteJid, options);
      return;
    }

    // Respond to the interaction
    const selectedOption = options[selectedIndex];
    try {
      await this.interactionService.respond(interactionId, {
        answer: selectedOption,
      });

      // Remove this interaction from queue
      queue.shift();

      // If queue is empty, clear timeout
      if (queue.length === 0) {
        this.pendingInteractions.delete(remoteJid);
        const timeout = this.interactionTimeouts.get(remoteJid);
        if (timeout) {
          clearTimeout(timeout);
          this.interactionTimeouts.delete(remoteJid);
        }
      } else {
        // Show the next pending interaction
        const nextPending = queue[0];
        if (nextPending) {
          const nextMessage = formatNumberedOptions(
            nextPending.question,
            nextPending.options
          );
          await this.client.sendMessage(remoteJid, { text: nextMessage });
        }
      }

      logger.info(
        { interactionId, selectedOption, remainingInQueue: queue.length },
        "Interaction response recorded"
      );
    } catch (err) {
      logger.error(
        { error: String(err), interactionId },
        "Failed to record interaction response"
      );
    }
  }

  /**
   * Parse user response to get selected option index.
   * Returns index (0-based) or null if invalid.
   */
  private parseResponse(text: string, options: string[]): number | null {
    const selected = parseOptionResponse(text, options);
    if (selected === null) {
      // Try partial match as fallback (WhatsApp-specific)
      const normalized = text.trim().toLowerCase();
      const partialIndex = options.findIndex(
        (opt) =>
          opt.toLowerCase().includes(normalized) ||
          normalized.includes(opt.toLowerCase())
      );
      if (partialIndex !== -1) {
        return partialIndex;
      }
      return null;
    }
    return options.indexOf(selected);
  }

  /**
   * Send invalid response message.
   */
  private async sendInvalidResponseMessage(
    chatJid: string,
    options: string[]
  ): Promise<void> {
    const message = formatNumberedOptions(
      "Invalid response. Please reply with a number:",
      options
    );
    await this.client.sendMessage(chatJid, { text: message });
  }

  /**
   * Render a user interaction.
   */
  async renderInteraction(interaction: UserInteraction): Promise<void> {
    const { id, channelId, interactionType, question, options } = interaction;

    // Get chat JID from metadata or channel
    const chatJid = (interaction as any).platformMetadata?.jid || channelId;

    logger.info(
      { interactionId: id, chatJid, interactionType },
      "Rendering interaction"
    );

    let optionsToStore: string[] | null = null;

    // Check if options is an array (radio) or object (form)
    const isRadioOptions = Array.isArray(options);

    // Determine the options to use
    let effectiveOptions: string[] = [];
    if (isRadioOptions && options.length > 0) {
      effectiveOptions = options;
      optionsToStore = options;
    } else if (isApprovalInteraction(interactionType)) {
      effectiveOptions = [...APPROVAL_OPTIONS];
      optionsToStore = effectiveOptions;
    }

    // Check if this is the first interaction in queue (only show first)
    const existingQueue = this.pendingInteractions.get(chatJid);
    const isFirstInQueue = !existingQueue || existingQueue.length === 0;

    // Store in queue if needed
    if (optionsToStore) {
      this.storePendingInteraction(chatJid, id, question, optionsToStore);
    }

    // Only send message if this is the first interaction in queue
    if (!isFirstInQueue) {
      logger.info(
        { interactionId: id, chatJid, queuePosition: existingQueue!.length },
        "Interaction queued (will show after previous is answered)"
      );
      return;
    }

    // Try to send as list message first, fall back to numbered text
    if (
      effectiveOptions.length > 0 &&
      effectiveOptions.length <= MAX_LIST_OPTIONS
    ) {
      const sent = await this.sendInteractionMessage(
        chatJid,
        question,
        effectiveOptions
      );
      if (sent) {
        logger.info({ interactionId: id, chatJid }, "Interaction rendered");
        return;
      }
    }

    // Fallback to numbered text
    let message: string;
    if (effectiveOptions.length > 0) {
      message = formatNumberedOptions(question, effectiveOptions);
    } else if (interactionType === "form") {
      message = `${question}\n\nPlease type your response:`;
    } else {
      message = question;
    }

    await this.client.sendMessage(chatJid, { text: message });
    logger.info(
      { interactionId: id, chatJid, fallback: true },
      "Interaction rendered (text fallback)"
    );
  }

  /**
   * Send interaction message, trying list message first.
   * Returns true if sent successfully, false if should fall back.
   */
  private async sendInteractionMessage(
    chatJid: string,
    question: string,
    options: string[]
  ): Promise<boolean> {
    if (!USE_NATIVE_LIST) {
      return false;
    }

    try {
      // Build list message
      const listContent: AnyMessageContent = {
        text: question,
        buttonText: "Choose Option",
        sections: [
          {
            title: "Options",
            rows: options.map((opt, i) => ({
              title: opt.length > 24 ? `${opt.substring(0, 21)}...` : opt,
              description: opt.length > 24 ? opt : undefined,
              rowId: String(i + 1),
            })),
          },
        ],
      } as any; // Baileys types may not include all list message fields

      await this.client.sendMessage(chatJid, listContent);
      return true;
    } catch (err) {
      logger.warn(
        { error: String(err), chatJid },
        "List message failed, falling back to numbered text"
      );
      return false;
    }
  }

  /**
   * Render suggestions.
   * WhatsApp doesn't have native suggestions, so we send as regular message.
   */
  async renderSuggestion(suggestion: UserSuggestion): Promise<void> {
    const { channelId, prompts } = suggestion;

    if (!prompts || prompts.length === 0) return;

    const chatJid = (suggestion as any).platformMetadata?.jid || channelId;

    // Build suggestion message
    const lines = ["Here are some suggestions:"];
    for (const s of prompts) {
      lines.push(`• ${s.title}`);
      if (s.message) {
        lines.push(`  ${s.message}`);
      }
    }

    const message = lines.join("\n");
    await this.client.sendMessage(chatJid, { text: message });

    logger.info(
      { chatJid, promptCount: prompts.length },
      "Suggestions rendered"
    );
  }

  /**
   * Store pending interaction in queue with timeout cleanup.
   */
  private storePendingInteraction(
    chatJid: string,
    interactionId: string,
    question: string,
    options: string[]
  ): void {
    // Get or create queue
    let queue = this.pendingInteractions.get(chatJid);
    if (!queue) {
      queue = [];
      this.pendingInteractions.set(chatJid, queue);
    }

    // Add to queue
    queue.push({
      interactionId,
      question,
      options,
      chatJid,
    });

    logger.info(
      { interactionId, chatJid, queueLength: queue.length },
      "Added interaction to queue"
    );

    // Reset timeout (extends on each new interaction)
    const existingTimeout = this.interactionTimeouts.get(chatJid);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    // Set timeout to auto-cleanup entire queue
    const timeout = setTimeout(() => {
      const currentQueue = this.pendingInteractions.get(chatJid);
      if (currentQueue && currentQueue.length > 0) {
        logger.warn(
          { chatJid, pendingCount: currentQueue.length },
          "Interaction queue timed out"
        );
      }
      this.pendingInteractions.delete(chatJid);
      this.interactionTimeouts.delete(chatJid);
    }, INTERACTION_TIMEOUT_MS);

    this.interactionTimeouts.set(chatJid, timeout);
  }

  /**
   * Extract text from message.
   * Handles plain text, list responses, button clicks, etc.
   */
  private extractText(message: any): string | undefined {
    if (!message) return undefined;

    // Try direct conversation
    if (message.conversation) {
      return message.conversation.trim();
    }

    // Try extended text
    if (message.extendedTextMessage?.text) {
      return message.extendedTextMessage.text.trim();
    }

    // Try list response (rowId is the index we set)
    if (message.listResponseMessage?.singleSelectReply?.selectedRowId) {
      return message.listResponseMessage.singleSelectReply.selectedRowId;
    }

    // Try button response
    if (message.buttonsResponseMessage?.selectedButtonId) {
      return message.buttonsResponseMessage.selectedButtonId;
    }

    // Try template button response
    if (message.templateButtonReplyMessage?.selectedId) {
      return message.templateButtonReplyMessage.selectedId;
    }

    // Try interactive response (newer format)
    if (
      message.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson
    ) {
      try {
        const params = JSON.parse(
          message.interactiveResponseMessage.nativeFlowResponseMessage
            .paramsJson
        );
        if (params.id) return params.id;
      } catch {
        // Ignore parse errors
      }
    }

    return undefined;
  }
}
