import { BASE_WORKER_LABELS } from "../../deployment-utils";

export const LOBU_FINALIZER = "lobu.io/cleanup";

/**
 * Worker security constants - must match Dockerfile.worker user configuration
 * The 'claude' user is created with UID/GID 1001 in the worker image
 */
export const WORKER_SECURITY = {
  USER_ID: 1001,
  GROUP_ID: 1001,
  TMP_SIZE_LIMIT: "100Mi",
} as const;

export const WORKER_SELECTOR_LABELS = {
  "app.kubernetes.io/name": BASE_WORKER_LABELS["app.kubernetes.io/name"],
  "app.kubernetes.io/component":
    BASE_WORKER_LABELS["app.kubernetes.io/component"],
} as const;

// K8s-specific type definitions
export interface K8sProbe {
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

export interface SimpleDeployment {
  apiVersion: "apps/v1";
  kind: "Deployment";
  metadata: {
    name: string;
    namespace: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
    finalizers?: string[];
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
        imagePullSecrets?: Array<{ name: string }>;
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
          imagePullPolicy?: string;
          command?: string[];
          args?: string[];
          securityContext?: {
            runAsUser?: number;
            runAsGroup?: number;
            runAsNonRoot?: boolean;
            readOnlyRootFilesystem?: boolean;
            allowPrivilegeEscalation?: boolean;
            capabilities?: {
              drop?: string[];
              add?: string[];
            };
          };
          resources?: {
            requests?: Record<string, string>;
            limits?: Record<string, string>;
          };
          volumeMounts?: Array<{
            name: string;
            mountPath: string;
            subPath?: string;
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
            allowPrivilegeEscalation?: boolean;
            capabilities?: {
              drop?: string[];
              add?: string[];
            };
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
            subPath?: string;
          }>;
        }>;
        volumes?: Array<{
          name: string;
          persistentVolumeClaim?: {
            claimName: string;
          };
          emptyDir?: {
            sizeLimit?: string;
            medium?: string;
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

export const IMAGE_PULL_FAILURE_REASONS = new Set([
  "ImagePullBackOff",
  "ErrImagePull",
  "InvalidImageName",
  "RegistryUnavailable",
]);
