#!/usr/bin/env bun

import {
  createLogger,
  type FieldSchema,
  type UserInteraction,
  type UserSuggestion,
} from "@peerbot/core";
import type { WebClient } from "@slack/web-api";
import type { Block } from "@slack/types";
import type { InteractionService } from "../interactions";
import { convertMarkdownToSlack } from "./converters/markdown";

const logger = createLogger("slack-interactions");

// ============================================================================
// SHARED UTILITIES
// ============================================================================

/**
 * Determine interaction type from options
 */
function getInteractionType(
  options: any
): "radio" | "single-form" | "multi-section" {
  if (Array.isArray(options)) {
    // Check if it's an array of strings (simple radio) or array of form objects (multi-section)
    if (options.length === 0) {
      return "radio";
    }

    const firstItem = options[0];

    // Multi-form workflow: Array<{label: string, fields: Record<string, FieldSchema>}>
    if (
      typeof firstItem === "object" &&
      firstItem !== null &&
      "label" in firstItem &&
      "fields" in firstItem
    ) {
      // If there's only one section, treat it as single-form (no need for section navigation)
      return options.length === 1 ? "single-form" : "multi-section";
    }

    // Simple radio buttons: string[]
    return "radio";
  }

  // Check if it's a single form (Record<string, FieldSchema>)
  const firstValue = Object.values(options)[0];
  if (firstValue && typeof firstValue === "object" && "type" in firstValue) {
    return "single-form"; // Record<string, FieldSchema>
  }

  // Multi-section form (Record<string, Record<string, FieldSchema>>)
  return "multi-section";
}

/**
 * Build Slack input block from field schema
 */
function buildFieldBlock(
  fieldName: string,
  fieldSchema: FieldSchema,
  value?: any
): any {
  const label =
    fieldSchema.label || fieldName.charAt(0).toUpperCase() + fieldName.slice(1);
  const blockId = `field_${fieldName}`;

  if (fieldSchema.type === "text" || fieldSchema.type === "textarea") {
    return {
      type: "input",
      block_id: blockId,
      element: {
        type: "plain_text_input",
        action_id: fieldName,
        placeholder: fieldSchema.placeholder
          ? { type: "plain_text", text: fieldSchema.placeholder }
          : undefined,
        multiline: fieldSchema.type === "textarea",
        initial_value: value || undefined,
      },
      label: { type: "plain_text", text: label },
      optional: !fieldSchema.required,
    };
  }

  if (fieldSchema.type === "select") {
    return {
      type: "input",
      block_id: blockId,
      element: {
        type: "static_select",
        action_id: fieldName,
        options: (fieldSchema.options || []).map((opt: string) => ({
          text: { type: "plain_text", text: opt },
          value: opt,
        })),
        placeholder: {
          type: "plain_text",
          text: fieldSchema.placeholder || "Select an option",
        },
        initial_option: value
          ? {
              text: { type: "plain_text", text: value },
              value: value,
            }
          : undefined,
      },
      label: { type: "plain_text", text: label },
      optional: !fieldSchema.required,
    };
  }

  if (fieldSchema.type === "number") {
    return {
      type: "input",
      block_id: blockId,
      element: {
        type: "plain_text_input",
        action_id: fieldName,
        placeholder: fieldSchema.placeholder
          ? { type: "plain_text", text: fieldSchema.placeholder }
          : undefined,
        initial_value: value !== undefined ? String(value) : undefined,
      },
      label: { type: "plain_text", text: label },
      optional: !fieldSchema.required,
    };
  }

  if (fieldSchema.type === "checkbox") {
    return {
      type: "input",
      block_id: blockId,
      element: {
        type: "checkboxes",
        action_id: fieldName,
        options: [
          {
            text: { type: "plain_text", text: label },
            value: "true",
          },
        ],
        initial_options: value
          ? [
              {
                text: { type: "plain_text", text: label },
                value: "true",
              },
            ]
          : undefined,
      },
      label: { type: "plain_text", text: label },
      optional: !fieldSchema.required,
    };
  }

  if (fieldSchema.type === "multiselect") {
    return {
      type: "input",
      block_id: blockId,
      element: {
        type: "multi_static_select",
        action_id: fieldName,
        options: (fieldSchema.options || []).map((opt: string) => ({
          text: { type: "plain_text", text: opt },
          value: opt,
        })),
        placeholder: {
          type: "plain_text",
          text: fieldSchema.placeholder || "Select options",
        },
        initial_options:
          value && Array.isArray(value)
            ? value.map((v: string) => ({
                text: { type: "plain_text", text: v },
                value: v,
              }))
            : undefined,
      },
      label: { type: "plain_text", text: label },
      optional: !fieldSchema.required,
    };
  }

  throw new Error(`Unsupported field type: ${fieldSchema.type}`);
}

/**
 * Build disabled field display (after submission)
 */
function buildDisabledFieldDisplay(
  fieldName: string,
  value: any,
  label?: string
): string | null {
  // Skip null, undefined, or empty values
  if (value === null || value === undefined || value === "") {
    return null;
  }

  // Skip empty arrays
  if (Array.isArray(value) && value.length === 0) {
    return null;
  }

  const displayLabel =
    label || fieldName.charAt(0).toUpperCase() + fieldName.slice(1);
  const displayValue = Array.isArray(value) ? value.join(", ") : String(value);
  return `> *${displayLabel}:* ${displayValue}`;
}

/**
 * Extract form data from Slack input state
 */
function extractFormData(stateValues: any): Record<string, any> {
  const formData: Record<string, any> = {};

  for (const [blockId, block] of Object.entries(stateValues)) {
    if (!blockId.startsWith("field_")) continue;

    const fieldName = blockId.replace("field_", "");
    const actionValue = Object.values(block as any)[0] as any;

    if (!actionValue) continue;

    // Handle different input types
    if (actionValue.type === "plain_text_input") {
      const value = actionValue.value;
      // Convert string "null" or empty strings to actual null
      formData[fieldName] = value === "null" || value === "" ? null : value;
    } else if (actionValue.type === "static_select") {
      formData[fieldName] = actionValue.selected_option?.value;
    } else if (actionValue.type === "multi_static_select") {
      formData[fieldName] =
        actionValue.selected_options?.map((opt: any) => opt.value) || [];
    } else if (actionValue.type === "checkboxes") {
      formData[fieldName] = actionValue.selected_options?.length > 0;
    }
  }

  return formData;
}

// ============================================================================
// SLACK INTERACTION RENDERER
// ============================================================================

export class SlackInteractionRenderer {
  constructor(
    private client: WebClient,
    private interactionService: InteractionService
  ) {
    this.interactionService.on(
      "interaction:created",
      (interaction: UserInteraction) => {
        this.renderInteraction(interaction).catch((error) => {
          logger.error("Failed to render interaction:", error);
        });
      }
    );

    this.interactionService.on(
      "suggestion:created",
      (suggestion: UserSuggestion) => {
        this.renderSuggestion(suggestion).catch((error) => {
          logger.error("Failed to render suggestion:", error);
        });
      }
    );

    this.interactionService.on(
      "interaction:responded",
      (interaction: UserInteraction) => {
        if (interaction.response) {
          this.updateInteractionMessage(interaction).catch((error) => {
            logger.error("Failed to update interaction message:", error);
          });
        }
      }
    );
  }

  /**
   * Render interaction inline
   */
  async renderInteraction(interaction: UserInteraction): Promise<void> {
    logger.info(`Rendering interaction ${interaction.id}`);

    const type = getInteractionType(interaction.options);
    const blocks = this.buildBlocks(interaction, type);

    const result = await this.client.chat.postMessage({
      channel: interaction.channelId,
      thread_ts: interaction.threadId,
      text: blocks.text,
      blocks: blocks.blocks,
    });

    if (result.ts) {
      await this.interactionService.setMessageTs(interaction.id, result.ts);
    }

    await this.setThreadStatus(interaction.channelId, interaction.threadId, "");
  }

  /**
   * Render suggestions
   */
  async renderSuggestion(suggestion: UserSuggestion): Promise<void> {
    try {
      await this.client.assistant.threads.setSuggestedPrompts({
        channel_id: suggestion.channelId,
        thread_ts: suggestion.threadId,
        prompts: suggestion.prompts.map((p) => ({
          title: p.title,
          message: p.message,
        })),
      });
    } catch (error) {
      logger.warn("Failed to set suggested prompts:", error);
    }
  }

  /**
   * Build blocks based on interaction type
   */
  private buildBlocks(
    interaction: UserInteraction,
    type: "radio" | "single-form" | "multi-section"
  ): { text: string; blocks: Block[] } {
    const question = convertMarkdownToSlack(interaction.question);

    if (type === "radio") {
      return this.buildRadioBlocks(interaction, question);
    }

    if (type === "single-form") {
      return this.buildSingleFormBlocks(interaction, question);
    }

    return this.buildMultiSectionBlocks(interaction, question);
  }

  /**
   * Build inline radio buttons (simple choice)
   */
  private buildRadioBlocks(
    interaction: UserInteraction,
    question: string
  ): { text: string; blocks: Block[] } {
    const options = interaction.options as string[];

    const blocks: any[] = [
      {
        type: "section",
        text: { type: "mrkdwn", text: question },
      },
    ];

    // If this is a tool approval interaction, show the tool input as a code block
    if (interaction.metadata?.toolInput) {
      const toolInput = interaction.metadata.toolInput;
      let codeBlock = "";

      if (typeof toolInput === "string") {
        codeBlock = toolInput;
      } else if (typeof toolInput === "object") {
        // Format object as JSON or extract command field for Bash
        if (toolInput.command) {
          codeBlock = toolInput.command;
          if (toolInput.description) {
            codeBlock = `# ${toolInput.description}\n${toolInput.command}`;
          }
        } else {
          codeBlock = JSON.stringify(toolInput, null, 2);
        }
      }

      if (codeBlock) {
        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `\`\`\`\n${codeBlock}\n\`\`\``,
          },
        });
      }
    }

    blocks.push({
      type: "actions",
      elements: [
        {
          type: "radio_buttons",
          action_id: `radio_${interaction.id}`,
          options: options.map((opt, idx) => ({
            text: {
              type: "plain_text",
              text: opt.length > 75 ? `${opt.substring(0, 72)}...` : opt,
            },
            value: `${idx}`,
          })),
        },
      ],
    });

    return { text: question, blocks };
  }

  /**
   * Build inline single form with submit button
   */
  private buildSingleFormBlocks(
    interaction: UserInteraction,
    question: string
  ): { text: string; blocks: Block[] } {
    // Handle both formats: direct Record or array with one item
    let fields: Record<string, FieldSchema>;

    if (
      Array.isArray(interaction.options) &&
      interaction.options.length === 1
    ) {
      const firstItem = interaction.options[0];
      if (
        typeof firstItem === "object" &&
        firstItem !== null &&
        "fields" in firstItem
      ) {
        fields = (
          firstItem as { label: string; fields: Record<string, FieldSchema> }
        ).fields;
      } else {
        fields = {};
      }
    } else {
      fields = interaction.options as Record<string, FieldSchema>;
    }

    const blocks: any[] = [
      {
        type: "section",
        text: { type: "mrkdwn", text: question },
      },
    ];

    // Add input blocks
    for (const [fieldName, fieldSchema] of Object.entries(fields)) {
      blocks.push(buildFieldBlock(fieldName, fieldSchema));
    }

    // Add submit button
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Submit" },
          action_id: `submit_${interaction.id}`,
          value: "submit",
          style: "primary",
        },
      ],
    });

    return { text: question, blocks };
  }

  /**
   * Build inline multi-section form with section buttons
   */
  private buildMultiSectionBlocks(
    interaction: UserInteraction,
    question: string
  ): { text: string; blocks: Block[] } {
    // Handle both formats: array of {label, fields} or object with section names
    let sections: Record<string, Record<string, FieldSchema>>;

    if (Array.isArray(interaction.options)) {
      // Convert array format to object format
      sections = {};
      for (const item of interaction.options) {
        // Type guard: check if item has label and fields properties
        if (
          typeof item === "object" &&
          item !== null &&
          "label" in item &&
          "fields" in item
        ) {
          const formItem = item as {
            label: string;
            fields: Record<string, FieldSchema>;
          };
          sections[formItem.label] = formItem.fields;
        }
      }
    } else {
      sections = interaction.options as Record<
        string,
        Record<string, FieldSchema>
      >;
    }

    const sectionNames = Object.keys(sections);
    const activeSection: string = interaction.activeSection || sectionNames[0]!;
    const activeSectionIndex = sectionNames.indexOf(activeSection);
    const isLastSection = activeSectionIndex === sectionNames.length - 1;

    const blocks: any[] = [
      {
        type: "section",
        text: { type: "mrkdwn", text: question },
      },
    ];

    // Only show section buttons and divider if there are multiple sections
    if (sectionNames.length > 1) {
      blocks.push(
        {
          type: "actions",
          elements: sectionNames.map((sectionName) => ({
            type: "button",
            text: {
              type: "plain_text",
              text: `${interaction.partialData?.[sectionName] ? "✓ " : ""}${sectionName}`,
            },
            action_id: `section_${interaction.id}_${sectionName}`,
            value: sectionName,
            style: sectionName === activeSection ? "primary" : undefined,
          })),
        },
        { type: "divider" }
      );
    }

    // Add fields for active section
    const activeFields = sections[activeSection] || {};
    const savedData = interaction.partialData?.[activeSection];

    for (const [fieldName, fieldSchema] of Object.entries(activeFields) as [
      string,
      FieldSchema,
    ][]) {
      blocks.push(
        buildFieldBlock(fieldName, fieldSchema, savedData?.[fieldName])
      );
    }

    // Add navigation buttons
    const navElements: any[] = [];

    // Only show "Next" button if there are multiple sections and not on last section
    if (sectionNames.length > 1 && !isLastSection) {
      navElements.push({
        type: "button",
        text: { type: "plain_text", text: "Next →" },
        action_id: `next_${interaction.id}`,
        value: sectionNames[activeSectionIndex + 1],
        style: "primary",
      });
    }

    // Submit button text: "Submit All" only if multiple sections and on last section
    const submitButtonText =
      sectionNames.length > 1 && isLastSection ? "Submit All" : "Submit";
    navElements.push({
      type: "button",
      text: { type: "plain_text", text: submitButtonText },
      action_id: `submit_${interaction.id}`,
      value: "submit",
      style: sectionNames.length === 1 || isLastSection ? "primary" : undefined,
    });

    blocks.push({
      type: "actions",
      elements: navElements,
    });

    return { text: question, blocks };
  }

  /**
   * Update message after user responds (show disabled fields + confirmation)
   */
  async updateInteractionMessage(interaction: UserInteraction): Promise<void> {
    const messageTs = await this.interactionService.getMessageTs(
      interaction.id
    );
    if (!messageTs) {
      logger.warn(`No message timestamp for interaction ${interaction.id}`);
      return;
    }

    const type = getInteractionType(interaction.options);
    const question = convertMarkdownToSlack(interaction.question);

    const blocks: any[] = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: question,
        },
      },
    ];

    // Show response based on type
    if (type === "radio") {
      // Simple answer as blockquote
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `> ${interaction.response?.answer}`,
        },
      });
    } else if (type === "single-form") {
      // Show form data as disabled fields
      // Handle both formats: direct Record or array with one item
      let fields: Record<string, FieldSchema>;

      if (
        Array.isArray(interaction.options) &&
        interaction.options.length === 1
      ) {
        const firstItem = interaction.options[0];
        if (
          typeof firstItem === "object" &&
          firstItem !== null &&
          "fields" in firstItem
        ) {
          fields = (
            firstItem as { label: string; fields: Record<string, FieldSchema> }
          ).fields;
        } else {
          fields = {};
        }
      } else {
        fields = interaction.options as Record<string, FieldSchema>;
      }

      const formData = interaction.response?.formData || {};

      const fieldDisplays = Object.entries(fields)
        .map(([fieldName, fieldSchema]) =>
          buildDisabledFieldDisplay(
            fieldName,
            formData[fieldName],
            fieldSchema.label
          )
        )
        .filter((d): d is string => d !== null);

      if (fieldDisplays.length > 0) {
        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: fieldDisplays.join("\n"),
          },
        });
      }
    } else {
      // Multi-section: show all sections data
      const sections = Array.isArray(interaction.options)
        ? Object.fromEntries(
            (
              interaction.options as unknown as Array<{
                label: string;
                fields: Record<string, FieldSchema>;
              }>
            ).map((item) => [item.label, item.fields])
          )
        : (interaction.options as Record<string, Record<string, FieldSchema>>);

      const allData = interaction.response?.formData || {};

      for (const [sectionName, fields] of Object.entries(sections)) {
        const sectionData = allData[sectionName] || {};
        const fieldDisplays = Object.entries(fields)
          .map(([fieldName, fieldSchema]) =>
            buildDisabledFieldDisplay(
              fieldName,
              sectionData[fieldName],
              fieldSchema.label
            )
          )
          .filter((d): d is string => d !== null);

        if (fieldDisplays.length > 0) {
          blocks.push({
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*${sectionName}*\n${fieldDisplays.join("\n")}`,
            },
          });
        }
      }
    }

    // Add "Submitted by" footer - use respondedByUserId if available, otherwise use original userId
    const submittedByUserId =
      (interaction as any).respondedByUserId || interaction.userId;
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `✓ Submitted by <@${submittedByUserId}>`,
        },
      ],
    });

    await this.client.chat.update({
      channel: interaction.channelId,
      ts: messageTs,
      text: `Submitted`,
      blocks,
    });

    await this.setThreadStatus(
      interaction.channelId,
      interaction.threadId,
      null
    );
  }

  /**
   * Set thread status (or clear if null)
   */
  async setThreadStatus(
    channelId: string,
    threadId: string,
    status: string | null
  ): Promise<void> {
    try {
      await this.client.assistant.threads.setStatus({
        channel_id: channelId,
        thread_ts: threadId,
        status: status || "",
      });
    } catch (error) {
      logger.warn("Failed to set thread status:", error);
    }
  }
}

// ============================================================================
// INTERACTION HANDLERS
// ============================================================================

export function registerInteractionHandlers(
  app: any,
  interactionService: InteractionService,
  renderer: SlackInteractionRenderer
): void {
  // Radio button selection (auto-submit)
  app.action(/^radio_(.+)$/, async ({ ack, action, body }: any) => {
    await ack();

    const matches = action.action_id.match(/^radio_(.+)$/);
    if (!matches) return;

    const [_, interactionId] = matches;
    const interaction = await interactionService.getInteraction(interactionId);
    if (!interaction) return;

    const selectedIndex = parseInt(action.selected_option.value, 10);
    const options = interaction.options as string[];
    const answer = options[selectedIndex];

    if (!answer) {
      logger.warn(`Invalid option index ${selectedIndex}`);
      return;
    }

    // Pass the actual user who clicked the button
    const clickedByUserId = body.user?.id;
    await interactionService.respond(
      interactionId,
      { answer },
      clickedByUserId
    );
  });

  // Section button click (multi-section only)
  app.action(
    /^section_(.+)_(.+)$/,
    async ({ ack, action, body, client }: any) => {
      await ack();

      const matches = action.action_id.match(/^section_(.+)_(.+)$/);
      if (!matches) return;

      const [_, interactionId, sectionName] = matches;

      // Extract current section data from state
      const currentData = extractFormData(body.state?.values || {});
      const interaction =
        await interactionService.getInteraction(interactionId);
      if (!interaction) return;

      // Save current section data
      if (interaction.activeSection && Object.keys(currentData).length > 0) {
        await interactionService.savePartialData(
          interactionId,
          interaction.activeSection,
          currentData
        );
      }

      // Update active section
      await interactionService.setActiveSection(interactionId, sectionName);

      // Re-fetch and re-render
      const updatedInteraction =
        await interactionService.getInteraction(interactionId);
      if (updatedInteraction) {
        const messageTs = await interactionService.getMessageTs(interactionId);
        if (messageTs) {
          const type = getInteractionType(updatedInteraction.options);
          const question = convertMarkdownToSlack(updatedInteraction.question);
          const blocks =
            type === "multi-section"
              ? (renderer as any).buildMultiSectionBlocks(
                  updatedInteraction,
                  question
                )
              : { text: question, blocks: [] };

          await client.chat.update({
            channel: updatedInteraction.channelId,
            ts: messageTs,
            text: blocks.text,
            blocks: blocks.blocks,
          });
        }
      }
    }
  );

  // Next button (multi-section only)
  app.action(/^next_(.+)$/, async ({ ack, action, body, client }: any) => {
    await ack();

    const matches = action.action_id.match(/^next_(.+)$/);
    if (!matches) return;

    const [_, interactionId] = matches;
    const nextSection = action.value;

    // Extract current section data
    const currentData = extractFormData(body.state?.values || {});
    const interaction = await interactionService.getInteraction(interactionId);
    if (!interaction) return;

    // Save current section
    if (interaction.activeSection) {
      await interactionService.savePartialData(
        interactionId,
        interaction.activeSection,
        currentData
      );
    }

    // Update active section
    await interactionService.setActiveSection(interactionId, nextSection);

    // Re-fetch and re-render
    const updatedInteraction =
      await interactionService.getInteraction(interactionId);
    if (updatedInteraction) {
      const messageTs = await interactionService.getMessageTs(interactionId);
      if (messageTs) {
        const type = getInteractionType(updatedInteraction.options);
        const question = convertMarkdownToSlack(updatedInteraction.question);
        const blocks =
          type === "multi-section"
            ? (renderer as any).buildMultiSectionBlocks(
                updatedInteraction,
                question
              )
            : { text: question, blocks: [] };

        await client.chat.update({
          channel: updatedInteraction.channelId,
          ts: messageTs,
          text: blocks.text,
          blocks: blocks.blocks,
        });
      }
    }
  });

  // Submit button (single-form & multi-section)
  app.action(/^submit_(.+)$/, async ({ ack, action, body }: any) => {
    logger.info(`Submit button clicked: ${action.action_id}`);
    await ack();

    const matches = action.action_id.match(/^submit_(.+)$/);
    if (!matches) {
      logger.warn(`Submit action didn't match pattern: ${action.action_id}`);
      return;
    }

    const [_, interactionId] = matches;
    logger.info(`Processing submit for interaction: ${interactionId}`);

    const interaction = await interactionService.getInteraction(interactionId);
    if (!interaction) {
      logger.warn(`Interaction not found: ${interactionId}`);
      return;
    }

    const type = getInteractionType(interaction.options);
    logger.info(`Interaction type: ${type}`);

    // Pass the actual user who clicked the button
    const clickedByUserId = body.user?.id;

    if (type === "single-form") {
      // Extract and submit single form data
      const formData = extractFormData(body.state?.values || {});
      logger.info(`Submitting single form data: ${JSON.stringify(formData)}`);
      await interactionService.respond(
        interactionId,
        { formData },
        clickedByUserId
      );
    } else if (type === "multi-section") {
      // Extract current section data
      const currentData = extractFormData(body.state?.values || {});
      logger.info(`Current section data: ${JSON.stringify(currentData)}`);

      // Save current section
      if (interaction.activeSection) {
        logger.info(`Saving data for section: ${interaction.activeSection}`);
        await interactionService.savePartialData(
          interactionId,
          interaction.activeSection,
          currentData
        );
      }

      // Submit all collected data
      logger.info(`Submitting all forms for interaction: ${interactionId}`);
      await interactionService.submitAllForms(interactionId, clickedByUserId);
    }
  });
}
