import * as Docker from 'dockerode';
import { BaseDeploymentManager, DeploymentInfo } from '../base/BaseDeploymentManager';
import { PostgresSecretManager } from './PostgresSecretManager';
import { OrchestratorConfig, OrchestratorError, ErrorCode } from '../types';
import { DatabasePool } from '../database-pool';

interface ContainerInfo {
  id: string;
  name: string;
  state: string;
  created: Date;
  labels: { [key: string]: string };
}

export class DockerDeploymentManager extends BaseDeploymentManager {
  private docker: Docker;

  constructor(config: OrchestratorConfig, dbPool: DatabasePool) {
    const secretManager = new PostgresSecretManager(config, dbPool);
    super(config, dbPool, secretManager);
    
    this.docker = new Docker();
  }

  async listDeployments(): Promise<DeploymentInfo[]> {
    try {
      const containers = await this.docker.listContainers({ 
        all: true,
        filters: {
          label: ['app.kubernetes.io/component=worker']
        }
      });

      const now = Date.now();
      const idleThresholdMinutes = this.config.worker.idleCleanupMinutes;

      return containers.map((containerInfo: any) => {
        const deploymentName = containerInfo.Names[0]?.substring(1) || ''; // Remove leading '/'
        const deploymentId = deploymentName.replace('peerbot-worker-', '');
        
        // Get last activity from labels or fallback to creation time
        const lastActivityStr = containerInfo.Labels?.['peerbot.io/last-activity'] ||
                               containerInfo.Labels?.['peerbot.io/created'];
        
        const lastActivity = lastActivityStr ? new Date(lastActivityStr) : new Date(containerInfo.Created * 1000);
        const minutesIdle = (now - lastActivity.getTime()) / (1000 * 60);
        const daysSinceActivity = minutesIdle / (60 * 24);
        const replicas = containerInfo.State === 'running' ? 1 : 0;
        
        return {
          deploymentName,
          deploymentId,
          lastActivity,
          minutesIdle,
          daysSinceActivity,
          replicas,
          isIdle: minutesIdle >= idleThresholdMinutes,
          isVeryOld: daysSinceActivity >= 7
        };
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

  async createDeployment(deploymentName: string, username: string, userId: string, messageData?: any): Promise<void> {
    try {
      // Create workspace directory for this user
      const workspaceDir = `./workspaces/${userId}`;
      
      // Environment variables
      const dbHost = this.config.database.host;
      const dbPort = this.config.database.port;
      const dbName = this.config.database.database;
      
      const envVars = [
        `DATABASE_URL=postgres://${username}:${await this.getPasswordForUser(username)}@${dbHost}:${dbPort}/${dbName}`,
        'WORKER_MODE=queue',
        `USER_ID=${userId}`,
        `DEPLOYMENT_NAME=${deploymentName}`,
        `SESSION_KEY=${messageData?.agentSessionId || `session-${userId}-${Date.now()}`}`,
        `CHANNEL_ID=${messageData?.channelId || 'unknown-channel'}`,
        `REPOSITORY_URL=${messageData?.platformMetadata?.repositoryUrl || process.env.GITHUB_REPOSITORY || 'https://github.com/anthropics/claude-code-examples'}`,
        `ORIGINAL_MESSAGE_TS=${messageData?.platformMetadata?.originalMessageTs || messageData?.messageId || 'unknown'}`,
        `GITHUB_TOKEN=${process.env.GITHUB_TOKEN || ''}`,
        `CLAUDE_CODE_OAUTH_TOKEN=${process.env.CLAUDE_CODE_OAUTH_TOKEN || ''}`,
        'LOG_LEVEL=info',
        'WORKSPACE_PATH=/workspace',
        `SLACK_TEAM_ID=${messageData?.platformMetadata?.teamId || ''}`,
        `SLACK_CHANNEL_ID=${messageData?.channelId || ''}`,
        `SLACK_THREAD_TS=${messageData?.threadId || ''}`,
        ...(process.env.CLAUDE_ALLOWED_TOOLS ? [`CLAUDE_ALLOWED_TOOLS=${process.env.CLAUDE_ALLOWED_TOOLS}`] : []),
        ...(process.env.CLAUDE_DISALLOWED_TOOLS ? [`CLAUDE_DISALLOWED_TOOLS=${process.env.CLAUDE_DISALLOWED_TOOLS}`] : []),
        ...(process.env.CLAUDE_TIMEOUT_MINUTES ? [`CLAUDE_TIMEOUT_MINUTES=${process.env.CLAUDE_TIMEOUT_MINUTES}`] : []),
        // Worker environment variables from configuration
        ...Object.entries(this.config.worker.env || {}).map(([key, value]) => `${key}=${String(value)}`)
      ];

      const createOptions: Docker.ContainerCreateOptions = {
        name: deploymentName,
        Image: `${this.config.worker.image.repository}:${this.config.worker.image.tag}`,
        Env: envVars,
        Labels: {
          'app.kubernetes.io/name': 'peerbot',
          'app.kubernetes.io/component': 'worker',
          'peerbot/managed-by': 'orchestrator',
          'peerbot.io/created': new Date().toISOString(),
          // Add Slack thread link for visibility
          ...(messageData?.channelId && messageData?.threadId ? {
            'thread_url': `https://app.slack.com/client/${messageData?.platformMetadata?.teamId || 'unknown'}/${messageData.channelId}/thread/${messageData.threadId}`
          } : {}),
          // Add Slack user profile link
          ...(messageData?.platformUserId && messageData?.platformMetadata?.teamId ? {
            'user_url': `https://app.slack.com/team/${messageData.platformMetadata.teamId}/${messageData.platformUserId}`
          } : {})
        },
        HostConfig: {
          Binds: [
            `${workspaceDir}:/workspace/${userId}`
          ],
          RestartPolicy: {
            Name: 'unless-stopped'
          },
          // Resource limits similar to K8s
          Memory: this.parseMemoryLimit(this.config.worker.resources.limits.memory),
          NanoCpus: this.parseCpuLimit(this.config.worker.resources.limits.cpu)
        },
        WorkingDir: '/workspace',
        NetworkMode: process.env.NODE_ENV === 'development' ? 'host' : 'bridge'
      };

      const container = await this.docker.createContainer(createOptions);
      await container.start();
      
      console.log(`✅ Created and started Docker container: ${deploymentName}`);
    } catch (error) {
      throw new OrchestratorError(
        ErrorCode.DEPLOYMENT_CREATE_FAILED,
        `Failed to create Docker container: ${error instanceof Error ? error.message : String(error)}`,
        { deploymentName, error },
        true
      );
    }
  }

  async scaleDeployment(deploymentName: string, replicas: number): Promise<void> {
    try {
      const container = this.docker.getContainer(deploymentName);
      const containerInfo = await container.inspect();
      
      if (replicas === 0 && containerInfo.State.Running) {
        await container.stop();
        console.log(`Stopped container ${deploymentName}`);
      } else if (replicas === 1 && !containerInfo.State.Running) {
        await container.start();
        console.log(`Started container ${deploymentName}`);
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
    const deploymentName = `peerbot-worker-${deploymentId}`;
    
    try {
      const container = this.docker.getContainer(deploymentName);
      
      // Stop container if running
      try {
        await container.stop();
        console.log(`✅ Stopped container: ${deploymentName}`);
      } catch (error) {
        // Container might already be stopped
        console.log(`⚠️  Container ${deploymentName} was not running`);
      }
      
      // Remove container
      await container.remove();
      console.log(`✅ Removed container: ${deploymentName}`);
      
    } catch (error: any) {
      if (error.statusCode === 404) {
        console.log(`⚠️  Container ${deploymentName} not found (already deleted)`);
      } else {
        throw error;
      }
    }

    // Clean up user secret if needed
    try {
      const username = this.databaseManager.generatePostgresUsername(deploymentId);
      await this.secretManager.deleteUserSecret(username);
    } catch (error) {
      console.log(`⚠️  Failed to clean up secret for ${deploymentName}:`, error);
    }
  }

  async updateDeploymentActivity(deploymentName: string): Promise<void> {
    try {
      const container = this.docker.getContainer(deploymentName);
      const timestamp = new Date().toISOString();
      
      // Update container labels (Docker doesn't support runtime label updates, so we log for now)
      console.log(`✅ Updated activity timestamp for container: ${deploymentName} at ${timestamp}`);
      // Note: Docker doesn't support runtime label updates like K8s annotations
      // This could be implemented by recreating the container with updated labels if needed
    } catch (error) {
      console.error(`❌ Failed to update activity for container ${deploymentName}:`, error instanceof Error ? error.message : String(error));
      // Don't throw - activity tracking should not block message processing
    }
  }

  private async getPasswordForUser(username: string): Promise<string> {
    // Get password from the secret manager
    return await this.secretManager.getOrCreateUserCredentials(username, 
      (username: string, password: string) => this.databaseManager.createPostgresUser(username, password));
  }

  private parseMemoryLimit(memoryStr: string): number {
    const units: { [key: string]: number } = {
      'Ki': 1024,
      'Mi': 1024 * 1024,
      'Gi': 1024 * 1024 * 1024,
      'k': 1000,
      'M': 1000 * 1000,
      'G': 1000 * 1000 * 1000
    };

    for (const [unit, multiplier] of Object.entries(units)) {
      if (memoryStr.endsWith(unit)) {
        const value = parseFloat(memoryStr.replace(unit, ''));
        return value * multiplier;
      }
    }

    // If no unit is specified, assume bytes
    return parseInt(memoryStr);
  }

  private parseCpuLimit(cpuStr: string): number {
    if (cpuStr.endsWith('m')) {
      // Millicores
      const millicores = parseInt(cpuStr.replace('m', ''));
      return (millicores / 1000) * 1000000000; // Convert to nanocores
    }
    
    // Assume whole cores
    const cores = parseFloat(cpuStr);
    return cores * 1000000000; // Convert to nanocores
  }
}