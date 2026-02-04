#!/usr/bin/env bun

import { spawn } from "node:child_process";
import path from "node:path";
import { createLogger } from "@termosdev/core";
import type { ProcessInfo } from "./types";

const logger = createLogger("worker");

export async function startTunnel(
  info: ProcessInfo,
  port: number,
  retryCount: number = 0,
  saveCallback: (info: ProcessInfo) => Promise<void>
): Promise<void> {
  // Skip if we already have a working tunnel
  if (info.tunnelUrl && info.tunnelProcess) {
    logger.info(
      `[MCP Process Manager] Tunnel already exists for ${info.id}: ${info.tunnelUrl}`
    );
    return;
  }

  // Add exponential backoff delay between retries to avoid rate limiting
  if (retryCount > 0) {
    const delay = Math.min(30000 * 2 ** (retryCount - 1), 120000);
    logger.error(
      `[MCP Process Manager] Cloudflare rate limit detected. Waiting ${delay / 1000}s before retry attempt ${retryCount + 1} for tunnel`
    );
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  const logsDir = "/tmp/claude-logs";
  const tunnelLogPath = path.join(logsDir, `${info.id}-tunnel.log`);
  const tunnelLogStream = await import("node:fs").then((fs) =>
    fs.createWriteStream(tunnelLogPath, { flags: "a" })
  );

  tunnelLogStream.write(
    `Starting cloudflared tunnel for port ${port} at ${new Date().toISOString()} (attempt ${retryCount + 1})\n`
  );

  logger.error(
    `[MCP Process Manager] Starting cloudflared tunnel for process ${info.id} on port ${port} (attempt ${retryCount + 1})`
  );

  const tunnelChild = spawn(
    "cloudflared",
    ["tunnel", "--url", `http://localhost:${port}`],
    {
      detached: false,
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  tunnelChild.on("error", (err) => {
    logger.error(
      `[Process Manager] Failed to spawn cloudflared: ${err.message}`
    );
    tunnelLogStream.write(
      `ERROR: Failed to spawn cloudflared: ${err.message}\n`
    );
    info.tunnelUrl = undefined;
    delete info.tunnelProcess;
  });

  info.tunnelProcess = tunnelChild;

  let urlExtracted = false;
  const extractTimeout = setTimeout(() => {
    if (!urlExtracted) {
      tunnelLogStream.write("Failed to extract tunnel URL within 15 seconds\n");
      logger.error(`Failed to extract tunnel URL for process ${info.id}`);

      if (info.tunnelProcess) {
        try {
          process.kill(info.tunnelProcess.pid!, "SIGTERM");
        } catch (_e) {
          // Process already terminated
        }
        delete info.tunnelProcess;
        info.tunnelUrl = undefined;
      }
    }
  }, 15000);

  let rateLimitDetected = false;

  const extractUrl = (data: Buffer) => {
    const output = data.toString();
    tunnelLogStream.write(output);

    if (output.includes("trycloudflare.com")) {
      tunnelLogStream.write(
        `\n[MCP] Found trycloudflare.com in output, attempting extraction...\n`
      );
    }

    logger.error(`[MCP Process Manager - Cloudflared Output] ${output.trim()}`);

    if (
      output.includes("429 Too Many Requests") ||
      output.includes("error code: 1015")
    ) {
      rateLimitDetected = true;
      tunnelLogStream.write(
        `\n[MCP] Rate limit detected (429 Too Many Requests)\n`
      );
      logger.error(
        `[MCP Process Manager] Cloudflare rate limit detected (429 Too Many Requests)`
      );
    }

    const urlMatch = output.match(
      /https?:\/\/([a-z0-9-]+)\.trycloudflare\.com/i
    );
    if (urlMatch && !urlExtracted) {
      urlExtracted = true;
      clearTimeout(extractTimeout);
      const prefix = urlMatch[1];
      info.tunnelUrl = `https://${prefix}.termos.dev`;
      tunnelLogStream.write(
        `\n[MCP] Successfully extracted URL: ${urlMatch[0]}\n`
      );
      tunnelLogStream.write(
        `[MCP] Converted to termos.dev: ${info.tunnelUrl}\n`
      );
      logger.error(
        `[MCP Process Manager - Tunnel ${info.id}] Established: ${info.tunnelUrl}`
      );
      logger.error(
        `[MCP Process Manager - Tunnel ${info.id}] Original cloudflared URL: ${urlMatch[0]}`
      );
      saveCallback(info);
    }
  };

  tunnelChild.stdout?.on("data", extractUrl);
  tunnelChild.stderr?.on("data", extractUrl);

  tunnelChild.on("exit", (code, signal) => {
    clearTimeout(extractTimeout);
    tunnelLogStream.write(
      `\nTunnel process exited with code ${code} at ${new Date().toISOString()}\n`
    );
    tunnelLogStream.end();

    logger.error(
      `[MCP Process Manager] Cloudflared exited with code ${code}, signal: ${signal}`
    );

    if (info.tunnelProcess === tunnelChild) {
      delete info.tunnelProcess;
      info.tunnelUrl = undefined;
      saveCallback(info);

      if (code !== 0 && !urlExtracted && retryCount < 2) {
        if (rateLimitDetected) {
          logger.error(
            `[MCP Process Manager] Cloudflared hit rate limit - will retry with longer backoff (attempt ${retryCount + 2}/3)`
          );
        } else {
          logger.error(
            `[MCP Process Manager] Cloudflared failed with exit code ${code} - retrying tunnel (attempt ${retryCount + 2}/3)`
          );
        }
        startTunnel(info, port, retryCount + 1, saveCallback);
      } else if (code !== 0 && !urlExtracted) {
        if (rateLimitDetected) {
          logger.error(
            `[MCP Process Manager] Cloudflared rate limited after ${retryCount + 1} attempts - consider using alternative tunnel solution`
          );
        } else {
          logger.error(
            `[MCP Process Manager] Cloudflared failed after ${retryCount + 1} attempts - tunnel not established`
          );
        }
      }
    }
  });

  tunnelChild.on("error", (error) => {
    clearTimeout(extractTimeout);
    tunnelLogStream.write(`Tunnel process error: ${error.message}\n`);
    logger.error(
      `Failed to start cloudflared tunnel for process ${info.id}:`,
      error
    );

    if (!urlExtracted) {
      urlExtracted = true;
      info.tunnelUrl = undefined;
      delete info.tunnelProcess;
      saveCallback(info);
    }
  });
}
