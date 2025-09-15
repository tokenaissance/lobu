#!/usr/bin/env node

import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";

interface ProcessInfo {
  id: string;
  command: string;
  description: string;
  status: "starting" | "running" | "completed" | "failed" | "killed";
  pid?: number;
  startedAt: string;
  completedAt?: string;
  exitCode?: number;
  restartCount: number;
  process?: ChildProcess;
  port?: number;
  tunnelUrl?: string;
  tunnelProcess?: ChildProcess;
}

class ProcessManager {
  private processes: Map<string, ProcessInfo> = new Map();
  private processDir = "/tmp/agent-processes";
  private logsDir = "/tmp/claude-logs";
  private monitorInterval?: NodeJS.Timeout;
  private autoRestart = true; // Enabled by default

  constructor() {
    this.init();
    // Start monitoring by default with 30 second interval
    this.startMonitoring(30000);
  }

  private async init() {
    await mkdir(this.processDir, { recursive: true });
    await mkdir(this.logsDir, { recursive: true });
    await this.loadExistingProcesses();
  }

  private async loadExistingProcesses() {
    try {
      const files = await readdir(this.processDir);
      for (const file of files) {
        if (file.endsWith(".json")) {
          const id = file.replace(".json", "");
          const infoPath = path.join(this.processDir, file);
          const data = await readFile(infoPath, "utf-8");
          const info = JSON.parse(data) as ProcessInfo;
          this.processes.set(id, info);
        }
      }
    } catch (error) {
      console.error("Error loading existing processes:", error);
    }
  }

  private async saveProcessInfo(info: ProcessInfo) {
    const infoPath = path.join(this.processDir, `${info.id}.json`);
    await writeFile(infoPath, JSON.stringify(info, null, 2));
  }

  private getLogPath(id: string): string {
    return path.join(this.logsDir, `${id}.log`);
  }

  async startProcess(
    id: string,
    command: string,
    description: string,
    port?: number,
    isRestart: boolean = false
  ): Promise<ProcessInfo> {
    if (this.processes.has(id)) {
      const existing = this.processes.get(id)!;
      if (existing.status === "running" && existing.pid) {
        throw new Error(
          `Process ${id} is already running with PID ${existing.pid}`
        );
      }
    }

    // Preserve existing process info on restart, including tunnel URL
    const existingInfo = this.processes.get(id);
    const info: ProcessInfo = {
      id,
      command,
      description,
      status: "starting",
      startedAt: new Date().toISOString(),
      restartCount: existingInfo?.restartCount || 0,
      port,
      // Preserve tunnel URL on restart to avoid creating new tunnels
      tunnelUrl: isRestart ? existingInfo?.tunnelUrl : undefined,
    };

    const logPath = this.getLogPath(id);
    const logStream = await import("node:fs").then((fs) =>
      fs.createWriteStream(logPath, { flags: "a" })
    );

    // Determine the working directory - use workspace if available
    const workingDir = process.env.WORKSPACE_DIR || process.cwd();

    logStream.write(`Process ${id} starting at ${info.startedAt}\n`);
    logStream.write(`Command: ${command}\n`);
    logStream.write(`Working Directory: ${workingDir}\n`);
    logStream.write(`Description: ${description}\n`);
    logStream.write("---\n");

    // Log to worker console
    console.log(`[Process Manager] Starting process ${id}: ${description}`);
    console.log(`[Process Manager] Command: ${command}`);
    console.log(`[Process Manager] Working Directory: ${workingDir}`);

    const child = spawn("bash", ["-c", command], {
      detached: false,
      stdio: ["ignore", "pipe", "pipe"],
      cwd: workingDir,
    });

    info.pid = child.pid;
    info.status = "running";
    info.process = child;

    child.stdout?.on("data", (data) => {
      logStream.write(data);
      // Also pipe to worker stdout with process identifier
      process.stdout.write(`[Process ${id}] ${data}`);
    });

    child.stderr?.on("data", (data) => {
      logStream.write(data);
      // Also pipe to worker stderr with process identifier
      process.stderr.write(`[Process ${id}] ${data}`);
    });

    child.on("exit", async (code, _signal) => {
      info.status = code === 0 ? "completed" : "failed";
      info.exitCode = code || undefined;
      info.completedAt = new Date().toISOString();
      delete info.process;

      logStream.write(
        `\nProcess ${id} exited with code ${code} at ${info.completedAt}\n`
      );
      logStream.end();

      // Log to worker console
      console.log(`[Process Manager] Process ${id} exited with code ${code}`);

      await this.saveProcessInfo(info);

      if (
        this.autoRestart &&
        info.status === "failed" &&
        info.restartCount < 5
      ) {
        console.error(
          `[Process Manager] Process ${id} failed, attempting restart...`
        );
        setTimeout(() => this.restartProcess(id), 5000);
      }
    });

    this.processes.set(id, info);
    await this.saveProcessInfo(info);

    // Start cloudflared tunnel if port is specified
    // Skip if we already have a tunnel URL (from restart)
    if (port && !info.tunnelUrl) {
      this.startTunnel(id, port, 0);
    } else if (port && info.tunnelUrl) {
      console.log(
        `[Process Manager] Reusing existing tunnel URL for ${id}: ${info.tunnelUrl}`
      );
    }

    return info;
  }

  private async startTunnel(
    id: string,
    port: number,
    retryCount: number = 0
  ): Promise<void> {
    const info = this.processes.get(id);
    if (!info) return;

    // Skip if we already have a working tunnel
    if (info.tunnelUrl && info.tunnelProcess) {
      console.log(
        `[MCP Process Manager] Tunnel already exists for ${id}: ${info.tunnelUrl}`
      );
      return;
    }

    // Add exponential backoff delay between retries to avoid rate limiting
    if (retryCount > 0) {
      // Start with 30s, then 60s, then 120s
      const delay = Math.min(30000 * 2 ** (retryCount - 1), 120000);
      console.error(
        `[MCP Process Manager] Cloudflare rate limit detected. Waiting ${delay / 1000}s before retry attempt ${retryCount + 1} for tunnel`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    const tunnelLogPath = path.join(this.logsDir, `${id}-tunnel.log`);
    const tunnelLogStream = await import("node:fs").then((fs) =>
      fs.createWriteStream(tunnelLogPath, { flags: "a" })
    );

    tunnelLogStream.write(
      `Starting cloudflared tunnel for port ${port} at ${new Date().toISOString()} (attempt ${retryCount + 1})\n`
    );

    // Log to worker console (use stderr so it appears in pod logs)
    console.error(
      `[MCP Process Manager] Starting cloudflared tunnel for process ${id} on port ${port} (attempt ${retryCount + 1})`
    );

    const tunnelChild = spawn(
      "cloudflared",
      ["tunnel", "--url", `http://localhost:${port}`],
      {
        detached: false,
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    // Handle spawn errors
    tunnelChild.on("error", (err) => {
      console.error(
        `[Process Manager] Failed to spawn cloudflared: ${err.message}`
      );
      tunnelLogStream.write(
        `ERROR: Failed to spawn cloudflared: ${err.message}\n`
      );
      info.tunnelUrl = undefined;
      delete info.tunnelProcess;
    });

    info.tunnelProcess = tunnelChild;

    // Extract the tunnel URL from cloudflared output
    let urlExtracted = false;
    const extractTimeout = setTimeout(() => {
      if (!urlExtracted) {
        tunnelLogStream.write(
          "Failed to extract tunnel URL within 15 seconds\n"
        );
        console.error(`Failed to extract tunnel URL for process ${id}`);

        // Kill the tunnel process if URL extraction fails
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

      // Log extraction attempt to tunnel log
      if (output.includes("trycloudflare.com")) {
        tunnelLogStream.write(
          `\n[MCP] Found trycloudflare.com in output, attempting extraction...\n`
        );
      }

      // Log cloudflared output to console for debugging (use stderr so it appears in pod logs)
      console.error(
        `[MCP Process Manager - Cloudflared Output] ${output.trim()}`
      );

      // Check for rate limiting error
      if (
        output.includes("429 Too Many Requests") ||
        output.includes("error code: 1015")
      ) {
        rateLimitDetected = true;
        tunnelLogStream.write(
          `\n[MCP] Rate limit detected (429 Too Many Requests)\n`
        );
        console.error(
          `[MCP Process Manager] Cloudflare rate limit detected (429 Too Many Requests)`
        );
      }

      // Look for the trycloudflare.com URL in the output
      // The most reliable approach is to just look for the URL pattern anywhere in the output
      const urlMatch = output.match(
        /https?:\/\/([a-z0-9-]+)\.trycloudflare\.com/i
      );
      if (urlMatch && !urlExtracted) {
        urlExtracted = true;
        clearTimeout(extractTimeout);
        const prefix = urlMatch[1];
        info.tunnelUrl = `https://${prefix}.peerbot.ai`;
        tunnelLogStream.write(
          `\n[MCP] Successfully extracted URL: ${urlMatch[0]}\n`
        );
        tunnelLogStream.write(
          `[MCP] Converted to peerbot.ai: ${info.tunnelUrl}\n`
        );
        console.error(
          `[MCP Process Manager - Tunnel ${id}] Established: ${info.tunnelUrl}`
        );
        console.error(
          `[MCP Process Manager - Tunnel ${id}] Original cloudflared URL: ${urlMatch[0]}`
        );
        this.saveProcessInfo(info);
      } else if (output.includes("trycloudflare.com") && urlExtracted) {
        tunnelLogStream.write(`\n[MCP] URL already extracted, skipping\n`);
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

      // Log exit details for debugging
      console.error(
        `[MCP Process Manager] Cloudflared exited with code ${code}, signal: ${signal}`
      );

      if (info.tunnelProcess === tunnelChild) {
        delete info.tunnelProcess;
        info.tunnelUrl = undefined;
        this.saveProcessInfo(info);

        // Retry if failed and haven't extracted URL, up to 3 attempts
        // Use longer delays if rate limited
        if (code !== 0 && !urlExtracted && retryCount < 2) {
          if (rateLimitDetected) {
            console.error(
              `[MCP Process Manager] Cloudflared hit rate limit - will retry with longer backoff (attempt ${retryCount + 2}/3)`
            );
          } else {
            console.error(
              `[MCP Process Manager] Cloudflared failed with exit code ${code} - retrying tunnel (attempt ${retryCount + 2}/3)`
            );
          }
          this.startTunnel(id, port, retryCount + 1);
        } else if (code !== 0 && !urlExtracted) {
          if (rateLimitDetected) {
            console.error(
              `[MCP Process Manager] Cloudflared rate limited after ${retryCount + 1} attempts - consider using alternative tunnel solution`
            );
          } else {
            console.error(
              `[MCP Process Manager] Cloudflared failed after ${retryCount + 1} attempts - tunnel not established`
            );
          }
        }
      }
    });

    tunnelChild.on("error", (error) => {
      clearTimeout(extractTimeout);
      tunnelLogStream.write(`Tunnel process error: ${error.message}\n`);
      console.error(
        `Failed to start cloudflared tunnel for process ${id}:`,
        error
      );

      if (!urlExtracted) {
        urlExtracted = true;
        info.tunnelUrl = undefined;
        delete info.tunnelProcess;
        this.saveProcessInfo(info);
      }
    });
  }

  async stopProcess(id: string): Promise<void> {
    const info = this.processes.get(id);
    if (!info) {
      throw new Error(`Process ${id} not found`);
    }

    if (info.status !== "running" || !info.pid) {
      throw new Error(`Process ${id} is not running`);
    }

    try {
      // Stop the tunnel process if it exists
      if (info.tunnelProcess?.pid) {
        try {
          process.kill(info.tunnelProcess.pid, "SIGTERM");
        } catch (_e) {
          // Tunnel process already terminated
        }
        delete info.tunnelProcess;
        info.tunnelUrl = undefined;
      }

      process.kill(info.pid, "SIGTERM");

      // Give process time to terminate gracefully
      setTimeout(() => {
        try {
          process.kill(info.pid!, "SIGKILL");
        } catch (_e) {
          // Process already terminated
        }
      }, 5000);

      info.status = "killed";
      info.completedAt = new Date().toISOString();
      delete info.process;

      await this.saveProcessInfo(info);
    } catch (error) {
      throw new Error(`Failed to kill process ${id}: ${error}`);
    }
  }

  async restartProcess(id: string): Promise<ProcessInfo> {
    const info = this.processes.get(id);
    if (!info) {
      throw new Error(`Process ${id} not found`);
    }

    // Preserve tunnel URL and process before stopping
    const preservedTunnelUrl = info.tunnelUrl;
    const preservedTunnelProcess = info.tunnelProcess;

    // Stop the main process but NOT the tunnel
    if (info.status === "running" && info.pid) {
      try {
        process.kill(info.pid, "SIGTERM");
        // Give process time to terminate gracefully
        await new Promise((resolve) => setTimeout(resolve, 1000));
        try {
          process.kill(info.pid!, "SIGKILL");
        } catch (_e) {
          // Process already terminated
        }
      } catch (_error) {
        // Process already terminated
      }
    }

    info.restartCount++;

    // Restore tunnel information before restarting
    info.tunnelUrl = preservedTunnelUrl;
    info.tunnelProcess = preservedTunnelProcess;

    return this.startProcess(
      id,
      info.command,
      info.description,
      info.port,
      true
    );
  }

  getStatus(id?: string): ProcessInfo | ProcessInfo[] | null {
    if (id) {
      return this.processes.get(id) || null;
    }
    return Array.from(this.processes.values());
  }

  async getLogs(id: string, lines: number = 50): Promise<string> {
    const logPath = this.getLogPath(id);
    if (!existsSync(logPath)) {
      return `No logs found for process ${id}`;
    }

    try {
      const content = await readFile(logPath, "utf-8");
      const allLines = content.split("\n");
      const lastLines = allLines.slice(-lines).join("\n");
      return lastLines;
    } catch (error) {
      return `Error reading logs for process ${id}: ${error}`;
    }
  }

  startMonitoring(interval: number = 30000) {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
    }

    this.autoRestart = true;
    this.monitorInterval = setInterval(() => {
      this.checkProcesses();
    }, interval);
  }

  stopMonitoring() {
    this.autoRestart = false;
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = undefined;
    }
  }

  private checkProcesses() {
    const entries = Array.from(this.processes.entries());
    for (const [id, info] of entries) {
      if (info.status === "running" && info.pid) {
        try {
          process.kill(info.pid, 0); // Check if process exists
        } catch (_e) {
          // Process is dead
          console.error(`Process ${id} died unexpectedly`);
          info.status = "failed";
          info.completedAt = new Date().toISOString();
          this.saveProcessInfo(info);

          if (this.autoRestart && info.restartCount < 5) {
            setTimeout(() => this.restartProcess(id), 5000);
          }
        }
      }
    }
  }
}

// Initialize MCP server
const manager = new ProcessManager();
const server = new McpServer({
  name: "Process Manager",
  version: "1.0.0",
});

// Register tools
server.tool(
  "start_process",
  "Start a background process with monitoring and optional tunnel",
  {
    id: z.string().describe("Unique identifier for the process"),
    command: z.string().describe("Command to execute"),
    description: z.string().describe("Description of what this process does"),
    port: z
      .number()
      .optional()
      .describe("Optional port to expose via cloudflared tunnel"),
  },
  async ({ id, command, description, port }) => {
    try {
      const info = await manager.startProcess(id, command, description, port);

      // If port is specified, wait for tunnel URL and verify service health
      if (port) {
        let tunnelUrl: string | undefined;
        let serviceHealthy = false;
        let healthCheckAttempts = 0;
        const maxHealthChecks = 15; // 15 attempts, 2 seconds each = 30 seconds total
        const healthCheckInterval = 2000; // 2 seconds between checks

        console.error(
          `[MCP Process Manager] Waiting for service on port ${port} to be ready...`
        );

        // Health check loop - verify the service is actually responding
        while (!serviceHealthy && healthCheckAttempts < maxHealthChecks) {
          healthCheckAttempts++;

          // Check if we have a tunnel URL yet
          const updatedInfo = manager.getStatus(id) as ProcessInfo | null;
          tunnelUrl = updatedInfo?.tunnelUrl;

          // Try to make an HTTP request to the local service
          try {
            const response = await fetch(`http://localhost:${port}/`, {
              method: "GET",
              signal: AbortSignal.timeout(1500), // 1.5 second timeout for each request
            });

            // Any response (even error codes) means the service is running
            if (response.status) {
              serviceHealthy = true;
              console.error(
                `[MCP Process Manager] Service on port ${port} is healthy (status: ${response.status})`
              );
              break;
            }
          } catch (_error: any) {
            // Service not ready yet
            if (healthCheckAttempts % 5 === 0) {
              console.error(
                `[MCP Process Manager] Service not ready on port ${port} (attempt ${healthCheckAttempts}/${maxHealthChecks})`
              );
            }
          }

          // Wait before next check
          await new Promise((resolve) =>
            setTimeout(resolve, healthCheckInterval)
          );
        }

        // Final check for tunnel URL if service is healthy
        if (serviceHealthy && !tunnelUrl) {
          // Give tunnel a bit more time to establish
          await new Promise((resolve) => setTimeout(resolve, 5000));
          const finalInfo = manager.getStatus(id) as ProcessInfo | null;
          tunnelUrl = finalInfo?.tunnelUrl;
        }

        if (serviceHealthy && tunnelUrl) {
          // Success - both service and tunnel are working
          return {
            content: [
              {
                type: "text",
                text: `✅ Started process ${id} (PID: ${info.pid})\n🌐 Tunnel URL: ${tunnelUrl}\n📡 Service verified on port ${port}`,
              },
            ],
          };
        } else if (serviceHealthy && !tunnelUrl) {
          // Service is running but tunnel failed - get tunnel logs
          let tunnelLogs = "";
          try {
            const tunnelLogPath = path.join(
              "/tmp/claude-logs",
              `${id}-tunnel.log`
            );
            if (existsSync(tunnelLogPath)) {
              tunnelLogs = await readFile(tunnelLogPath, "utf-8");
              const lines = tunnelLogs.split("\n");
              tunnelLogs = lines.slice(-20).join("\n");
            }
          } catch (_e) {
            // Tunnel log may not exist
          }

          return {
            content: [
              {
                type: "text",
                text: `⚠️ Process ${id} started (PID: ${info.pid})\n✅ Service running on port ${port}\n❌ Failed to establish tunnel\n\n**Tunnel Logs:**\n\`\`\`\n${tunnelLogs || "No tunnel logs available"}\n\`\`\``,
              },
            ],
          };
        } else {
          // Service failed to start - get both process and tunnel logs
          const processLogs = await manager.getLogs(id, 50);
          let tunnelLogs = "";
          try {
            const tunnelLogPath = path.join(
              "/tmp/claude-logs",
              `${id}-tunnel.log`
            );
            if (existsSync(tunnelLogPath)) {
              tunnelLogs = await readFile(tunnelLogPath, "utf-8");
              const lines = tunnelLogs.split("\n");
              tunnelLogs = lines.slice(-30).join("\n");
            }
          } catch (_e) {
            // Tunnel log may not exist
          }

          // Stop the failed process and tunnel
          try {
            await manager.stopProcess(id);
          } catch (_e) {
            // Process may have already stopped
          }

          return {
            content: [
              {
                type: "text",
                text: `❌ Service failed to respond on port ${port} after ${(maxHealthChecks * healthCheckInterval) / 1000} seconds\n\n**Process Logs:**\n\`\`\`\n${processLogs}\n\`\`\`${tunnelLogs ? `\n\n**Tunnel Logs:**\n\`\`\`\n${tunnelLogs}\n\`\`\`` : ""}`,
              },
            ],
            isError: true,
          };
        }
      }

      return {
        content: [
          {
            type: "text",
            text: `Started process ${id} (PID: ${info.pid})`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Failed to start process: ${error}`,
          },
        ],
        isError: true,
      };
    }
  }
);

server.tool(
  "stop_process",
  "Stop a running process",
  {
    id: z.string().describe("Process ID to stop"),
  },
  async ({ id }) => {
    try {
      await manager.stopProcess(id);
      return {
        content: [
          {
            type: "text",
            text: `Stopped process ${id}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Failed to stop process: ${error}`,
          },
        ],
        isError: true,
      };
    }
  }
);

server.tool(
  "restart_process",
  "Restart a process",
  {
    id: z.string().describe("Process ID to restart"),
  },
  async ({ id }) => {
    try {
      const info = await manager.restartProcess(id);
      return {
        content: [
          {
            type: "text",
            text: `Restarted process ${id} (PID: ${info.pid}, restart count: ${info.restartCount})`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Failed to restart process: ${error}`,
          },
        ],
        isError: true,
      };
    }
  }
);

server.tool(
  "get_process_status",
  "Get status of processes",
  {
    id: z.string().optional().describe("Process ID (omit to get all)"),
  },
  async ({ id }) => {
    const status = manager.getStatus(id);
    if (!status) {
      return {
        content: [
          {
            type: "text",
            text: `Process ${id} not found`,
          },
        ],
        isError: true,
      };
    }

    const processes = Array.isArray(status) ? status : [status];
    const statusText = processes
      .map(
        (p) =>
          `${p.id}: ${p.status}${p.pid ? ` (PID: ${p.pid})` : ""}
  Description: ${p.description}
  Started: ${p.startedAt}${p.completedAt ? `\n  Completed: ${p.completedAt}` : ""}${
    p.exitCode !== undefined ? `\n  Exit code: ${p.exitCode}` : ""
  }${p.port ? `\n  Port: ${p.port}` : ""}${p.tunnelUrl ? `\n  Tunnel URL: ${p.tunnelUrl}` : ""}
  Restart count: ${p.restartCount}`
      )
      .join("\n\n");

    return {
      content: [
        {
          type: "text",
          text: statusText || "No processes found",
        },
      ],
    };
  }
);

server.tool(
  "get_process_logs",
  "Get logs from a process",
  {
    id: z.string().describe("Process ID"),
    lines: z
      .number()
      .optional()
      .default(50)
      .describe("Number of lines to retrieve"),
  },
  async ({ id, lines }) => {
    const logs = await manager.getLogs(id, lines);
    return {
      content: [
        {
          type: "text",
          text: logs,
        },
      ],
    };
  }
);

// Process monitoring is enabled by default with 30 second interval
// It will automatically restart failed processes up to 5 times

// Register resources
server.resource(
  "processes://list",
  "List all managed processes",
  { mimeType: "application/json" },
  async () => {
    const processes = manager.getStatus() as ProcessInfo[];
    return {
      contents: [
        {
          uri: "processes://list",
          mimeType: "application/json",
          text: JSON.stringify(processes, null, 2),
        },
      ],
    };
  }
);

server.resource(
  "processes://logs/*",
  "Get logs for a specific process",
  { mimeType: "text/plain" },
  async (params: any) => {
    const uri = params.uri || params.url || params.toString();
    const id = uri.replace("processes://logs/", "");
    const logs = await manager.getLogs(id, 1000);
    return {
      contents: [
        {
          uri,
          mimeType: "text/plain",
          text: logs,
        },
      ],
    };
  }
);

server.resource(
  "processes://status/*",
  "Get status of a specific process",
  { mimeType: "application/json" },
  async (params: any) => {
    const uri = params.uri || params.url || params.toString();
    const id = uri.replace("processes://status/", "");
    const status = manager.getStatus(id);
    return {
      contents: [
        {
          uri,
          mimeType: "application/json",
          text: JSON.stringify(status, null, 2),
        },
      ],
    };
  }
);

// Start HTTP server
async function main() {
  const port = parseInt(process.env.MCP_PROCESS_MANAGER_PORT || "3001", 10);

  const express = await import("express");
  const cors = await import("cors");

  const app = express.default();

  // Add CORS middleware
  app.use(
    cors.default({
      origin: "*",
      methods: ["GET", "POST"],
      allowedHeaders: ["Content-Type"],
      exposedHeaders: ["Mcp-Session-Id"],
    })
  );

  app.use(express.default.json());

  // Store transports for SSE sessions
  const transports: Record<string, SSEServerTransport> = {};

  // SSE endpoint for establishing connections
  app.get("/sse", async (_req, res) => {
    const transport = new SSEServerTransport("/messages", res);
    transports[transport.sessionId] = transport;

    res.on("close", () => {
      delete transports[transport.sessionId];
    });

    await server.connect(transport);
  });

  // Message endpoint for client requests
  app.post("/messages", async (req, res) => {
    const sessionId = req.query.sessionId as string;
    const transport = transports[sessionId];
    if (transport) {
      await transport.handlePostMessage(req, res, req.body);
    } else {
      res.status(400).send("No transport found for sessionId");
    }
  });

  const httpServer = app.listen(port, () => {
    console.error(`[Process Manager MCP] HTTP server started on port ${port}`);
  });

  return {
    port,
    server,
    httpServer,
    close: async () => {
      httpServer.close();
      Object.values(transports).forEach((transport) => {
        try {
          transport.close?.();
        } catch (_e) {
          // Ignore close errors
        }
      });
    },
  };
}

// Export the main function so it can be started from worker process
export { main as startProcessManagerServer };

// Only run directly if this file is executed directly
if (
  typeof process !== "undefined" &&
  process.argv[1]
) {
  main().catch((error) => {
    console.error("[Process Manager MCP] Fatal error:", error);
    process.exit(1);
  });
}
