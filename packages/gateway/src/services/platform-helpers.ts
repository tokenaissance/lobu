/**
 * Shared platform helpers.
 * Extracts common logic duplicated across Slack, Telegram, and WhatsApp message handlers.
 */

import { createLogger } from "@lobu/core";
import type { AgentSettingsStore } from "../auth/settings";
import type { ChannelBindingService } from "../channels";
import type { MessagePayload } from "../infrastructure/queue/queue-producer";
import { resolveSpace } from "../spaces";

const logger = createLogger("platform-helpers");

/**
 * Resolve agent options by merging base options with per-agent settings.
 * Priority: agent settings > config defaults.
 */
export async function resolveAgentOptions(
  agentId: string,
  baseOptions: Record<string, any>,
  agentSettingsStore?: AgentSettingsStore
): Promise<Record<string, any>> {
  if (!agentSettingsStore) {
    return { ...baseOptions };
  }

  const settings = await agentSettingsStore.getSettings(agentId);
  if (!settings) {
    return { ...baseOptions };
  }

  logger.info({ agentId, model: settings.model }, "Applying agent settings");

  const mergedOptions: Record<string, any> = { ...baseOptions };

  if (settings.model) {
    mergedOptions.model = settings.model;
  } else if ((settings.installedProviders?.length ?? 0) > 0) {
    delete mergedOptions.model;
  }

  if (settings.networkConfig) {
    mergedOptions.networkConfig = settings.networkConfig;
  }
  if (settings.nixConfig) {
    mergedOptions.nixConfig = settings.nixConfig;
  }
  if (settings.toolsConfig) {
    mergedOptions.toolsConfig = settings.toolsConfig;
  }
  if (settings.mcpServers) {
    mergedOptions.mcpServers = settings.mcpServers;
  }
  if (settings.pluginsConfig) {
    mergedOptions.pluginsConfig = settings.pluginsConfig;
  }
  if (settings.verboseLogging !== undefined) {
    mergedOptions.verboseLogging = settings.verboseLogging;
  }

  return mergedOptions;
}

/**
 * Build a MessagePayload from common fields.
 * Extracts networkConfig, nixConfig, mcpServers from agentOptions before constructing the payload.
 */
export function buildMessagePayload(params: {
  platform: string;
  userId: string;
  botId: string;
  conversationId: string;
  teamId: string;
  agentId: string;
  messageId: string;
  messageText: string;
  channelId: string;
  platformMetadata: Record<string, any>;
  agentOptions: Record<string, any>;
}): MessagePayload {
  const { networkConfig, nixConfig, mcpServers, ...remainingOptions } =
    params.agentOptions;

  return {
    platform: params.platform,
    userId: params.userId,
    botId: params.botId,
    conversationId: params.conversationId,
    teamId: params.teamId,
    agentId: params.agentId,
    messageId: params.messageId,
    messageText: params.messageText,
    channelId: params.channelId,
    platformMetadata: params.platformMetadata,
    agentOptions: remainingOptions,
    networkConfig,
    nixConfig,
    mcpConfig: mcpServers ? { mcpServers } : undefined,
  };
}

/**
 * Resolve agent ID from channel binding or space fallback.
 * Returns the agentId and whether a config prompt was sent (caller should stop processing).
 */
export async function resolveAgentId(params: {
  platform: string;
  userId: string;
  channelId: string;
  isGroup: boolean;
  teamId?: string;
  channelBindingService?: ChannelBindingService;
  sendConfigPrompt: () => Promise<boolean>;
}): Promise<{ agentId: string; promptSent: boolean }> {
  const {
    platform,
    userId,
    channelId,
    isGroup,
    teamId,
    channelBindingService,
    sendConfigPrompt,
  } = params;

  if (channelBindingService) {
    const binding = await channelBindingService.getBinding(
      platform,
      channelId,
      teamId
    );
    if (binding) {
      logger.info({ agentId: binding.agentId, channelId }, "Using bound agent");
      return { agentId: binding.agentId, promptSent: false };
    }

    // No binding — send configuration prompt
    const sent = await sendConfigPrompt();
    if (sent) {
      return { agentId: "", promptSent: true };
    }

    // Fallback if config prompt fails
    const space = resolveSpace({ platform, userId, channelId, isGroup });
    logger.info({ agentId: space.agentId }, "Fallback resolved agentId");
    return { agentId: space.agentId, promptSent: false };
  }

  const space = resolveSpace({ platform, userId, channelId, isGroup });
  return { agentId: space.agentId, promptSent: false };
}
