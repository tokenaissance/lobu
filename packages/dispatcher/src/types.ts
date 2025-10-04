#!/usr/bin/env bun

import type { ClaudeExecutionOptions } from "@peerbot/shared";
import type { LogLevel } from "@slack/bolt";

export interface SlackConfig {
  token: string;
  appToken?: string;
  signingSecret?: string;
  socketMode?: boolean;
  port?: number;
  botUserId?: string;
  botId?: string;
  allowedUsers?: string[];
  allowedChannels?: string[];
  blockedUsers?: string[];
  blockedChannels?: string[];
  allowDirectMessages?: boolean;
  allowPrivateChannels?: boolean;
}

export interface QueueConfig {
  directMessage: string;
  messageQueue: string;
  connectionString: string;
  retryLimit?: number;
  retryDelay?: number;
  expireInHours?: number;
}

export interface AnthropicProxyConfig {
  enabled: boolean;
  anthropicApiKey: string;
  postgresConnectionString: string;
  anthropicBaseUrl?: string;
}

export interface DispatcherConfig {
  slack: SlackConfig;
  claude: Partial<ClaudeExecutionOptions>;
  sessionTimeoutMinutes: number;
  logLevel?: LogLevel;
  queues: QueueConfig;
  anthropicProxy: AnthropicProxyConfig; // Always required now
}

export interface SlackContext {
  channelId: string;
  userId: string;
  userDisplayName?: string;
  teamId: string;
  threadTs?: string;
  messageTs: string;
  text: string;
  messageUrl?: string;
}

export interface WorkerJobRequest {
  sessionKey: string;
  userId: string;
  username: string;
  channelId: string;
  threadTs?: string;
  userPrompt: string;
  repositoryUrl: string;
  slackResponseChannel: string;
  slackResponseTs: string;
  originalMessageTs?: string; // Original user message timestamp for reactions
  claudeOptions: ClaudeExecutionOptions;
  resumeSessionId?: string; // Claude session ID to resume from
}

export interface ThreadSession {
  sessionKey: string;
  threadTs?: string;
  channelId: string;
  userId: string;
  threadCreator?: string; // Track the original thread creator
  username: string;
  jobName?: string;
  repositoryUrl: string;
  lastActivity: number;
  status:
    | "pending"
    | "starting"
    | "running"
    | "completed"
    | "error"
    | "timeout";
  createdAt: number;
  botResponseTs?: string; // Bot's response message timestamp for updates
  messageReactions?: Map<string, string>; // Track reactions per message (messageTs -> reaction)
}

export interface UserRepository {
  username: string;
  repositoryName: string;
  repositoryUrl: string;
  cloneUrl: string;
  createdAt: number;
  lastUsed: number;
}
