import path from "node:path";
import { createLogger, ErrorCode, OrchestratorError } from "@peerbot/core";
import Docker from "dockerode";
import {
  BaseDeploymentManager,
  type DeploymentInfo,
  type ModuleEnvVarsBuilder,
  type OrchestratorConfig,
  type QueueJobData,
} from "../base-deployment-manager";
import {
  BASE_WORKER_LABELS,
  ResourceParser,
  buildDeploymentInfoSummary,
  getVeryOldThresholdDays,
  resolvePlatformDeploymentMetadata,
} from "../deployment-utils";

const logger = createLogger("orchestrator");

export class DockerDeploymentManager extends BaseDeploymentManager {
  private docker: Docker;
  private gvisorAvailable = false;

  constructor(
    config: OrchestratorConfig,
    moduleEnvVarsBuilder?: ModuleEnvVarsBuilder
  ) {
    super(config, moduleEnvVarsBuilder);

    // Explicitly use the Unix socket for Docker connection
    this.docker = new Docker({ socketPath: "/var/run/docker.sock" });

    // Check for gvisor availability on initialization
    this.checkGvisorAvailability();
  }

  private async checkGvisorAvailability(): Promise<void> {
    try {
      const info = await this.docker.info();
      const runtimes = info.Runtimes || {};

      if (runtimes.runsc || runtimes.gvisor) {
        this.gvisorAvailable = true;
        logger.info(
          "✅ gVisor runtime detected and will be used for worker isolation"
        );
      } else {
        logger.info(
          "ℹ️  gVisor runtime not available, using default runc runtime"
        );
      }
    } catch (error) {
      logger.warn(
        `⚠️  Failed to check Docker runtime availability: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async listDeployments(): Promise<DeploymentInfo[]> {
    try {
      const containers = await this.docker.listContainers({
        all: true,
        filters: {
          label: ["app.kubernetes.io/component=worker"],
        },
      });

      const now = Date.now();
      const idleThresholdMinutes = this.config.worker.idleCleanupMinutes;
      const veryOldDays = getVeryOldThresholdDays(this.config);

      return containers.map((containerInfo: Docker.ContainerInfo) => {
        const deploymentName = containerInfo.Names[0]?.substring(1) || ""; // Remove leading '/'
        // The deploymentId is now the full deployment name (includes user ID)
        const deploymentId = deploymentName;

        // Get last activity from labels or fallback to creation time
        const lastActivityStr =
          containerInfo.Labels?.["peerbot.io/last-activity"] ||
          containerInfo.Labels?.["peerbot.io/created"];

        const lastActivity = lastActivityStr
          ? new Date(lastActivityStr)
          : new Date(containerInfo.Created * 1000);
        const replicas = containerInfo.State === "running" ? 1 : 0;
        return buildDeploymentInfoSummary({
          deploymentName,
          deploymentId,
          lastActivity,
          now,
          idleThresholdMinutes,
          veryOldDays,
          replicas,
        });
      });
    } catch (error) {
      throw new OrchestratorError(
        ErrorCode.DEPLOYMENT_CREATE_FAILED,
        `Failed to list Docker containers: ${error instanceof Error ? error.message : String(error)}`,
        { error },
        true
      );
    }
  }

  async createDeployment(
    ...args: Parameters<BaseDeploymentManager["createDeployment"]>
  ): Promise<void> {
    const [deploymentName, username, userId, messageDataRaw, userEnvVarsRaw] =
      args;
    const messageData = messageDataRaw as QueueJobData | undefined;
    const userEnvVars =
      (userEnvVarsRaw as Record<string, string> | undefined) ?? {};

    try {
      // Extract thread ID from deployment name for per-thread workspace isolation
      const threadId = deploymentName.replace("peerbot-worker-", "");

      // For Docker mode, we need to use host paths for volume mounts
      // The orchestrator is running inside Docker but needs to mount host directories
      const isRunningInDocker = process.env.DEPLOYMENT_MODE === "docker";
      const projectRoot = isRunningInDocker
        ? process.env.HOST_PROJECT_PATH || "/app" // Use env var or fallback
        : path.join(process.cwd(), "..", "..");

      const workspaceDir = `${projectRoot}/workspaces/${threadId}`;

      // Get common environment variables from base class
      const commonEnvVars = await this.generateEnvironmentVariables(
        username,
        userId,
        deploymentName,
        messageData,
        true,
        userEnvVars
      );

      // On macOS/Windows, Docker containers need to use host.docker.internal instead of localhost
      if (process.platform === "darwin" || process.platform === "win32") {
        if (
          commonEnvVars.PEERBOT_DATABASE_HOST === "localhost" ||
          commonEnvVars.PEERBOT_DATABASE_HOST === "127.0.0.1"
        ) {
          commonEnvVars.PEERBOT_DATABASE_HOST = "host.docker.internal";
        }
      }

      const envVars = [
        `ANTHROPIC_API_KEY=${username}:`,
        // Pass NODE_ENV to worker container
        `NODE_ENV=${process.env.NODE_ENV || "production"}`,
        // Enable SDK debugging for crash investigation
        "DEBUG=1",
        // Convert common environment variables to Docker format
        ...Object.entries(commonEnvVars).map(
          ([key, value]) => `${key}=${value}`
        ),
      ];

      // Get the Docker Compose project name from environment or use default
      const composeProjectName = process.env.COMPOSE_PROJECT_NAME || "peerbot";

      const createOptions: Docker.ContainerCreateOptions = {
        name: deploymentName,
        Image: `${this.config.worker.image.repository}:${this.config.worker.image.tag}`,
        Env: envVars,
        Labels: {
          ...BASE_WORKER_LABELS,
          "peerbot.io/created": new Date().toISOString(),
          // Docker Compose labels to associate with the project
          "com.docker.compose.project": composeProjectName,
          "com.docker.compose.service": deploymentName, // Use unique service name
          "com.docker.compose.oneoff": "False",
          // Add platform-specific metadata
          ...resolvePlatformDeploymentMetadata(messageData),
        },
        HostConfig: {
          Binds:
            process.env.NODE_ENV === "development" && isRunningInDocker
              ? [
                  `${workspaceDir}:/workspace`,
                  // Mount packages for hot reload
                  `${process.env.HOST_PROJECT_PATH}/packages:/app/packages`,
                  `${process.env.HOST_PROJECT_PATH}/scripts:/app/scripts`,
                  // Additional dev mounts from environment (e.g., startup-builder)
                  ...(process.env.WORKER_DEV_MOUNTS
                    ? process.env.WORKER_DEV_MOUNTS.split(";").map((mount) => {
                        // Replace ${HOST_PROJECT_PATH} and ${WORKSPACE_DIR} placeholders
                        return mount
                          .replace(
                            "${HOST_PROJECT_PATH}",
                            process.env.HOST_PROJECT_PATH!
                          )
                          .replace("${WORKSPACE_DIR}", workspaceDir);
                      })
                    : []),
                ]
              : [`${workspaceDir}:/workspace`],
          RestartPolicy: {
            Name: "unless-stopped",
          },
          // Resource limits similar to K8s
          Memory: ResourceParser.parseMemory(
            this.config.worker.resources.limits.memory
          ),
          NanoCpus: ResourceParser.parseCpu(
            this.config.worker.resources.limits.cpu
          ),
          // Connect to the Docker Compose network
          NetworkMode: `${composeProjectName}_peerbot-network`,
          // Use gVisor runtime if available for enhanced isolation
          ...(this.gvisorAvailable && {
            Runtime: "runsc",
          }),
        },
        WorkingDir: "/workspace",
      };

      const container = await this.docker.createContainer(createOptions);
      await container.start();

      logger.info(`✅ Created and started Docker container: ${deploymentName}`);
    } catch (error) {
      throw new OrchestratorError(
        ErrorCode.DEPLOYMENT_CREATE_FAILED,
        `Failed to create Docker container: ${error instanceof Error ? error.message : String(error)}`,
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
      const container = this.docker.getContainer(deploymentName);
      const containerInfo = await container.inspect();

      if (replicas === 0 && containerInfo.State.Running) {
        await container.stop();
        logger.info(`Stopped container ${deploymentName}`);
      } else if (replicas === 1 && !containerInfo.State.Running) {
        await container.start();
        logger.info(`Started container ${deploymentName}`);
      }
    } catch (error) {
      throw new OrchestratorError(
        ErrorCode.DEPLOYMENT_SCALE_FAILED,
        `Failed to scale Docker container ${deploymentName}: ${error instanceof Error ? error.message : String(error)}`,
        { deploymentName, replicas, error },
        true
      );
    }
  }

  async deleteDeployment(deploymentId: string): Promise<void> {
    // deploymentId should already be the full deployment name
    const deploymentName = deploymentId.startsWith("peerbot-worker-")
      ? deploymentId
      : `peerbot-worker-${deploymentId}`;

    try {
      const container = this.docker.getContainer(deploymentName);

      // Stop container if running
      try {
        await container.stop();
        logger.info(`✅ Stopped container: ${deploymentName}`);
      } catch (_error) {
        // Container might already be stopped
        logger.warn(`⚠️  Container ${deploymentName} was not running`);
      }

      // Remove container
      await container.remove();
      logger.info(`✅ Removed container: ${deploymentName}`);
    } catch (error) {
      const dockerError = error as { statusCode?: number };
      if (dockerError.statusCode === 404) {
        logger.warn(
          `⚠️  Container ${deploymentName} not found (already deleted)`
        );
      } else {
        throw error;
      }
    }
  }

  async updateDeploymentActivity(_deploymentName: string): Promise<void> {
    // Docker doesn't support runtime label updates like K8s annotations
    // Activity tracking is done via container creation timestamp only
  }

  protected getDispatcherHost(): string {
    // Use the Docker Compose service name for reliable network resolution
    return "gateway";
  }
}
