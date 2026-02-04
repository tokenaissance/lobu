#!/usr/bin/env bun

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createLogger } from "@termosdev/core";
import { createMCPServer, startHTTPServer } from "./mcp-server";
import { startTunnel } from "./tunnel-manager";
import type {
  ProcessInfo,
  ProcessManagerApi,
  ProcessManagerInstance,
} from "./types";

const logger = createLogger("worker");

// ============================================================================
// PROCESS MANAGER INSTANCE STATE
// ============================================================================

let processManagerInstance: ProcessManagerInstance | null = null;

function getProcessManagerInstance(): ProcessManagerInstance | null {
  return processManagerInstance;
}

function setProcessManagerInstance(
  instance: ProcessManagerInstance | null
): void {
  processManagerInstance = instance;
}

// ============================================================================
// PROCESS MANAGER
// ============================================================================

class ProcessManager implements ProcessManagerApi {
  private processes: Map<string, ProcessInfo> = new Map();
  private processDir = "/tmp/agent-processes";
  private logsDir = "/tmp/claude-logs";

  constructor() {
    this.init();
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
      logger.error("Error loading existing processes:", error);
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
    workingDirectory?: string
  ): Promise<ProcessInfo> {
    if (this.processes.has(id)) {
      const existing = this.processes.get(id)!;
      if (existing.status === "running" && existing.pid) {
        throw new Error(
          `Process ${id} is already running with PID ${existing.pid}`
        );
      }
    }

    const info: ProcessInfo = {
      id,
      command,
      description,
      status: "starting",
      startedAt: new Date().toISOString(),
      port,
      workingDirectory: workingDirectory,
    };

    const logPath = this.getLogPath(id);
    const logStream = await import("node:fs").then((fs) =>
      fs.createWriteStream(logPath, { flags: "a" })
    );

    // Determine the working directory - use provided directory, then workspace, then cwd
    const workingDir =
      workingDirectory || process.env.WORKSPACE_DIR || process.cwd();

    // Validate working directory exists
    if (!existsSync(workingDir)) {
      throw new Error(`Working directory does not exist: ${workingDir}`);
    }

    logStream.write(`Process ${id} starting at ${info.startedAt}\n`);
    logStream.write(`Command: ${command}\n`);
    logStream.write(`Working Directory: ${workingDir}\n`);
    logStream.write(`Description: ${description}\n`);
    logStream.write("---\n");

    logger.info(`[Process Manager] Starting process ${id}: ${description}`);
    logger.info(`[Process Manager] Command: ${command}`);
    logger.info(`[Process Manager] Working Directory: ${workingDir}`);

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
      process.stdout.write(`[Process ${id}] ${data}`);
    });

    child.stderr?.on("data", (data) => {
      logStream.write(data);
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

      logger.info(`[Process Manager] Process ${id} exited with code ${code}`);

      await this.saveProcessInfo(info);

      // Kill tunnel if main process dies
      if (info.tunnelProcess?.pid) {
        logger.info(
          `[Process Manager] Stopping tunnel for ${id} since main process exited`
        );
        try {
          process.kill(info.tunnelProcess.pid, "SIGTERM");
        } catch (_e) {
          // Tunnel already dead
        }
        delete info.tunnelProcess;
        info.tunnelUrl = undefined;
      }
    });

    this.processes.set(id, info);
    await this.saveProcessInfo(info);

    // Start tunnel if port is specified
    if (port) {
      startTunnel(info, port, 0, this.saveProcessInfo.bind(this));
    }

    return info;
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

  async restartProcess(
    id: string,
    workingDirectory?: string
  ): Promise<ProcessInfo> {
    const info = this.processes.get(id);
    if (!info) {
      throw new Error(`Process ${id} not found`);
    }

    if (info.status === "running") {
      await this.stopProcess(id);
    }

    return this.startProcess(
      id,
      info.command,
      info.description,
      info.port,
      workingDirectory
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
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Start the process manager MCP server
 */
export async function startProcessManager(): Promise<ProcessManagerInstance> {
  const existingInstance = getProcessManagerInstance();
  if (existingInstance) {
    logger.info(
      "Process manager already running on port",
      existingInstance.port
    );
    return existingInstance;
  }

  try {
    logger.info("🔧 Starting process manager MCP server...");

    const manager = new ProcessManager();
    const server = createMCPServer(manager);
    const instance = await startHTTPServer(server);

    setProcessManagerInstance(instance);

    logger.info(
      `✅ Process manager MCP server started on port ${instance.port}`
    );
    return instance;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(
      `❌ Failed to start process manager MCP server: ${errorMessage}`
    );
    throw error;
  }
}

/**
 * Stop the process manager server
 */
export async function stopProcessManager(): Promise<void> {
  const instance = getProcessManagerInstance();
  if (instance) {
    logger.info("🛑 Stopping process manager MCP server...");
    await instance.stop();
    setProcessManagerInstance(null);
  }
}
