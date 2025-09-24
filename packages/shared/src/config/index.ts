import { z } from "zod";

/**
 * Centralized configuration management module
 * Handles environment variables consistently across all packages
 */

// Database configuration schema
export const DatabaseConfigSchema = z.object({
  connectionString: z.string().min(1, "Database connection string is required"),
  ssl: z.boolean().optional().default(false),
  maxConnections: z.number().optional().default(10),
});

// Slack configuration schema
export const SlackConfigSchema = z.object({
  botToken: z.string().min(1, "Slack bot token is required"),
  appToken: z.string().optional(),
  signingSecret: z.string().min(1, "Slack signing secret is required"),
  socketMode: z.boolean().optional().default(true),
  logLevel: z.enum(["DEBUG", "INFO", "WARN", "ERROR"]).optional().default("INFO"),
});

// GitHub configuration schema
export const GitHubConfigSchema = z.object({
  appId: z.string().optional(),
  privateKey: z.string().optional(),
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
  installationId: z.string().optional(),
});

// Claude configuration schema
export const ClaudeConfigSchema = z.object({
  apiKey: z.string().optional(),
  model: z.string().optional().default("claude-3-sonnet-20240229"),
  maxTokens: z.number().optional().default(4096),
});

// Queue configuration schema
export const QueueConfigSchema = z.object({
  connectionString: z.string().min(1, "Queue connection string is required"),
  jobTimeoutMs: z.number().optional().default(300000), // 5 minutes
  retryLimit: z.number().optional().default(3),
});

// Kubernetes configuration schema
export const KubernetesConfigSchema = z.object({
  namespace: z.string().optional().default("default"),
  workerImage: z.string().optional().default("claude-worker"),
  imagePullPolicy: z.enum(["Always", "Never", "IfNotPresent"]).optional().default("IfNotPresent"),
  resources: z.object({
    requests: z.object({
      cpu: z.string().optional().default("100m"),
      memory: z.string().optional().default("256Mi"),
    }).optional(),
    limits: z.object({
      cpu: z.string().optional().default("500m"),
      memory: z.string().optional().default("512Mi"),
    }).optional(),
  }).optional(),
});

// Complete application configuration schema
export const AppConfigSchema = z.object({
  database: DatabaseConfigSchema,
  slack: SlackConfigSchema,
  github: GitHubConfigSchema.optional(),
  claude: ClaudeConfigSchema.optional(),
  queue: QueueConfigSchema,
  kubernetes: KubernetesConfigSchema.optional(),
});

export type DatabaseConfig = z.infer<typeof DatabaseConfigSchema>;
export type SlackConfig = z.infer<typeof SlackConfigSchema>;
export type GitHubConfig = z.infer<typeof GitHubConfigSchema>;
export type ClaudeConfig = z.infer<typeof ClaudeConfigSchema>;
export type QueueConfig = z.infer<typeof QueueConfigSchema>;
export type KubernetesConfig = z.infer<typeof KubernetesConfigSchema>;
export type AppConfig = z.infer<typeof AppConfigSchema>;

/**
 * Loads database configuration from environment variables
 */
export function loadDatabaseConfig(): DatabaseConfig {
  const config = {
    connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL || "",
    ssl: process.env.DATABASE_SSL === "true",
    maxConnections: process.env.DATABASE_MAX_CONNECTIONS ? parseInt(process.env.DATABASE_MAX_CONNECTIONS, 10) : undefined,
  };

  return DatabaseConfigSchema.parse(config);
}

/**
 * Loads Slack configuration from environment variables
 */
export function loadSlackConfig(): SlackConfig {
  const config = {
    botToken: process.env.SLACK_BOT_TOKEN || "",
    appToken: process.env.SLACK_APP_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET || "",
    socketMode: process.env.SLACK_SOCKET_MODE !== "false",
    logLevel: (process.env.SLACK_LOG_LEVEL as any) || "INFO",
  };

  return SlackConfigSchema.parse(config);
}

/**
 * Loads GitHub configuration from environment variables
 */
export function loadGitHubConfig(): GitHubConfig {
  return GitHubConfigSchema.parse({
    appId: process.env.GITHUB_APP_ID,
    privateKey: process.env.GITHUB_PRIVATE_KEY,
    clientId: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
    installationId: process.env.GITHUB_INSTALLATION_ID,
  });
}

/**
 * Loads Claude configuration from environment variables
 */
export function loadClaudeConfig(): ClaudeConfig {
  return ClaudeConfigSchema.parse({
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: process.env.CLAUDE_MODEL,
    maxTokens: process.env.CLAUDE_MAX_TOKENS ? parseInt(process.env.CLAUDE_MAX_TOKENS, 10) : undefined,
  });
}

/**
 * Loads queue configuration from environment variables
 */
export function loadQueueConfig(): QueueConfig {
  const config = {
    connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL || "",
    jobTimeoutMs: process.env.JOB_TIMEOUT_MS ? parseInt(process.env.JOB_TIMEOUT_MS, 10) : undefined,
    retryLimit: process.env.JOB_RETRY_LIMIT ? parseInt(process.env.JOB_RETRY_LIMIT, 10) : undefined,
  };

  return QueueConfigSchema.parse(config);
}

/**
 * Loads Kubernetes configuration from environment variables
 */
export function loadKubernetesConfig(): KubernetesConfig {
  return KubernetesConfigSchema.parse({
    namespace: process.env.KUBERNETES_NAMESPACE,
    workerImage: process.env.WORKER_IMAGE,
    imagePullPolicy: (process.env.IMAGE_PULL_POLICY as any),
    resources: {
      requests: {
        cpu: process.env.WORKER_CPU_REQUEST,
        memory: process.env.WORKER_MEMORY_REQUEST,
      },
      limits: {
        cpu: process.env.WORKER_CPU_LIMIT,
        memory: process.env.WORKER_MEMORY_LIMIT,
      },
    },
  });
}

/**
 * Loads complete application configuration from environment variables
 */
export function loadConfig(): AppConfig {
  return AppConfigSchema.parse({
    database: loadDatabaseConfig(),
    slack: loadSlackConfig(),
    github: loadGitHubConfig(),
    claude: loadClaudeConfig(),
    queue: loadQueueConfig(),
    kubernetes: loadKubernetesConfig(),
  });
}

/**
 * Validates that required environment variables are present
 * @param requiredVars Array of required environment variable names
 * @throws Error if any required variables are missing
 */
export function validateRequiredEnvVars(requiredVars: string[]): void {
  const missing = requiredVars.filter(varName => !process.env[varName]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
}

/**
 * Gets an environment variable with optional default value
 * @param name Environment variable name
 * @param defaultValue Default value if environment variable is not set
 * @returns The environment variable value or default
 */
export function getEnvVar(name: string, defaultValue?: string): string | undefined {
  return process.env[name] || defaultValue;
}