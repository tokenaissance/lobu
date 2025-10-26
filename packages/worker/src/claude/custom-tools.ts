import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { createLogger } from "@peerbot/core";
import * as fs from "fs/promises";
import * as path from "path";
import FormData from "form-data";

const logger = createLogger("custom-tools");

/**
 * Create custom MCP server with tools for showing content to users
 */
export function createCustomToolsServer(
  gatewayUrl: string,
  workerToken: string,
  channelId: string,
  threadId: string
) {
  return createSdkMcpServer({
    name: "peerbot",
    version: "1.0.0",
    tools: [
      tool(
        "show_to_user",
        "Use this whenever you create a visualization, chart, image, document, report, or any file that helps answer the user's request. This is how you share your work with the user.",
        {
          file_path: z
            .string()
            .describe(
              "Path to the file to show (absolute or relative to workspace)"
            ),
          description: z
            .string()
            .optional()
            .describe(
              "Optional description of what the file contains or shows"
            ),
        },
        async (args) => {
          try {
            logger.info(
              `Show file to user: ${args.file_path}, description: ${args.description || "none"}`
            );

            // Resolve file path
            const filePath = path.isAbsolute(args.file_path)
              ? args.file_path
              : path.join(process.cwd(), args.file_path);

            // Check if file exists
            const stats = await fs.stat(filePath).catch(() => null);
            if (!stats || !stats.isFile()) {
              return {
                content: [
                  {
                    type: "text",
                    text: `Error: Cannot show file - not found or is not a file: ${args.file_path}`,
                  },
                ],
              };
            }

            // Skip empty files
            if (stats.size === 0) {
              return {
                content: [
                  {
                    type: "text",
                    text: `Error: Cannot show empty file: ${args.file_path}`,
                  },
                ],
              };
            }

            const fileName = path.basename(filePath);

            // Read file into buffer
            const fileBuffer = await fs.readFile(filePath);

            // Create form data
            const formData = new FormData();
            formData.append("file", fileBuffer, {
              filename: fileName,
              contentType: getContentType(fileName),
            });
            formData.append("filename", fileName);

            if (args.description) {
              formData.append("comment", args.description);
            }

            // Convert FormData stream to buffer
            const formDataBuffer = await new Promise<Buffer>(
              (resolve, reject) => {
                const chunks: Buffer[] = [];

                formData.on("data", (chunk: string | Buffer) => {
                  if (typeof chunk === "string") {
                    chunks.push(Buffer.from(chunk));
                  } else {
                    chunks.push(chunk);
                  }
                });

                formData.on("end", () => {
                  resolve(Buffer.concat(chunks));
                });

                formData.on("error", (err: Error) => {
                  reject(err);
                });

                formData.resume();
              }
            );

            const headers = formData.getHeaders();

            // Upload via gateway
            const response = await fetch(
              `${gatewayUrl}/internal/files/upload`,
              {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${workerToken}`,
                  "X-Channel-Id": channelId,
                  "X-Thread-Id": threadId,
                  ...headers,
                  "Content-Length": formDataBuffer.length.toString(),
                },
                body: formDataBuffer,
              }
            );

            if (!response.ok) {
              const error = await response.text();
              logger.error(
                `Failed to show file: ${response.status} - ${error}`
              );
              return {
                content: [
                  {
                    type: "text",
                    text: `Error: Failed to show file to user: ${response.status} - ${error}`,
                  },
                ],
              };
            }

            const result = (await response.json()) as {
              fileId: string;
              name: string;
              permalink: string;
            };

            logger.info(
              `Successfully showed file to user: ${result.fileId} - ${result.name}`
            );

            return {
              content: [
                {
                  type: "text",
                  text: `Successfully showed ${fileName} to the user`,
                },
              ],
            };
          } catch (error) {
            logger.error("Show file tool error:", error);
            return {
              content: [
                {
                  type: "text",
                  text: `Error: Failed to show file to user: ${error instanceof Error ? error.message : String(error)}`,
                },
              ],
            };
          }
        }
      ),
    ],
  });
}

/**
 * Get content type for file based on extension
 */
function getContentType(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  const contentTypes: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".pdf": "application/pdf",
    ".csv": "text/csv",
    ".xlsx":
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".json": "application/json",
    ".html": "text/html",
    ".svg": "image/svg+xml",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".py": "text/x-python",
    ".js": "text/javascript",
    ".ts": "text/typescript",
    ".zip": "application/zip",
    ".tar": "application/x-tar",
    ".gz": "application/gzip",
  };
  return contentTypes[ext] || "application/octet-stream";
}
