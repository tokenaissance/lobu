import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs/promises";
import {
  BaseDeploymentManager,
  type DeploymentInfo,
} from "../base/BaseDeploymentManager";
import type { DatabasePool } from "@peerbot/shared";
import {
  ErrorCode,
  type OrchestratorConfig,
  OrchestratorError,
} from "../types";
import { PostgresSecretManager } from "../docker/PostgresSecretManager";
import { createLogger } from "@peerbot/shared";
import { ProcessTracker, type ProcessInfo } from "./ProcessTracker";
import {
  generateBwrapArgs,
  checkBwrapAvailable,
  getBwrapVersion,
} from "./SecurityPolicy";

const logger = createLogger("subprocess-deployment");

export class SubprocessDeploymentManager extends BaseDeploymentManager {
  private processTracker: ProcessTracker;
  private bwrapAvailable = false;
  private isMacOS = process.platform === "darwin";

  constructor(config: OrchestratorConfig, dbPool: DatabasePool) {
    const secretManager = new PostgresSecretManager(config, dbPool);
    super(config, dbPool, secretManager);
    this.processTracker = new ProcessTracker();
  }

  /**
   * Initialize and check for bubblewrap availability
   */
  async initialize(): Promise<void> {
    this.bwrapAvailable = await checkBwrapAvailable();

    if (!this.bwrapAvailable && !this.isMacOS) {
      throw new OrchestratorError(
        ErrorCode.DEPLOYMENT_CREATE_FAILED,
        "Bubblewrap (bwrap) is not installed. Install it with: apt-get install bubblewrap (Debian/Ubuntu)",
        {},
        true
      );
    }

    if (this.isMacOS && !this.bwrapAvailable) {
      logger.warn(
        "⚠️  Running on macOS without bubblewrap. Falling back to UNSANDBOXED subprocess mode for development only."
      );
      logger.warn(
        "⚠️  DO NOT USE IN PRODUCTION. Workers will run without any isolation!"
      );
    } else {
      const version = await getBwrapVersion();
      logger.info(
        `✅ Subprocess deployment manager initialized with bubblewrap: ${version || "unknown version"}`
      );
    }

    logger.warn(
      "⚠️  Subprocess mode shares the host kernel. Not recommended for untrusted multi-tenant workloads."
    );
  }

  async listDeployments(): Promise<DeploymentInfo[]> {
    try {
      // Clean up dead processes first
      this.processTracker.cleanup();

      const now = Date.now();
      const idleThresholdMinutes = this.config.worker.idleCleanupMinutes;
      const processes = this.processTracker.getAll();

      return processes.map((info: ProcessInfo) => {
        const minutesIdle = (now - info.lastActivity.getTime()) / (1000 * 60);
        const daysSinceActivity = minutesIdle / (60 * 24);
        const isRunning = this.processTracker.isRunning(info.deploymentName);

        return {
          deploymentName: info.deploymentName,
          deploymentId: info.deploymentId,
          lastActivity: info.lastActivity,
          minutesIdle,
          daysSinceActivity,
          replicas: isRunning ? 1 : 0,
          isIdle: minutesIdle >= idleThresholdMinutes,
          isVeryOld: daysSinceActivity >= 7,
        };
      });
    } catch (error) {
      throw new OrchestratorError(
        ErrorCode.DEPLOYMENT_CREATE_FAILED,
        `Failed to list subprocess deployments: ${error instanceof Error ? error.message : String(error)}`,
        { error },
        true
      );
    }
  }

  async createDeployment(
    deploymentName: string,
    username: string,
    userId: string,
    messageData?: any,
    userEnvVars: Record<string, string> = {}
  ): Promise<void> {
    try {
      // Check if already exists
      if (this.processTracker.get(deploymentName)) {
        logger.info(`⚠️  Deployment ${deploymentName} already exists`);
        return;
      }

      // Extract thread ID from deployment name for per-thread workspace isolation
      const threadId = deploymentName.replace("peerbot-worker-", "");

      // Create workspace directory
      const projectRoot = path.join(process.cwd(), "..", "..");
      const workspaceDir = path.join(projectRoot, "workspaces", threadId);

      // Ensure workspace directory exists with proper permissions
      await fs.mkdir(workspaceDir, { recursive: true, mode: 0o755 });
      logger.info(`📁 Created workspace directory: ${workspaceDir}`);

      // Get password for database authentication
      const password = await this.getPasswordForUser(username);

      // Get common environment variables from base class
      const commonEnvVars = await this.generateEnvironmentVariables(
        username,
        userId,
        deploymentName,
        messageData,
        true,
        userEnvVars
      );

      // Add subprocess-specific environment variables
      const envVars = {
        ...commonEnvVars,
        PEERBOT_DATABASE_USERNAME: username,
        PEERBOT_DATABASE_PASSWORD: password,
        ANTHROPIC_API_KEY: `${username}:${password}`,
        WORKSPACE_PATH: "/workspace",
        HOME: "/workspace",
        PATH: "/usr/local/bin:/usr/bin:/bin",
      };

      // Determine worker command
      // In production, this would be the worker binary
      // In development, we use bun to run the worker
      const workerScript = path.join(
        projectRoot,
        "packages/worker/src/index.ts"
      );
      const workerCommand =
        process.env.NODE_ENV === "development"
          ? ["bun", "run", workerScript]
          : ["node", "/app/worker/index.js"];

      let childProcess;

      if (this.bwrapAvailable) {
        // Generate bubblewrap arguments with security hardening
        const bwrapArgs = generateBwrapArgs(
          workspaceDir,
          envVars,
          workerCommand
        );

        logger.info(
          `🚀 Starting sandboxed worker: ${deploymentName} with bubblewrap`
        );
        logger.debug(`Command: bwrap ${bwrapArgs.join(" ")}`);

        // Spawn the sandboxed process
        childProcess = spawn("bwrap", bwrapArgs, {
          detached: false, // Keep attached so we can track it
          stdio: ["ignore", "pipe", "pipe"], // Capture stdout/stderr
          cwd: workspaceDir,
        });
      } else {
        // Fallback for macOS: Run without sandbox (DEVELOPMENT ONLY)
        logger.warn(
          `⚠️  Starting UNSANDBOXED worker: ${deploymentName} (macOS development mode)`
        );

        const [command, ...args] = workerCommand;
        if (!command) {
          throw new Error("Worker command is empty");
        }
        childProcess = spawn(command, args, {
          detached: false,
          stdio: ["ignore", "pipe", "pipe"],
          cwd: workspaceDir,
          env: {
            ...process.env,
            ...envVars,
          },
        });
      }

      if (!childProcess.pid) {
        throw new Error("Failed to start subprocess - no PID assigned");
      }

      // Log stdout/stderr
      childProcess.stdout?.on("data", (data) => {
        logger.debug(`[${deploymentName}] ${data.toString().trim()}`);
      });

      childProcess.stderr?.on("data", (data) => {
        logger.error(`[${deploymentName}] ${data.toString().trim()}`);
      });

      // Handle process exit
      childProcess.on("exit", (code, signal) => {
        logger.info(
          `🛑 Worker ${deploymentName} exited with code ${code}, signal ${signal}`
        );
        this.processTracker.unregister(deploymentName);
      });

      childProcess.on("error", (error) => {
        logger.error(`❌ Worker ${deploymentName} error:`, error.message);
        this.processTracker.unregister(deploymentName);
      });

      // Register the process
      this.processTracker.register({
        deploymentName,
        deploymentId: threadId,
        process: childProcess,
        pid: childProcess.pid,
        lastActivity: new Date(),
        userId,
        threadId,
      });

      logger.info(
        `✅ Created subprocess deployment: ${deploymentName} (PID: ${childProcess.pid})`
      );
    } catch (error) {
      throw new OrchestratorError(
        ErrorCode.DEPLOYMENT_CREATE_FAILED,
        `Failed to create subprocess deployment: ${error instanceof Error ? error.message : String(error)}`,
        { deploymentName, error },
        true
      );
    }
  }

  async scaleDeployment(
    deploymentName: string,
    replicas: number
  ): Promise<void> {
    try {
      const info = this.processTracker.get(deploymentName);
      if (!info) {
        logger.warn(`⚠️  Deployment ${deploymentName} not found for scaling`);
        return;
      }

      if (replicas === 0) {
        // Stop process with SIGSTOP (pause)
        this.processTracker.kill(deploymentName, "SIGSTOP");
        logger.info(`⏸️  Paused deployment ${deploymentName}`);
      } else if (replicas === 1) {
        // Resume process with SIGCONT
        this.processTracker.kill(deploymentName, "SIGCONT");
        logger.info(`▶️  Resumed deployment ${deploymentName}`);
      }
    } catch (error) {
      throw new OrchestratorError(
        ErrorCode.DEPLOYMENT_SCALE_FAILED,
        `Failed to scale subprocess deployment ${deploymentName}: ${error instanceof Error ? error.message : String(error)}`,
        { deploymentName, replicas, error },
        true
      );
    }
  }

  async deleteDeployment(deploymentId: string): Promise<void> {
    const deploymentName = deploymentId.startsWith("peerbot-worker-")
      ? deploymentId
      : `peerbot-worker-${deploymentId}`;

    try {
      const info = this.processTracker.get(deploymentName);
      if (!info) {
        logger.warn(`⚠️  Deployment ${deploymentName} not found for deletion`);
        return;
      }

      // Try graceful shutdown first
      logger.info(`🛑 Sending SIGTERM to ${deploymentName} (PID: ${info.pid})`);
      this.processTracker.kill(deploymentName, "SIGTERM");

      // Wait 5 seconds for graceful shutdown
      await new Promise((resolve) => setTimeout(resolve, 5000));

      // Force kill if still running
      if (this.processTracker.isRunning(deploymentName)) {
        logger.warn(
          `⚠️  Process ${deploymentName} did not respond to SIGTERM, sending SIGKILL`
        );
        this.processTracker.kill(deploymentName, "SIGKILL");
      }

      this.processTracker.unregister(deploymentName);
      logger.info(`✅ Deleted deployment: ${deploymentName}`);
    } catch (error: any) {
      logger.error(
        `❌ Failed to delete deployment ${deploymentName}:`,
        error.message
      );
      // Don't throw - best effort cleanup
    }
  }

  async updateDeploymentActivity(deploymentName: string): Promise<void> {
    try {
      this.processTracker.updateActivity(deploymentName);
    } catch (error) {
      logger.error(
        `❌ Failed to update activity for ${deploymentName}:`,
        error instanceof Error ? error.message : String(error)
      );
      // Don't throw - activity tracking should not block message processing
    }
  }

  private async getPasswordForUser(username: string): Promise<string> {
    // Get password from the secret manager
    return await this.secretManager.getOrCreateUserCredentials(
      username,
      (username: string, password: string) =>
        this.databaseManager.createPostgresUser(username, password)
    );
  }

  /**
   * Get process tracker statistics
   */
  getStats() {
    return {
      totalProcesses: this.processTracker.count(),
      processes: this.processTracker.getAll().map((info) => ({
        deploymentName: info.deploymentName,
        pid: info.pid,
        lastActivity: info.lastActivity,
        running: this.processTracker.isRunning(info.deploymentName),
      })),
    };
  }
}
