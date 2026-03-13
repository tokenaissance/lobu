import fs from "node:fs";
import path from "node:path";
import { createLogger, ErrorCode, OrchestratorError } from "@lobu/core";
import type { ModelProviderModule } from "../../modules/module-system";
import {
  BaseDeploymentManager,
  type DeploymentInfo,
  type MessagePayload,
  type ModuleEnvVarsBuilder,
  type OrchestratorConfig,
} from "../base-deployment-manager";
import {
  buildDeploymentInfoSummary,
  getVeryOldThresholdDays,
} from "../deployment-utils";
import { createJustBashOperations } from "./embedded-bash-ops";

const logger = createLogger("orchestrator");

interface EmbeddedWorkerEntry {
  gatewayClient: { stop: () => Promise<void> };
  env: Record<string, string>;
  lastActivity: Date;
  workspaceDir: string;
  workerPromise: Promise<void>;
}

/** Execution limits for the just-bash sandbox. */
const EMBEDDED_BASH_LIMITS = {
  maxCommandCount: 50_000,
  maxLoopIterations: 50_000,
  maxCallDepth: 50,
} as const;

export class EmbeddedDeploymentManager extends BaseDeploymentManager {
  private workers: Map<string, EmbeddedWorkerEntry> = new Map();

  constructor(
    config: OrchestratorConfig,
    moduleEnvVarsBuilder?: ModuleEnvVarsBuilder,
    providerModules: ModelProviderModule[] = []
  ) {
    super(config, moduleEnvVarsBuilder, providerModules);
  }

  protected getDispatcherHost(): string {
    return "localhost";
  }

  async validateWorkerImage(): Promise<void> {
    const entryPoint = path.resolve("packages/worker/src/index.ts");
    if (!fs.existsSync(entryPoint)) {
      throw new OrchestratorError(
        ErrorCode.DEPLOYMENT_CREATE_FAILED,
        `Worker entry point not found: ${entryPoint}. Run from the project root.`
      );
    }
    logger.info(`Worker entry point verified: ${entryPoint}`);
  }

  async createDeployment(
    ...args: Parameters<BaseDeploymentManager["createDeployment"]>
  ): Promise<void> {
    const [deploymentName, username, userId, messageDataRaw] = args;
    const messageData = messageDataRaw as MessagePayload | undefined;

    const agentId = messageData?.agentId!;
    const workspaceDir = path.resolve(`workspaces/${agentId}`);
    fs.mkdirSync(workspaceDir, { recursive: true });

    const commonEnvVars = await this.generateEnvironmentVariables(
      username,
      userId,
      deploymentName,
      messageData,
      true
    );

    commonEnvVars.WORKSPACE_DIR = workspaceDir;
    commonEnvVars.DEPLOYMENT_MODE = "embedded";

    // Lazy-load just-bash so the module isn't required for other deployment modes
    const { Bash, ReadWriteFs } = await import("just-bash");

    // Create just-bash instance with ReadWriteFs scoped to workspace
    const bashFs = new ReadWriteFs({ root: workspaceDir });
    const bashInstance = new Bash({
      fs: bashFs,
      cwd: "/",
      env: commonEnvVars,
      executionLimits: EMBEDDED_BASH_LIMITS,
    });
    const bashOps = createJustBashOperations(bashInstance);

    // Set env vars on process.env for the worker to read.
    // NOTE: These must persist because the GatewayClient processes messages
    // asynchronously and creates new OpenClawWorker instances that read
    // from process.env. Sequential-only: one worker at a time.
    for (const [key, value] of Object.entries(commonEnvVars)) {
      process.env[key] = value;
    }

    // Dynamically import worker modules from the workspace
    const workerBasePath = path.resolve("packages/worker/src");
    const { setupWorkspaceEnv } = await import(
      `${workerBasePath}/core/workspace.ts`
    );
    const { GatewayClient } = await import(
      `${workerBasePath}/gateway/sse-client.ts`
    );
    const { startWorkerHttpServer } = await import(
      `${workerBasePath}/server.ts`
    );

    setupWorkspaceEnv(deploymentName);
    const httpPort = await startWorkerHttpServer();

    const client = new GatewayClient(
      this.getDispatcherUrl(),
      commonEnvVars.WORKER_TOKEN,
      userId,
      deploymentName,
      httpPort
    );

    // Start as async task (don't await - runs the SSE read loop)
    const workerPromise = client.start().catch((error: Error) => {
      logger.error(
        `Embedded worker ${deploymentName} failed: ${error.message}`
      );
      this.workers.delete(deploymentName);
    });

    // Expose bashOps on globalThis so the in-process worker picks it up
    (globalThis as any).__lobuEmbeddedBashOps = bashOps;

    this.workers.set(deploymentName, {
      gatewayClient: client,
      env: commonEnvVars,
      lastActivity: new Date(),
      workspaceDir,
      workerPromise,
    });

    logger.info(
      `Started embedded worker for ${deploymentName} (httpPort=${httpPort})`
    );
  }

  async scaleDeployment(
    deploymentName: string,
    replicas: number
  ): Promise<void> {
    const entry = this.workers.get(deploymentName);

    if (replicas === 0 && entry) {
      await entry.gatewayClient.stop();
      this.workers.delete(deploymentName);
      if (this.workers.size === 0) {
        delete (globalThis as any).__lobuEmbeddedBashOps;
      }
      logger.info(`Stopped embedded worker ${deploymentName}`);
    } else if (replicas === 1 && !entry) {
      logger.warn(
        `Cannot scale up ${deploymentName} — use createDeployment to re-spawn`
      );
    }
  }

  async deleteDeployment(deploymentName: string): Promise<void> {
    const entry = this.workers.get(deploymentName);
    if (entry) {
      await entry.gatewayClient.stop();
      this.workers.delete(deploymentName);
      if (this.workers.size === 0) {
        delete (globalThis as any).__lobuEmbeddedBashOps;
      }
      logger.info(`Stopped embedded worker: ${deploymentName}`);
    }
  }

  async listDeployments(): Promise<DeploymentInfo[]> {
    const now = Date.now();
    const idleThresholdMinutes = this.config.worker.idleCleanupMinutes;
    const veryOldDays = getVeryOldThresholdDays(this.config);

    const results: DeploymentInfo[] = [];
    for (const [deploymentName, entry] of this.workers) {
      results.push(
        buildDeploymentInfoSummary({
          deploymentName,
          lastActivity: entry.lastActivity,
          now,
          idleThresholdMinutes,
          veryOldDays,
          replicas: 1,
        })
      );
    }
    return results;
  }

  async updateDeploymentActivity(deploymentName: string): Promise<void> {
    const entry = this.workers.get(deploymentName);
    if (entry) {
      entry.lastActivity = new Date();
    }
  }
}
