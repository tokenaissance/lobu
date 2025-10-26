import { createLogger } from "@peerbot/core";
import type { WebClient } from "../slack/types";
import { Readable } from "node:stream";

const logger = createLogger("file-handler");

export interface SlackFileMetadata {
  id: string;
  name: string;
  mimetype?: string;
  size: number;
  url_private: string;
  url_private_download: string;
  permalink?: string;
  timestamp: number;
}

export interface FileUploadResult {
  fileId: string;
  permalink: string;
  name: string;
  size: number;
}

/**
 * Handles file operations between Slack and workers
 */
export class FileHandler {
  private uploadedFiles: Map<string, Set<string>> = new Map(); // sessionKey -> fileIds

  constructor(private slackClient: WebClient) {}

  /**
   * Download a file from Slack
   */
  async downloadFile(
    fileId: string,
    bearerToken: string
  ): Promise<{ stream: Readable; metadata: SlackFileMetadata }> {
    try {
      // Get file info
      const fileInfo = await this.slackClient.files.info({
        file: fileId,
      });

      if (!fileInfo.ok || !fileInfo.file) {
        throw new Error(`Failed to get file info: ${fileInfo.error}`);
      }

      const file = fileInfo.file as any;
      const metadata: SlackFileMetadata = {
        id: file.id,
        name: file.name,
        mimetype: file.mimetype,
        size: file.size,
        url_private: file.url_private,
        url_private_download: file.url_private_download,
        permalink: file.permalink,
        timestamp: file.timestamp,
      };

      // Download file using the bearer token
      const response = await fetch(metadata.url_private_download, {
        headers: {
          Authorization: `Bearer ${bearerToken}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to download file: ${response.statusText}`);
      }

      // Convert web stream to Node.js readable stream
      const nodeStream = Readable.fromWeb(response.body as any);

      return { stream: nodeStream, metadata };
    } catch (error) {
      logger.error(`Failed to download file ${fileId}:`, error);
      throw error;
    }
  }

  /**
   * Upload a file to Slack
   */
  async uploadFile(
    fileStream: Readable,
    options: {
      filename: string;
      channelId: string;
      threadTs?: string;
      title?: string;
      initialComment?: string;
      sessionKey?: string;
    }
  ): Promise<FileUploadResult> {
    try {
      // Convert stream to buffer for Slack API
      const chunks: Buffer[] = [];
      for await (const chunk of fileStream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const fileBuffer = Buffer.concat(chunks);

      logger.info(
        `Uploading file ${options.filename} (${fileBuffer.length} bytes) to channel ${options.channelId}, thread ${options.threadTs}`
      );

      // Use files.uploadV2 for better performance
      const result = await this.slackClient.files.uploadV2({
        channel_id: options.channelId,
        thread_ts: options.threadTs,
        filename: options.filename,
        file: fileBuffer,
        title: options.title || options.filename,
        initial_comment: options.initialComment,
      });

      if (!result.ok) {
        throw new Error(`Failed to upload file: ${result.error}`);
      }

      // files.uploadV2 response structure: { files: [ { id, name, ... } ] }
      const files = (result as any).files;
      if (!files || files.length === 0) {
        throw new Error("Upload succeeded but no file info returned");
      }

      const file = files[0];

      // Track uploaded files per session
      if (options.sessionKey) {
        if (!this.uploadedFiles.has(options.sessionKey)) {
          this.uploadedFiles.set(options.sessionKey, new Set());
        }
        this.uploadedFiles.get(options.sessionKey)!.add(file.id);
      }

      logger.info(`Successfully uploaded file: ${file.id} - ${file.name}`);

      return {
        fileId: file.id,
        permalink: file.permalink || file.url_private,
        name: file.name,
        size: file.size || fileBuffer.length,
      };
    } catch (error) {
      logger.error(`Failed to upload file ${options.filename}:`, error);
      throw error;
    }
  }

  /**
   * Get uploaded files for a session
   */
  getSessionFiles(sessionKey: string): string[] {
    return Array.from(this.uploadedFiles.get(sessionKey) || []);
  }

  /**
   * Clean up session files
   */
  cleanupSession(sessionKey: string): void {
    this.uploadedFiles.delete(sessionKey);
  }

  /**
   * Generate a secure file token
   */
  generateFileToken(
    sessionKey: string,
    fileId: string,
    expiresIn: number = 3600
  ): string {
    const payload = {
      sessionKey,
      fileId,
      exp: Date.now() + expiresIn * 1000,
    };
    // In production, use proper JWT signing
    return Buffer.from(JSON.stringify(payload)).toString("base64");
  }

  /**
   * Validate file token
   */
  validateFileToken(token: string): {
    valid: boolean;
    sessionKey?: string;
    fileId?: string;
  } {
    try {
      const payload = JSON.parse(Buffer.from(token, "base64").toString());
      if (payload.exp < Date.now()) {
        return { valid: false };
      }
      return {
        valid: true,
        sessionKey: payload.sessionKey,
        fileId: payload.fileId,
      };
    } catch {
      return { valid: false };
    }
  }
}
