#!/usr/bin/env bun

/**
 * @peerbot/slack
 * Slack platform adapter for Peerbot
 *
 * Exports:
 * - SlackPlatform: Platform adapter for Gateway
 * - SlackInstructionProvider: Instruction provider for Worker
 * - Utilities: Block builders, converters, etc.
 */

// Configuration
export type {
  AgentOptions,
  MessageHandlerConfig,
  SlackConfig,
  SlackPlatformConfig,
} from "./config";
// Constants
export { SLACK } from "./config";
export type { ModuleButton } from "./converters/block-builder";

// Block Builders and Converters
export { SlackBlockBuilder } from "./converters/block-builder";
export { extractCodeBlockActions } from "./converters/blockkit";
export { convertMarkdownToSlack } from "./converters/markdown";
// Event Handlers (for advanced usage)
export { SlackEventHandlers } from "./event-router";
export { ActionHandler } from "./events/actions";
export { MessageHandler } from "./events/messages";
// Instruction Provider
export { SlackInstructionProvider } from "./instructions/provider";
// Platform Adapter
export { SlackPlatform } from "./platform";
// Types
export type {
  AnyBlock,
  Button,
  // Module types
  ModuleActionContext,
  // Action types
  SlackActionBody,
  // Core types
  SlackContext,
  // Message types
  SlackMessageEvent,
  // View types
  View,
  WebClient,
} from "./types";
// Utilities
export { isSelfGeneratedEvent } from "./utils";
