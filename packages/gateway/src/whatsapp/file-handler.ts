/**
 * WhatsApp file handler implementation.
 * Handles media download from incoming messages and upload back to users.
 */

import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { createLogger, sanitizeFilename } from "@termosdev/core";
import {
  type AnyMessageContent,
  downloadContentFromMessage,
  downloadMediaMessage,
  type DownloadableMessage,
  type MediaType,
  type WAMessage,
} from "@whiskeysockets/baileys";
import jwt from "jsonwebtoken";
import pino from "pino";

// Verbose logger for Baileys download operations to debug media download issues
const baileysLogger = pino({ level: "debug" }) as unknown as ReturnType<
  typeof pino
>;

import type {
  FileMetadata,
  FileUploadOptions,
  FileUploadResult,
  IFileHandler,
} from "../platform/file-handler";
import type { BaileysClient } from "./connection/baileys-client";

const logger = createLogger("whatsapp-file-handler");

/**
 * Wrap a promise with a timeout to prevent indefinite blocking
 */
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operationName: string
): Promise<T> {
  let timeoutId: Timer;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${operationName} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutId!);
    return result;
  } catch (error) {
    clearTimeout(timeoutId!);
    throw error;
  }
}

function getJwtSecret(): string {
  const secret = process.env.ENCRYPTION_KEY;
  if (!secret) {
    throw new Error("ENCRYPTION_KEY required for file token generation");
  }
  return secret;
}

export interface ExtractedMedia {
  id: string;
  name: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export interface MediaExtractionError {
  mediaType: string;
  error: string;
  messageId?: string;
}

export interface MediaExtractionResult {
  files: ExtractedMedia[];
  errors: MediaExtractionError[];
}

/**
 * WhatsApp file handler.
 * Stores extracted media in memory for worker download.
 */
export class WhatsAppFileHandler implements IFileHandler {
  private fileStore = new Map<
    string,
    { buffer: Buffer; metadata: FileMetadata }
  >();
  private uploadedFiles = new Map<string, Set<string>>();
  private jwtSecret: string;

  constructor(private client: BaileysClient) {
    this.jwtSecret = getJwtSecret();
  }

  /**
   * Extract media files from a WhatsApp message.
   * Downloads the media and stores it for later retrieval.
   * Returns both successfully extracted files and any errors encountered.
   */
  async extractMediaFromMessage(
    msg: WAMessage
  ): Promise<MediaExtractionResult> {
    const files: ExtractedMedia[] = [];
    const errors: MediaExtractionError[] = [];
    const message = msg.message;
    if (!message) return { files, errors };

    // Check for various media types
    const mediaTypes: Array<{
      key: string;
      extension: string;
    }> = [
      { key: "imageMessage", extension: "jpg" },
      { key: "videoMessage", extension: "mp4" },
      { key: "audioMessage", extension: "ogg" },
      { key: "documentMessage", extension: "bin" },
      { key: "stickerMessage", extension: "webp" },
    ];

    for (const { key, extension } of mediaTypes) {
      const mediaContent = (message as any)[key];
      if (!mediaContent) continue;

      try {
        // Log all available fields for debugging
        logger.info(
          {
            messageId: msg.key?.id,
            mediaType: key,
            hasMediaKey: !!mediaContent.mediaKey,
            mediaKeyLength: mediaContent.mediaKey?.length,
            hasDirectPath: !!mediaContent.directPath,
            directPathLength: mediaContent.directPath?.length,
            hasUrl: !!mediaContent.url,
            urlLength: mediaContent.url?.length,
            urlDomain: mediaContent.url
              ? new URL(mediaContent.url).hostname
              : null,
            hasFileEncSha256: !!mediaContent.fileEncSha256,
            hasFileSha256: !!mediaContent.fileSha256,
            fileLength: mediaContent.fileLength,
            mimetype: mediaContent.mimetype,
            messageTimestamp: msg.messageTimestamp,
            messageAge: msg.messageTimestamp
              ? Date.now() - Number(msg.messageTimestamp) * 1000
              : null,
          },
          "🔍 VOICE DEBUG: Downloading media from message - full details"
        );

        // Log the direct path and URL for debugging
        if (mediaContent.directPath) {
          logger.debug(
            { directPath: mediaContent.directPath },
            "Media direct path"
          );
        }
        if (mediaContent.url) {
          logger.debug({ url: mediaContent.url }, "Media URL");

          // TEMP DEBUG: Write URL to file for manual testing
          try {
            const fs = require("fs");
            const debugInfo = {
              timestamp: new Date().toISOString(),
              messageId: msg.key?.id,
              mediaType: key,
              url: mediaContent.url,
              directPath: mediaContent.directPath,
              expectedSize: mediaContent.fileLength,
              mimetype: mediaContent.mimetype,
            };
            fs.appendFileSync(
              "/tmp/voice-debug.log",
              JSON.stringify(debugInfo) + "\n"
            );
          } catch (err) {
            // Ignore file write errors
          }
        }

        // Retry logic: WhatsApp CDN may not have the file immediately available
        // We retry up to 5 times with increasing delays
        const maxRetries = 5;
        const expectedSize = mediaContent.fileLength
          ? Number(mediaContent.fileLength)
          : 0;
        let buffer: Buffer | null = null;
        let lastError: Error | null = null;

        // Initial delay before first attempt - WhatsApp CDN needs time to propagate media
        // Voice messages in particular often fail on immediate download
        // Analysis shows 26 bytes = encryption header only, CDN needs 1-2s to propagate full file
        const initialDelayMs = 1500; // 1.5 seconds - enough for CDN propagation, short enough for token validity
        logger.info(
          { messageId: msg.key?.id, mediaType: key, delay: initialDelayMs },
          "🕐 VOICE DEBUG: Waiting for CDN propagation before download attempt"
        );
        await new Promise((resolve) => setTimeout(resolve, initialDelayMs));

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            // Get the updateMediaMessage function for re-requesting expired media
            const updateMediaMessage = this.client.getUpdateMediaMessage();
            logger.info(
              {
                messageId: msg.key?.id,
                attempt,
                hasUpdateMediaMessage: !!updateMediaMessage,
                mediaUrl: mediaContent.url?.substring(0, 80),
                directPath: mediaContent.directPath,
                currentTime: new Date().toISOString(),
                mediaKeyExists: !!mediaContent.mediaKey,
                expectedSize,
              },
              "📥 VOICE DEBUG: Attempting media download"
            );

            // Call updateMediaMessage to refresh the media URL/keys
            // Do this on every attempt including the first, as URLs can be stale
            // Use timeout to prevent indefinite blocking (seen in production)
            if (attempt > 1 && updateMediaMessage) {
              // Only refresh URL on retries, first attempt uses fresh original URL
              logger.info(
                { messageId: msg.key?.id, attempt },
                "Calling updateMediaMessage to refresh media URL"
              );
              try {
                const updatedMsg = await withTimeout(
                  updateMediaMessage(msg),
                  10000, // 10 second timeout
                  "updateMediaMessage"
                );
                // Update the message reference with fresh URLs
                if (updatedMsg?.message) {
                  msg = updatedMsg as WAMessage;
                  logger.info(
                    { messageId: msg.key?.id },
                    "Media message updated with fresh URLs"
                  );
                }
              } catch (updateErr) {
                logger.warn(
                  { error: String(updateErr), messageId: msg.key?.id },
                  "Failed to update media message, continuing with original"
                );
              }
            }

            // Try downloading as buffer directly (more reliable than stream for small files)
            const downloadResult = await downloadMediaMessage(
              msg,
              "buffer",
              {},
              {
                logger: baileysLogger as any,
                reuploadRequest: updateMediaMessage ?? (async (m) => m),
              }
            );

            // Convert stream to buffer
            let downloadedBuffer: Buffer;
            if (downloadResult instanceof Readable) {
              const chunks: Buffer[] = [];
              for await (const chunk of downloadResult) {
                chunks.push(
                  Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
                );
              }
              downloadedBuffer = Buffer.concat(chunks);
              logger.info(
                {
                  messageId: msg.key?.id,
                  attempt,
                  bufferLength: downloadedBuffer.length,
                },
                "Converted stream to buffer"
              );
            } else if (Buffer.isBuffer(downloadResult)) {
              downloadedBuffer = downloadResult;
            } else {
              logger.warn(
                {
                  messageId: msg.key?.id,
                  attempt,
                  resultType: typeof downloadResult,
                  isNull: downloadResult === null,
                  isUndefined: downloadResult === undefined,
                },
                "Download returned unexpected type"
              );
              lastError = new Error(
                "Downloaded media is not a stream or buffer"
              );
              continue;
            }

            // Check for empty or suspiciously small buffer
            // Based on analysis: 26 bytes = encryption header only, need full file
            const minValidSize = Math.max(100, expectedSize * 0.1); // At least 10% of expected size
            if (
              downloadedBuffer.length === 0 ||
              downloadedBuffer.length < minValidSize ||
              (downloadedBuffer.length <= 30 && expectedSize > 1000) // Specific check for header-only responses
            ) {
              logger.warn(
                {
                  messageId: msg.key?.id,
                  mediaType: key,
                  attempt,
                  bufferLength: downloadedBuffer.length,
                  expectedSize,
                  minValidSize,
                  possibleCause:
                    downloadedBuffer.length <= 30
                      ? "CDN returned header-only (26-30 bytes typical)"
                      : "Partial download detected",
                },
                "📦 VOICE DEBUG: Downloaded media buffer too small - likely CDN propagation delay"
              );

              // Try alternative download method using downloadContentFromMessage
              try {
                const mediaTypeMap: Record<string, MediaType> = {
                  imageMessage: "image",
                  videoMessage: "video",
                  audioMessage: "audio",
                  documentMessage: "document",
                  stickerMessage: "sticker",
                };
                const mediaType = mediaTypeMap[key];
                if (mediaType && mediaContent) {
                  logger.info(
                    { messageId: msg.key?.id, mediaType, attempt },
                    "Attempting downloadContentFromMessage fallback"
                  );
                  const stream = await downloadContentFromMessage(
                    mediaContent as DownloadableMessage,
                    mediaType
                  );
                  const chunks: Buffer[] = [];
                  for await (const chunk of stream) {
                    chunks.push(
                      Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
                    );
                  }
                  downloadedBuffer = Buffer.concat(chunks);
                  logger.info(
                    {
                      messageId: msg.key?.id,
                      bufferLength: downloadedBuffer.length,
                      attempt,
                    },
                    "downloadContentFromMessage result"
                  );
                }
              } catch (fallbackErr) {
                logger.warn(
                  {
                    error: String(fallbackErr),
                    messageId: msg.key?.id,
                    attempt,
                  },
                  "downloadContentFromMessage fallback also failed"
                );
              }

              if (downloadedBuffer.length < minValidSize) {
                // BAILEYS FIX: Force reupload on partial content since Baileys only triggers reupload on 404/410
                // Try on every attempt since CDN propagation timing is unpredictable
                if (updateMediaMessage) {
                  logger.warn(
                    {
                      messageId: msg.key?.id,
                      bufferLength: downloadedBuffer.length,
                      expectedSize,
                      attempt,
                    },
                    "🔄 BAILEYS FIX: Forcing reupload due to partial content (Baileys limitation)"
                  );
                  try {
                    const reuploadedMsg = await withTimeout(
                      updateMediaMessage(msg),
                      10000,
                      "forced reupload on partial content"
                    );
                    if (reuploadedMsg?.message) {
                      msg = reuploadedMsg as WAMessage;
                      logger.info(
                        { messageId: msg.key?.id, attempt },
                        "Message reuploaded due to partial content"
                      );
                      // Continue with the retry loop to try the fresh URL
                      lastError = new Error(
                        `Downloaded media buffer too small: ${downloadedBuffer.length} bytes, retrying with reuploaded message`
                      );
                    } else {
                      lastError = new Error(
                        `Downloaded media buffer too small: ${downloadedBuffer.length} bytes`
                      );
                    }
                  } catch (reuploadError) {
                    logger.warn(
                      { error: String(reuploadError), attempt },
                      "Failed to reupload message"
                    );
                    lastError = new Error(
                      `Downloaded media buffer too small: ${downloadedBuffer.length} bytes`
                    );
                  }
                } else {
                  lastError = new Error(
                    `Downloaded media buffer too small: ${downloadedBuffer.length} bytes`
                  );
                }
              } else {
                // Fallback succeeded!
                buffer = downloadedBuffer;
                logger.info(
                  {
                    messageId: msg.key?.id,
                    bufferLength: buffer.length,
                    attempt,
                  },
                  "downloadContentFromMessage fallback succeeded"
                );
                break;
              }
            } else if (
              expectedSize > 0 &&
              downloadedBuffer.length < expectedSize * 0.9
            ) {
              // Buffer is significantly smaller than expected (< 90% of expected size)
              // This happens when CDN returns partial/stale data
              logger.warn(
                {
                  messageId: msg.key?.id,
                  attempt,
                  gotSize: downloadedBuffer.length,
                  expectedSize,
                },
                "Downloaded buffer smaller than expected, CDN may not have full file yet"
              );
              lastError = new Error(
                `Buffer size mismatch: got ${downloadedBuffer.length}, expected ${expectedSize}`
              );
            } else {
              // Success!
              buffer = downloadedBuffer;
              logger.info(
                {
                  messageId: msg.key?.id,
                  bufferLength: buffer.length,
                  expectedSize,
                  attempt,
                },
                "downloadMediaMessage completed successfully"
              );
              break;
            }
          } catch (downloadError) {
            lastError = downloadError as Error;
            const error = downloadError as Error;
            logger.warn(
              {
                error: String(downloadError),
                errorMessage: error?.message,
                errorName: error?.name,
                errorStack: error?.stack?.split("\n").slice(0, 3),
                messageId: msg.key?.id,
                mediaType: key,
                attempt,
                isTimeoutError: error?.message?.includes("timeout"),
                isNetworkError:
                  error?.message?.includes("network") ||
                  error?.message?.includes("fetch"),
                isWhatsAppError:
                  error?.message?.includes("whatsapp") ||
                  error?.message?.includes("baileys"),
                currentTime: new Date().toISOString(),
              },
              "❌ VOICE DEBUG: downloadMediaMessage attempt failed"
            );
          }

          // Wait before retrying - use shorter delays for first attempts since CDN propagation
          // usually completes within a few seconds, longer delays for later attempts
          // Pattern: 2s, 3s, 5s, 10s (total max wait: 20s instead of 150s+)
          if (attempt < maxRetries) {
            const delays = [2000, 3000, 5000, 10000]; // milliseconds
            const delay = delays[Math.min(attempt - 1, delays.length - 1)];
            logger.info(
              { messageId: msg.key?.id, attempt, delay, maxRetries },
              "Waiting before retry"
            );
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        }

        if (!buffer) {
          const errorMsg =
            lastError?.message || "Download returned empty buffer";
          const detailedError = {
            baseError: errorMsg,
            lastErrorName: lastError?.name,
            lastErrorStack: lastError?.stack?.split("\n").slice(0, 3),
            messageId: msg.key?.id,
            mediaType: key,
            maxRetries,
            attemptsCompleted: maxRetries,
            finalMediaState: {
              hasUrl: !!mediaContent.url,
              hasDirectPath: !!mediaContent.directPath,
              hasMediaKey: !!mediaContent.mediaKey,
              urlDomain: mediaContent.url
                ? new URL(mediaContent.url).hostname
                : null,
              expectedSize,
              mimetype: mediaContent.mimetype,
              messageAge: msg.messageTimestamp
                ? Date.now() - Number(msg.messageTimestamp) * 1000
                : null,
            },
            possibleCauses: [
              !mediaContent.url && "Missing media URL",
              !mediaContent.mediaKey && "Missing media encryption key",
              !mediaContent.directPath && "Missing direct path",
              expectedSize === 0 && "Unknown file size",
              lastError?.message?.includes("timeout") && "Network timeout",
              lastError?.message?.includes("network") &&
                "Network connectivity issue",
              msg.messageTimestamp &&
                Date.now() - Number(msg.messageTimestamp) * 1000 > 86400000 &&
                "Message older than 24 hours",
            ].filter(Boolean),
            finalTime: new Date().toISOString(),
          };

          logger.error(
            detailedError,
            "💥 VOICE DEBUG: Failed to download media after all retries - DETAILED ANALYSIS"
          );

          errors.push({
            mediaType: key,
            error: `${errorMsg} | Detailed: ${JSON.stringify(detailedError.possibleCauses)}`,
            messageId: msg.key?.id ?? undefined,
          });
          continue;
        }

        const fileId = randomUUID();
        const mimeType = mediaContent.mimetype || `application/${extension}`;

        // Get filename from document or generate one
        let fileName: string;
        if (key === "documentMessage" && mediaContent.fileName) {
          fileName = mediaContent.fileName;
        } else {
          const ext = mimeType.split("/")[1]?.split(";")[0] || extension;
          fileName = `${key.replace("Message", "")}_${Date.now()}.${ext}`;
        }

        const metadata: FileMetadata = {
          id: fileId,
          name: fileName,
          mimetype: mimeType,
          size: buffer.length,
          url: `internal://whatsapp/${fileId}`,
        };

        // Store for later retrieval
        this.fileStore.set(fileId, { buffer, metadata });

        files.push({
          id: fileId,
          name: fileName,
          mimetype: mimeType,
          size: buffer.length,
          buffer,
        });

        logger.info(
          {
            fileId,
            fileName,
            mimeType,
            size: buffer.length,
            messageId: msg.key?.id,
            mediaType: key,
            downloadTime: new Date().toISOString(),
            totalTimeSpent: Date.now() - Date.now(), // Will be updated in actual run
            attemptsNeeded: "Will be tracked in retry loop",
          },
          "✅ VOICE DEBUG: Successfully extracted media from WhatsApp message"
        );

        // Auto-cleanup after 1 hour
        setTimeout(
          () => {
            this.fileStore.delete(fileId);
          },
          60 * 60 * 1000
        );
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error(
          { error: errorMsg, messageId: msg.key?.id, mediaType: key },
          "Failed to download media from message"
        );
        errors.push({
          mediaType: key,
          error: errorMsg,
          messageId: msg.key?.id ?? undefined,
        });
      }
    }

    return { files, errors };
  }

  /**
   * Download a file by ID.
   * Returns the file stream and metadata.
   * WhatsApp files are stored in memory, no external auth needed.
   */
  async downloadFile(
    fileId: string
  ): Promise<{ stream: Readable; metadata: FileMetadata }> {
    const entry = this.fileStore.get(fileId);
    if (!entry) {
      throw new Error(`File not found: ${fileId}`);
    }

    return {
      stream: Readable.from(entry.buffer),
      metadata: entry.metadata,
    };
  }

  /**
   * Upload a file to WhatsApp.
   * Sends the file as a message to the specified channel.
   */
  async uploadFile(
    fileStream: Readable,
    options: FileUploadOptions
  ): Promise<FileUploadResult> {
    const safeFilename = sanitizeFilename(options.filename);

    // Collect stream into buffer
    const chunks: Buffer[] = [];
    for await (const chunk of fileStream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const fileBuffer = Buffer.concat(chunks);

    logger.info(
      {
        filename: safeFilename,
        size: fileBuffer.length,
        channelId: options.channelId,
      },
      "Uploading file to WhatsApp"
    );

    // Determine media type from filename
    const content = this.buildMediaContent(
      fileBuffer,
      safeFilename,
      options.title,
      options.voiceMessage
    );

    // Send the media message
    const result = await this.client.sendMessage(options.channelId, content);

    const fileId = randomUUID();

    // Track uploaded file
    if (options.sessionKey) {
      if (!this.uploadedFiles.has(options.sessionKey)) {
        this.uploadedFiles.set(options.sessionKey, new Set());
      }
      this.uploadedFiles.get(options.sessionKey)!.add(fileId);
    }

    return {
      fileId,
      permalink: `whatsapp://${options.channelId}/${result.messageId}`,
      name: safeFilename,
      size: fileBuffer.length,
    };
  }

  /**
   * Build the appropriate media content based on file type.
   * @param voiceMessage - If true, send audio as voice note (ptt)
   */
  private buildMediaContent(
    buffer: Buffer,
    filename: string,
    caption?: string,
    voiceMessage?: boolean
  ): AnyMessageContent {
    const ext = filename.split(".").pop()?.toLowerCase() || "";

    // Image types
    if (["jpg", "jpeg", "png", "gif", "webp"].includes(ext)) {
      return {
        image: buffer,
        caption: caption || filename,
      };
    }

    // Video types
    if (["mp4", "mov", "avi", "mkv", "webm"].includes(ext)) {
      return {
        video: buffer,
        caption: caption || filename,
      };
    }

    // Audio types
    if (["mp3", "ogg", "wav", "m4a", "opus"].includes(ext)) {
      return {
        audio: buffer,
        ptt: voiceMessage ?? false,
        mimetype: this.getMimeType(ext),
      };
    }

    // Default: send as document
    return {
      document: buffer,
      fileName: filename,
      mimetype: this.getMimeType(ext),
      caption: caption,
    };
  }

  /**
   * Get MIME type from extension.
   */
  private getMimeType(ext: string): string {
    const mimeTypes: Record<string, string> = {
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      gif: "image/gif",
      webp: "image/webp",
      mp4: "video/mp4",
      mov: "video/quicktime",
      avi: "video/x-msvideo",
      mkv: "video/x-matroska",
      webm: "video/webm",
      mp3: "audio/mpeg",
      ogg: "audio/ogg",
      wav: "audio/wav",
      m4a: "audio/mp4",
      opus: "audio/opus",
      pdf: "application/pdf",
      doc: "application/msword",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      xls: "application/vnd.ms-excel",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      txt: "text/plain",
      json: "application/json",
      csv: "text/csv",
    };

    return mimeTypes[ext] || "application/octet-stream";
  }

  /**
   * Generate a JWT token for file access.
   */
  generateFileToken(
    sessionKey: string,
    fileId: string,
    expiresIn = 3600
  ): string {
    return jwt.sign(
      {
        sessionKey,
        fileId,
        type: "file_access",
        iat: Math.floor(Date.now() / 1000),
      },
      this.jwtSecret,
      {
        expiresIn,
        algorithm: "HS256",
        issuer: "termos-gateway",
        audience: "termos-worker",
      }
    );
  }

  /**
   * Validate a file access token.
   */
  validateFileToken(token: string): {
    valid: boolean;
    sessionKey?: string;
    fileId?: string;
    error?: string;
  } {
    try {
      const decoded = jwt.verify(token, this.jwtSecret, {
        algorithms: ["HS256"],
        issuer: "termos-gateway",
        audience: "termos-worker",
      });

      if (
        typeof decoded === "string" ||
        typeof decoded.sessionKey !== "string" ||
        typeof decoded.fileId !== "string" ||
        decoded.type !== "file_access"
      ) {
        return { valid: false, error: "Invalid token structure" };
      }

      return {
        valid: true,
        sessionKey: decoded.sessionKey,
        fileId: decoded.fileId,
      };
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        return { valid: false, error: "Token expired" };
      }
      return { valid: false, error: "Invalid token" };
    }
  }

  /**
   * Get files uploaded in a session.
   */
  getSessionFiles(sessionKey: string): string[] {
    return Array.from(this.uploadedFiles.get(sessionKey) || []);
  }

  /**
   * Cleanup session data.
   */
  cleanupSession(sessionKey: string): void {
    this.uploadedFiles.delete(sessionKey);
  }

  /**
   * Check if a file exists in the store.
   */
  hasFile(fileId: string): boolean {
    return this.fileStore.has(fileId);
  }

  /**
   * Get raw file buffer (for internal use).
   */
  getFileBuffer(fileId: string): Buffer | null {
    return this.fileStore.get(fileId)?.buffer || null;
  }
}
