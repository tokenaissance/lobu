import { createLogger } from "@lobu/core";
import type { AnyBlock } from "@slack/types";
import type { WebClient } from "@slack/web-api";

const logger = createLogger("slack-message-helper");

type SlackTarget =
  | {
      type: "dm";
      userId: string;
      threadTs?: string;
    }
  | {
      type: "channel";
      channelId: string;
      threadTs?: string;
    };

export interface SlackMessagePayload {
  text: string;
  blocks?: AnyBlock[];
}

export async function sendSlackMessage(
  client: WebClient,
  target: SlackTarget,
  payload: SlackMessagePayload
) {
  if (target.type === "dm") {
    const im = await client.conversations.open({ users: target.userId });
    const channelId = im.channel?.id;

    if (!channelId) {
      logger.warn(`Failed to open DM for user ${target.userId}`);
      throw new Error("Unable to open direct message channel");
    }

    return client.chat.postMessage({
      channel: channelId,
      text: payload.text,
      blocks: payload.blocks,
      thread_ts: target.threadTs,
    });
  }

  return client.chat.postMessage({
    channel: target.channelId,
    text: payload.text,
    blocks: payload.blocks,
    thread_ts: target.threadTs,
  });
}
