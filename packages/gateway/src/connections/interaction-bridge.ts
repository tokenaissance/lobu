import { createLogger } from "@lobu/core";
import type {
  InteractionService,
  PostedGrantRequest,
  PostedLinkButton,
  PostedQuestion,
} from "../interactions";
import type { ChatInstanceManager } from "./chat-instance-manager";
import type { PlatformConnection } from "./types";

const logger = createLogger("chat-interaction-bridge");

// Deduplicate events across multiple connections for the same platform
const handledEvents = new Set<string>();
function markHandled(id: string): void {
  handledEvents.add(id);
  setTimeout(() => handledEvents.delete(id), 30_000);
}

export function registerInteractionBridge(
  interactionService: InteractionService,
  manager: ChatInstanceManager,
  connection: PlatformConnection,
  chat: any
): void {
  const { id: connectionId, platform } = connection;

  interactionService.on("question:created", async (event: PostedQuestion) => {
    if (!shouldHandle(event, platform, connectionId, manager)) return;
    if (handledEvents.has(event.id)) return;
    markHandled(event.id);

    const thread = await resolveThread(
      manager,
      connectionId,
      event.channelId,
      event.conversationId
    );
    if (!thread) return;

    try {
      const { Card, CardText, Actions, Button } = await import("chat");
      const buttons = event.options.map((option, i) =>
        Button({
          id: `question:${event.id}:${i}`,
          label: option,
          value: option,
        })
      );
      const card = Card({
        children: [CardText(event.question), Actions(buttons)],
      });
      await thread.post({
        card,
        fallbackText: `${event.question}\n${event.options.map((o, i) => `${i + 1}. ${o}`).join("\n")}`,
      });
    } catch (error) {
      logger.warn(
        { connectionId, error: String(error) },
        "Failed to post question interaction"
      );
      try {
        const fallback = `${event.question}\n${event.options.map((o, i) => `${i + 1}. ${o}`).join("\n")}`;
        await thread.post(fallback);
      } catch {
        // give up
      }
    }
  });

  interactionService.on(
    "grant:requested",
    async (event: PostedGrantRequest) => {
      if (!shouldHandle(event, platform, connectionId, manager)) return;
      if (handledEvents.has(event.id)) return;
      markHandled(event.id);

      const thread = await resolveThread(
        manager,
        connectionId,
        event.channelId,
        event.conversationId
      );
      if (!thread) return;

      try {
        const { Card, CardText, Actions, Button } = await import("chat");
        const domainList = event.domains.join(", ");
        const card = Card({
          children: [
            CardText(
              `*Access Request*\nDomains: ${domainList}\nReason: ${event.reason}`
            ),
            Actions([
              Button({
                id: `grant:${event.id}:approve`,
                label: "Approve",
                style: "primary",
                value: "approve",
              }),
              Button({
                id: `grant:${event.id}:deny`,
                label: "Deny",
                style: "danger",
                value: "deny",
              }),
            ]),
          ],
        });
        await thread.post({
          card,
          fallbackText: `Access Request\nDomains: ${domainList}\nReason: ${event.reason}`,
        });
      } catch (error) {
        logger.warn(
          { connectionId, error: String(error) },
          "Failed to post grant interaction"
        );
        try {
          await thread.post(
            `Access Request\nDomains: ${event.domains.join(", ")}\nReason: ${event.reason}\nReply "approve" or "deny".`
          );
        } catch {
          // give up
        }
      }
    }
  );

  interactionService.on(
    "link-button:created",
    async (event: PostedLinkButton) => {
      if (!shouldHandle(event, platform, connectionId, manager)) return;
      if (handledEvents.has(event.id)) return;
      markHandled(event.id);

      const thread = await resolveThread(
        manager,
        connectionId,
        event.channelId,
        event.conversationId
      );
      if (!thread) return;

      try {
        const { Card, CardText, Actions, LinkButton } = await import("chat");
        const card = Card({
          children: [
            CardText(event.label),
            Actions([LinkButton({ url: event.url, label: event.label })]),
          ],
        });
        await thread.post({
          card,
          fallbackText: `${event.label}: ${event.url}`,
        });
      } catch (error) {
        logger.warn(
          { connectionId, error: String(error) },
          "Failed to post link button interaction"
        );
        try {
          await thread.post(`${event.label}: ${event.url}`);
        } catch {
          // give up
        }
      }
    }
  );

  registerActionHandlers(chat, connection);

  logger.info({ connectionId, platform }, "Interaction bridge registered");
}

function registerActionHandlers(
  chat: any,
  connection: PlatformConnection
): void {
  chat.onAction(async (event: any) => {
    const actionId: string = event.actionId ?? "";
    const value: string = event.value ?? "";
    const thread = event.thread;

    if (!thread || !actionId) return;

    if (actionId.startsWith("question:") || actionId.startsWith("grant:")) {
      const responseText = value || actionId.split(":").pop() || "";
      try {
        await thread.post(responseText);
      } catch (error) {
        logger.debug(
          { connectionId: connection.id, error: String(error) },
          "Failed to post action response"
        );
      }
    }
  });
}

function shouldHandle(
  event: { teamId?: string; channelId: string; connectionId?: string },
  platform: string,
  connectionId: string,
  manager: ChatInstanceManager
): boolean {
  if (!manager.has(connectionId)) {
    logger.debug(
      { connectionId, eventConnectionId: event.connectionId },
      "shouldHandle: manager does not have connection"
    );
    return false;
  }
  if (event.teamId === "api") {
    logger.debug({ connectionId }, "shouldHandle: skipping api teamId");
    return false;
  }
  const instance = manager.getInstance(connectionId);
  if (!instance) {
    logger.debug({ connectionId }, "shouldHandle: no instance found");
    return false;
  }
  const matches = instance.connection.platform === platform;
  logger.debug({ connectionId, platform, matches }, "shouldHandle: result");
  if (!matches) {
    logger.debug(
      {
        connectionId,
        instancePlatform: instance.connection.platform,
        eventPlatform: platform,
      },
      "shouldHandle: platform mismatch"
    );
  }
  return matches;
}

async function resolveThread(
  manager: ChatInstanceManager,
  connectionId: string,
  channelId: string,
  conversationId: string
): Promise<any | null> {
  const instance = manager.getInstance(connectionId);
  if (!instance) {
    logger.debug({ connectionId }, "resolveThread: no instance for connection");
    return null;
  }

  try {
    const chat = instance.chat;
    const adapterKey = instance.connection.platform;

    // For DMs where conversationId === channelId, use channel directly
    // (matches resolveTarget fallback in chat-response-bridge)
    if (!conversationId || conversationId === channelId) {
      const channel = chat.channel?.(`${adapterKey}:${channelId}`);
      if (channel) return channel;
    }

    const thread = await chat.getThread?.(
      adapterKey,
      channelId,
      conversationId
    );
    if (!thread) {
      logger.debug(
        { connectionId, adapterKey, channelId, conversationId },
        "resolveThread: getThread returned null"
      );
    }
    return thread ?? null;
  } catch (error) {
    logger.debug(
      { connectionId, channelId, conversationId, error: String(error) },
      "Failed to resolve thread for interaction"
    );
    return null;
  }
}
