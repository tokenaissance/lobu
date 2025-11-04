#!/usr/bin/env bun

import { createLogger } from "@peerbot/core";
import type { Request, Response, Router } from "express";
import multer from "multer";
import type { PlatformRegistry } from "../platform";

const logger = createLogger("messaging-routes");

// Configure multer for memory storage (files buffered in memory)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max
  },
});

/**
 * Register messaging HTTP routes
 * These are public endpoints for testing/automation
 */
export function registerMessagingRoutes(
  router: Router,
  platformRegistry: PlatformRegistry
): void {
  /**
   * Send a message via platform API
   * POST /api/messaging/send
   * Supports both JSON and multipart/form-data (for file uploads)
   */
  router.post(
    "/api/messaging/send",
    upload.array("files", 10), // Support up to 10 files
    async (req: Request, res: Response) => {
      try {
        // Extract Bearer token from Authorization header
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
          return res.status(401).json({
            success: false,
            error:
              "Missing or invalid Authorization header. Use: Authorization: Bearer <token>",
          });
        }
        const token = authHeader.substring(7);

        // Extract fields (works for both JSON and multipart)
        const platform = req.body.platform;
        const channel = req.body.channel;
        const message = req.body.message;
        const threadId = req.body.threadId;
        const files = req.files as Express.Multer.File[] | undefined;

        // Validate required fields
        if (!platform) {
          return res.status(400).json({
            success: false,
            error: "platform field is required",
          });
        }

        if (!channel) {
          return res.status(400).json({
            success: false,
            error: "channel field is required",
          });
        }

        if (!message) {
          return res.status(400).json({
            success: false,
            error: "message field is required",
          });
        }

        logger.info(
          `Sending message via ${platform} to channel ${channel}${files && files.length > 0 ? ` with ${files.length} file(s)` : ""}`
        );

        // Get platform adapter
        const adapter = platformRegistry.get(platform);
        if (!adapter) {
          return res.status(404).json({
            success: false,
            error: `Platform "${platform}" not found`,
            details: "Available platforms: slack",
          });
        }

        // Check if platform supports sendMessage
        if (!adapter.sendMessage) {
          return res.status(501).json({
            success: false,
            error: `Platform "${platform}" does not support sendMessage`,
          });
        }

        // Prepare options
        const options: {
          threadId?: string;
          files?: Array<{ buffer: Buffer; filename: string }>;
        } = {};

        if (threadId) {
          options.threadId = threadId;
        }

        if (files && files.length > 0) {
          options.files = files.map((file) => ({
            buffer: file.buffer,
            filename: file.originalname,
          }));
        }

        // Send message via platform
        const result = await adapter.sendMessage(
          token,
          channel,
          message,
          options
        );

        logger.info(
          `Message sent successfully: channel=${result.channel}, messageId=${result.messageId}, threadId=${result.threadId}`
        );

        // Return success response
        return res.json({
          success: true,
          channel: result.channel,
          messageId: result.messageId,
          threadId: result.threadId,
          threadUrl: result.threadUrl,
          queued: result.queued || false,
        });
      } catch (error) {
        logger.error("Failed to send message:", error);

        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";

        return res.status(500).json({
          success: false,
          error: "Failed to send message",
          details: errorMessage,
        });
      }
    }
  );

  logger.info("✅ Messaging routes registered");
}
