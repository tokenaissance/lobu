#!/usr/bin/env bun

import { createLogger, verifyWorkerToken } from "@lobu/core";
import { Hono } from "hono";
import type { InteractionService } from "../../interactions";

const logger = createLogger("internal-interaction-routes");

type WorkerContext = {
  Variables: {
    worker: {
      userId: string;
      conversationId: string;
      channelId: string;
      teamId: string;
    };
  };
};

/**
 * Create internal interaction routes (Hono)
 */
export function createInteractionRoutes(
  interactionService: InteractionService
): Hono<WorkerContext> {
  const router = new Hono<WorkerContext>();

  // Worker authentication middleware
  const authenticateWorker = async (c: any, next: () => Promise<void>) => {
    const authHeader = c.req.header("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return c.json({ error: "Missing or invalid authorization" }, 401);
    }
    const workerToken = authHeader.substring(7);
    const tokenData = verifyWorkerToken(workerToken);
    if (!tokenData) {
      return c.json({ error: "Invalid worker token" }, 401);
    }
    c.set("worker", tokenData);
    await next();
  };

  /**
   * Post a question with button options (non-blocking)
   * POST /internal/interactions/create
   */
  router.post(
    "/internal/interactions/create",
    authenticateWorker,
    async (c) => {
      try {
        const worker = c.get("worker");
        const { userId, conversationId, channelId, teamId } = worker;
        const { question, options } = await c.req.json();

        logger.info(`Posting question for conversation ${conversationId}`);

        const posted = await interactionService.postQuestion(
          userId,
          conversationId,
          channelId,
          teamId,
          question,
          options || []
        );

        return c.json({ id: posted.id, status: "posted" });
      } catch (error) {
        logger.error("Failed to post question:", error);
        return c.json({ error: "Failed to post question" }, 500);
      }
    }
  );

  /**
   * Create non-blocking suggestions
   * POST /internal/suggestions/create
   */
  router.post("/internal/suggestions/create", authenticateWorker, async (c) => {
    try {
      const worker = c.get("worker");
      const { userId, conversationId, channelId, teamId } = worker;
      const { prompts } = await c.req.json();

      logger.info(
        `Sending suggestions to conversation ${conversationId} (${prompts.length} prompts)`
      );

      await interactionService.createSuggestion(
        userId,
        conversationId,
        channelId,
        teamId,
        prompts
      );

      return c.json({ success: true });
    } catch (error) {
      logger.error("Failed to send suggestions:", error);
      return c.json({ error: "Failed to send suggestions" }, 500);
    }
  });

  logger.info("Internal interaction routes registered");
  return router;
}
