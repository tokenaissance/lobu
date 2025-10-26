import * as k8s from "@kubernetes/client-node";
import { createLogger, ErrorCode, OrchestratorError } from "@peerbot/core";
import {
  BaseDeploymentManager,
  type DeploymentInfo,
  type ModuleEnvVarsBuilder,
  type OrchestratorConfig,
  type QueueJobData,
} from "../base-deployment-manager";
import {
  BASE_WORKER_LABELS,
  WORKER_SELECTOR_LABELS,
  buildDeploymentInfoSummary,
  getVeryOldThresholdDays,
  resolvePlatformDeploymentMetadata,
} from "../deployment-utils";

const logger = createLogger("k8s-deployment");

// K8s-specific type definitions
interface K8sProbe {
  httpGet?: {
    path: string;
    port: number | string;
    scheme?: string;
  };
  exec?: {
    command: string[];
  };
  tcpSocket?: {
    port: number | string;
  };
  initialDelaySeconds?: number;
  periodSeconds?: number;
  timeoutSeconds?: number;
  successThreshold?: number;
  failureThreshold?: number;
}

interface SimpleDeployment {
  apiVersion: "apps/v1";
  kind: "Deployment";
  metadata: {
    name: string;
    namespace: string;
    labels?: Record<string, string>;
  };
  spec: {
    replicas: number;
    selector: {
      matchLabels: Record<string, string>;
    };
    template: {
      metadata: {
        labels: Record<string, string>;
        annotations?: Record<string, string>;
      };
      spec: {
        serviceAccountName?: string;
        runtimeClassName?: string;
        securityContext?: {
          fsGroup?: number;
          fsGroupChangePolicy?: "Always" | "OnRootMismatch";
          runAsUser?: number;
          runAsGroup?: number;
          runAsNonRoot?: boolean;
        };
        initContainers?: Array<{
          name: string;
          image: string;
          command?: string[];
          args?: string[];
          securityContext?: {
            runAsUser?: number;
            runAsGroup?: number;
            runAsNonRoot?: boolean;
            readOnlyRootFilesystem?: boolean;
          };
          resources?: {
            requests?: Record<string, string>;
            limits?: Record<string, string>;
          };
          volumeMounts?: Array<{
            name: string;
            mountPath: string;
          }>;
        }>;
        containers: Array<{
          name: string;
          image: string;
          imagePullPolicy?: string;
          command?: string[];
          args?: string[];
          securityContext?: {
            runAsUser?: number;
            runAsGroup?: number;
            runAsNonRoot?: boolean;
            readOnlyRootFilesystem?: boolean;
          };
          env?: Array<{
            name: string;
            value?: string;
            valueFrom?: {
              secretKeyRef?: {
                name: string;
                key: string;
              };
            };
          }>;
          ports?: Array<{
            name: string;
            containerPort: number;
            protocol?: string;
          }>;
          livenessProbe?: K8sProbe;
          readinessProbe?: K8sProbe;
          resources?: {
            requests?: Record<string, string>;
            limits?: Record<string, string>;
          };
          volumeMounts?: Array<{
            name: string;
            mountPath: string;
          }>;
        }>;
        volumes?: Array<{
          name: string;
          persistentVolumeClaim?: {
            claimName: string;
          };
          emptyDir?: {
            sizeLimit?: string;
          };
          hostPath?: {
            path: string;
            type?: string;
          };
        }>;
      };
    };
  };
}

export class K8sDeploymentManager extends BaseDeploymentManager {
  private appsV1Api: k8s.AppsV1Api;
  private coreV1Api: k8s.CoreV1Api;

  constructor(
    config: OrchestratorConfig,
    moduleEnvVarsBuilder?: ModuleEnvVarsBuilder
  ) {
    super(config, moduleEnvVarsBuilder);

    const kc = new k8s.KubeConfig();
    try {
      // Try in-cluster config first, then fall back to default
      if (process.env.KUBERNETES_SERVICE_HOST) {
        try {
          kc.loadFromCluster();
        } catch (_clusterError) {
          kc.loadFromDefault();
        }
      } else {
        kc.loadFromDefault();
      }

      // For development environments, disable TLS verification to avoid certificate issues
      if (
        process.env.NODE_ENV === "development" ||
        process.env.KUBERNETES_SERVICE_HOST?.includes("127.0.0.1") ||
        process.env.KUBERNETES_SERVICE_HOST?.includes("192.168") ||
        process.env.KUBERNETES_SERVICE_HOST?.includes("localhost")
      ) {
        const cluster = kc.getCurrentCluster();
        if (
          cluster &&
          typeof cluster === "object" &&
          cluster.skipTLSVerify !== true
        ) {
          // Safely set skipTLSVerify property with type checking
          Object.defineProperty(cluster, "skipTLSVerify", {
            value: true,
            writable: true,
            enumerable: true,
            configurable: true,
          });
        }
      }
    } catch (error) {
      logger.error("❌ Failed to load Kubernetes config:", error);
      throw new OrchestratorError(
        ErrorCode.DEPLOYMENT_CREATE_FAILED,
        `Failed to initialize Kubernetes client: ${error instanceof Error ? error.message : String(error)}`,
        { error },
        true
      );
    }

    // Configure K8s API clients
    this.appsV1Api = kc.makeApiClient(k8s.AppsV1Api);
    this.coreV1Api = kc.makeApiClient(k8s.CoreV1Api);

    // API clients are already configured with authentication through makeApiClient

    logger.info(
      `🔧 K8s client initialized with 30s timeout for namespace: ${this.config.kubernetes.namespace}`
    );
  }

  async listDeployments(): Promise<DeploymentInfo[]> {
    try {
      const k8sDeployments = await this.appsV1Api.listNamespacedDeployment(
        this.config.kubernetes.namespace
      );

      const now = Date.now();
      const idleThresholdMinutes = this.config.worker.idleCleanupMinutes;
      const veryOldDays = getVeryOldThresholdDays(this.config);

      const response = k8sDeployments as {
        body?: { items?: k8s.V1Deployment[] };
      };
      return (response.body?.items || []).map(
        (deployment: k8s.V1Deployment) => {
          const deploymentName = deployment.metadata?.name || "";
          const deploymentId = deploymentName.replace("peerbot-worker-", "");

          // Get last activity from annotations or fallback to creation time
          const lastActivityStr =
            deployment.metadata?.annotations?.["peerbot.io/last-activity"] ||
            deployment.metadata?.annotations?.["peerbot.io/created"] ||
            deployment.metadata?.creationTimestamp;

          const lastActivity = lastActivityStr
            ? new Date(lastActivityStr)
            : new Date();
          const replicas = deployment.spec?.replicas || 0;
          return buildDeploymentInfoSummary({
            deploymentName,
            deploymentId,
            lastActivity,
            now,
            idleThresholdMinutes,
            veryOldDays,
            replicas,
          });
        }
      );
    } catch (error) {
      throw new OrchestratorError(
        ErrorCode.DEPLOYMENT_CREATE_FAILED,
        `Failed to list deployments: ${error instanceof Error ? error.message : String(error)}`,
        { error },
        true
      );
    }
  }

  /**
   * Create a PersistentVolumeClaim for a worker deployment
   */
  private async createPVC(pvcName: string): Promise<void> {
    const pvc = {
      apiVersion: "v1",
      kind: "PersistentVolumeClaim",
      metadata: {
        name: pvcName,
        namespace: this.config.kubernetes.namespace,
        labels: {
          ...BASE_WORKER_LABELS,
          "app.kubernetes.io/component": "worker-storage",
        },
      },
      spec: {
        accessModes: ["ReadWriteOnce"],
        resources: {
          requests: {
            storage: this.config.worker.persistence?.size || "1Gi",
          },
        },
        ...(this.config.worker.persistence?.storageClass
          ? { storageClassName: this.config.worker.persistence.storageClass }
          : {}),
      },
    };

    try {
      await this.coreV1Api.createNamespacedPersistentVolumeClaim(
        this.config.kubernetes.namespace,
        pvc
      );
      logger.info(`✅ Created PVC: ${pvcName}`);
    } catch (error) {
      const k8sError = error as { statusCode?: number };
      if (k8sError.statusCode === 409) {
        logger.info(`PVC ${pvcName} already exists (reusing)`);
      } else {
        throw error;
      }
    }
  }

  async createDeployment(
    deploymentName: string,
    username: string,
    userId: string,
    messageData?: QueueJobData,
    userEnvVars: Record<string, string> = {}
  ): Promise<void> {
    logger.info(
      `🚀 Creating K8s deployment: ${deploymentName} for user ${userId}`
    );

    // Create PVC for this deployment (per-thread persistent storage)
    const pvcName = `${deploymentName}-pvc`;
    await this.createPVC(pvcName);

    // Get environment variables before creating the deployment spec
    const envVars = await this.generateEnvironmentVariables(
      username,
      userId,
      deploymentName,
      messageData,
      false,
      userEnvVars
    );

    const deployment: SimpleDeployment = {
      apiVersion: "apps/v1",
      kind: "Deployment",
      metadata: {
        name: deploymentName,
        namespace: this.config.kubernetes.namespace,
        labels: { ...BASE_WORKER_LABELS },
      },
      spec: {
        replicas: 1,
        selector: {
          matchLabels: { ...WORKER_SELECTOR_LABELS },
        },
        template: {
          metadata: {
            annotations: {
              // Add platform-specific metadata
              ...resolvePlatformDeploymentMetadata(messageData),
              "peerbot.io/created": new Date().toISOString(),
            },
            labels: { ...BASE_WORKER_LABELS },
          },
          spec: {
            serviceAccountName: "peerbot-worker",
            runtimeClassName: this.config.worker.runtimeClassName || "kata",
            securityContext: {
              fsGroup: 1001,
              fsGroupChangePolicy: "OnRootMismatch",
            },
            containers: [
              {
                name: "worker",
                image: `${this.config.worker.image.repository}:${this.config.worker.image.tag}`,
                imagePullPolicy:
                  this.config.worker.image.pullPolicy || "Always",
                securityContext: {
                  runAsUser: 1001,
                  runAsGroup: 1001,
                  runAsNonRoot: true,
                  readOnlyRootFilesystem: false,
                },
                env: [
                  // Common environment variables from base class (includes ANTHROPIC_API_KEY)
                  ...Object.entries(envVars).map(([key, value]) => ({
                    name: key,
                    value: value,
                  })),
                  // Pass NODE_ENV to worker pods
                  {
                    name: "NODE_ENV",
                    value: process.env.NODE_ENV || "production",
                  },
                  // Module-specific environment variables are added through base class
                ],
                resources: {
                  requests: this.config.worker.resources.requests,
                  limits: this.config.worker.resources.limits,
                },
                volumeMounts: [
                  {
                    name: "workspace",
                    mountPath: "/workspace",
                  },
                ],
              },
            ],
            volumes: [
              {
                name: "workspace",
                // Use per-deployment PVC for session persistence across scale-to-zero
                persistentVolumeClaim: {
                  claimName: pvcName,
                },
              },
            ],
          },
        },
      },
    };

    try {
      logger.info(`📦 Submitting deployment ${deploymentName} to K8s API...`);
      const response = await this.appsV1Api.createNamespacedDeployment(
        this.config.kubernetes.namespace,
        deployment
      );
      const statusResponse = response as { response?: { statusCode?: number } };
      logger.info(
        `✅ Deployment ${deploymentName} created successfully with status: ${statusResponse.response?.statusCode || "unknown"}`
      );
    } catch (error) {
      const k8sError = error as {
        statusCode?: number;
        message?: string;
        body?: unknown;
        response?: { statusMessage?: string };
        code?: string;
      };
      // Log detailed error information
      logger.error(`❌ Failed to create deployment ${deploymentName}:`, {
        statusCode: k8sError.statusCode,
        message: k8sError.message,
        body: k8sError.body,
        response: k8sError.response?.statusMessage,
      });

      // Check for specific error conditions and throw OrchestratorError
      if (k8sError.statusCode === 409) {
        throw new OrchestratorError(
          ErrorCode.DEPLOYMENT_CREATE_FAILED,
          `Deployment ${deploymentName} already exists`,
          { deploymentName, statusCode: 409 },
          false
        );
      } else if (k8sError.statusCode === 403) {
        throw new OrchestratorError(
          ErrorCode.DEPLOYMENT_CREATE_FAILED,
          `Insufficient permissions to create deployment ${deploymentName}`,
          { deploymentName, statusCode: 403 },
          true
        );
      } else if (k8sError.statusCode === 422) {
        throw new OrchestratorError(
          ErrorCode.DEPLOYMENT_CREATE_FAILED,
          `Invalid deployment specification for ${deploymentName}: ${JSON.stringify(k8sError.body)}`,
          { deploymentName, statusCode: 422, body: k8sError.body },
          true
        );
      } else if (
        k8sError.message?.includes("timeout") ||
        k8sError.code === "ETIMEDOUT"
      ) {
        throw new OrchestratorError(
          ErrorCode.DEPLOYMENT_CREATE_FAILED,
          `Timeout creating deployment ${deploymentName} - K8s API may be overloaded`,
          { deploymentName, code: k8sError.code },
          true
        );
      } else {
        throw new OrchestratorError(
          ErrorCode.DEPLOYMENT_CREATE_FAILED,
          `HTTP request failed: ${k8sError.message || k8sError.response?.statusMessage || "Unknown error"}`,
          { deploymentName, error },
          true
        );
      }
    }
  }

  async scaleDeployment(
    deploymentName: string,
    replicas: number
  ): Promise<void> {
    try {
      const deployment = await this.appsV1Api.readNamespacedDeployment(
        deploymentName,
        this.config.kubernetes.namespace
      );

      if ((deployment as any).body?.spec?.replicas !== replicas) {
        // Use a proper JSON patch for scaling
        const patch = [
          {
            op: "replace",
            path: "/spec/replicas",
            value: replicas,
          },
        ];

        await this.appsV1Api.patchNamespacedDeployment(
          deploymentName,
          this.config.kubernetes.namespace,
          patch,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          { headers: { "Content-Type": "application/json-patch+json" } }
        );
      }
    } catch (error) {
      throw new OrchestratorError(
        ErrorCode.DEPLOYMENT_SCALE_FAILED,
        `Failed to scale deployment ${deploymentName}: ${error instanceof Error ? error.message : String(error)}`,
        { deploymentName, replicas, error },
        true
      );
    }
  }

  async deleteDeployment(deploymentId: string): Promise<void> {
    const deploymentName = `peerbot-worker-${deploymentId}`;
    const pvcName = `${deploymentName}-pvc`;

    // Delete the deployment
    try {
      await this.appsV1Api.deleteNamespacedDeployment(
        deploymentName,
        this.config.kubernetes.namespace
      );
      logger.info(`✅ Deleted deployment: ${deploymentName}`);
    } catch (error) {
      const k8sError = error as { statusCode?: number };
      if (k8sError.statusCode === 404) {
        logger.info(
          `⚠️  Deployment ${deploymentName} not found (already deleted)`
        );
      } else {
        throw error;
      }
    }

    // Delete the PVC
    try {
      await this.coreV1Api.deleteNamespacedPersistentVolumeClaim(
        pvcName,
        this.config.kubernetes.namespace
      );
      logger.info(`✅ Deleted PVC: ${pvcName}`);
    } catch (error) {
      const k8sError = error as { statusCode?: number };
      if (k8sError.statusCode === 404) {
        logger.info(`⚠️  PVC ${pvcName} not found (already deleted)`);
      } else {
        logger.error(`Failed to delete PVC ${pvcName}:`, error);
        // Don't throw - deployment deletion should succeed even if PVC cleanup fails
      }
    }
  }

  async updateDeploymentActivity(deploymentName: string): Promise<void> {
    try {
      const timestamp = new Date().toISOString();
      const patch = {
        metadata: {
          annotations: {
            "peerbot.io/last-activity": timestamp,
          },
        },
      };

      await this.appsV1Api.patchNamespacedDeployment(
        deploymentName,
        this.config.kubernetes.namespace,
        patch,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { headers: { "Content-Type": "application/json-patch+json" } }
      );
    } catch (error) {
      logger.error(
        `❌ Failed to update activity for deployment ${deploymentName}:`,
        error instanceof Error ? error.message : String(error)
      );
      // Don't throw - activity tracking should not block message processing
    }
  }

  protected getDispatcherHost(): string {
    const dispatcherService =
      process.env.DISPATCHER_SERVICE_NAME || "peerbot-dispatcher";
    return `${dispatcherService}.${this.config.kubernetes.namespace}.svc.cluster.local`;
  }
}
