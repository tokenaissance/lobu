import { createLogger, verifyWorkerToken } from "@peerbot/core";
import type { Request, Response } from "express";
import { Router } from "express";
import type { FileHandler } from "../services/file-handler";
import type { ISessionManager } from "../session";
import multer from "multer";
import { Readable } from "node:stream";

const logger = createLogger("file-routes");

// Configure multer for memory storage (streaming)
const upload = multer({
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB max
  },
});

/**
 * Create internal file routes for worker file operations
 */
export function createFileRoutes(
  fileHandler: FileHandler,
  _sessionManager: ISessionManager
): Router {
  const router = Router();

  /**
   * Download file endpoint for workers
   * GET /internal/files/download?fileId=xxx
   */
  router.get("/download", async (req: Request, res: Response) => {
    try {
      const { fileId } = req.query;
      const authHeader = req.headers.authorization;

      if (!fileId || typeof fileId !== "string") {
        return res.status(400).json({ error: "Missing fileId parameter" });
      }

      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res
          .status(401)
          .json({ error: "Missing or invalid authorization" });
      }

      const workerToken = authHeader.substring(7);

      // Validate worker token
      const tokenData = verifyWorkerToken(workerToken);
      if (!tokenData) {
        return res.status(401).json({ error: "Invalid worker token" });
      }

      logger.info(
        `Worker downloading file ${fileId} for thread ${tokenData.threadId}`
      );

      // Get Slack bot token from environment
      const slackToken = process.env.SLACK_BOT_TOKEN;
      if (!slackToken) {
        return res.status(500).json({ error: "Slack token not configured" });
      }

      // Download file from Slack
      const { stream, metadata } = await fileHandler.downloadFile(
        fileId,
        slackToken
      );

      // Set appropriate headers
      res.setHeader(
        "Content-Type",
        metadata.mimetype || "application/octet-stream"
      );
      res.setHeader("Content-Length", metadata.size.toString());
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${metadata.name}"`
      );

      // Stream file to worker
      stream.pipe(res);
    } catch (error) {
      logger.error("Failed to download file:", error);
      res.status(500).json({ error: "Failed to download file" });
    }
  });

  /**
   * Upload file endpoint for workers
   * POST /internal/files/upload
   */
  router.post(
    "/upload",
    upload.single("file"),
    async (req: Request, res: Response) => {
      try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith("Bearer ")) {
          return res
            .status(401)
            .json({ error: "Missing or invalid authorization" });
        }

        // Get channelId and threadId from headers
        const channelId = req.headers["x-channel-id"] as string;
        const threadId = req.headers["x-thread-id"] as string;

        if (!channelId || !threadId) {
          return res
            .status(400)
            .json({ error: "Missing channel or thread ID" });
        }

        if (!req.file) {
          return res.status(400).json({ error: "No file provided" });
        }

        const workerToken = authHeader.substring(7);

        // Validate worker token
        const tokenData = verifyWorkerToken(workerToken);
        if (!tokenData) {
          return res.status(401).json({ error: "Invalid worker token" });
        }

        const filename = req.body.filename || req.file.originalname;
        const initialComment = req.body.comment;

        logger.info(
          `Worker uploading file ${filename} for thread ${tokenData.threadId} to Slack thread ${threadId}`
        );

        // Convert buffer to stream
        const fileStream = Readable.from(req.file.buffer);

        // Upload to Slack
        const result = await fileHandler.uploadFile(fileStream, {
          filename,
          channelId,
          threadTs: threadId,
          initialComment,
        });

        logger.info(`File uploaded successfully: ${result.fileId}`);

        res.json({
          success: true,
          fileId: result.fileId,
          permalink: result.permalink,
          name: result.name,
          size: result.size,
        });
      } catch (error) {
        logger.error("Failed to upload file:", error);
        res.status(500).json({ error: "Failed to upload file" });
      }
    }
  );

  /**
   * Batch upload endpoint for multiple files
   * POST /internal/files/upload-batch
   */
  router.post(
    "/upload-batch",
    upload.array("files", 10),
    async (req: Request, res: Response) => {
      try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith("Bearer ")) {
          return res
            .status(401)
            .json({ error: "Missing or invalid authorization" });
        }

        const workerToken = authHeader.substring(7);

        // Validate worker token
        const tokenData = verifyWorkerToken(workerToken);
        if (!tokenData) {
          return res.status(401).json({ error: "Invalid worker token" });
        }

        const files = req.files as Express.Multer.File[];
        if (!files || files.length === 0) {
          return res.status(400).json({ error: "No files provided" });
        }

        // Get channel and thread from headers
        const channelId = req.headers["x-channel-id"] as string;
        const threadId = req.headers["x-thread-id"] as string;

        if (!channelId || !threadId) {
          return res
            .status(400)
            .json({ error: "Missing channel or thread ID" });
        }
        const results = [];

        logger.info(
          `Worker uploading ${files.length} files for thread ${tokenData.threadId}`
        );

        // Upload files in parallel (limited concurrency)
        const uploadPromises = files.map(async (file, index) => {
          const filename = req.body.filenames?.[index] || file.originalname;
          const comment = req.body.comments?.[index];
          const fileStream = Readable.from(file.buffer);

          return fileHandler.uploadFile(fileStream, {
            filename,
            channelId,
            threadTs: threadId,
            initialComment: comment,
          });
        });

        const uploadResults = await Promise.allSettled(uploadPromises);

        for (const [index, result] of uploadResults.entries()) {
          if (result.status === "fulfilled") {
            results.push({ success: true, ...result.value });
          } else {
            logger.error(`Failed to upload file ${index}:`, result.reason);
            results.push({
              success: false,
              error: result.reason?.message || "Upload failed",
            });
          }
        }

        res.json({ results });
      } catch (error) {
        logger.error("Failed to batch upload files:", error);
        res.status(500).json({ error: "Failed to batch upload files" });
      }
    }
  );

  return router;
}
