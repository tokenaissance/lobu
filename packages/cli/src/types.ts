export interface TermosConfig {
  worker: WorkerConfig;
  gateway: GatewayConfig;
  credentials: CredentialsConfig;
  targets?: TargetsConfig;
}

export type WorkerImageSource =
  | { source: "base" }
  | { source: "dockerfile"; dockerfile?: string }
  | { source: "registry"; image: string };

export interface WorkerConfig {
  image?: string | WorkerImageSource;
  resources: ResourceConfig;
  environment?: Record<string, string>;
  volumes?: VolumeMount[];
  storage?: StorageConfig;
  scaling?: ScalingConfig;
}

export interface ResourceConfig {
  cpu: string;
  memory: string;
}

export interface VolumeMount {
  host: string;
  container: string;
  readOnly?: boolean;
}

export interface StorageConfig {
  workspace?: {
    type: "persistent" | "ephemeral";
    size?: string;
  };
}

export interface ScalingConfig {
  max?: number;
  idleTimeout?: string;
}

export interface GatewayConfig {
  port: number;
  publicUrl?: string;
}

export interface CredentialsConfig {
  slack: {
    signingSecret: string;
    botToken: string;
    appToken: string;
  };
  anthropic: {
    apiKey: string;
  };
}

export interface TargetsConfig {
  docker?: DockerTargetConfig;
}

export interface DockerTargetConfig {
  network?: string;
  compose?: {
    projectName?: string;
  };
}

export type DeploymentTarget = "docker";

export interface InitOptions {
  target: DeploymentTarget;
  projectName: string;
  customize: boolean;
}

export interface DeployOptions {
  target?: DeploymentTarget;
  values?: string;
}
