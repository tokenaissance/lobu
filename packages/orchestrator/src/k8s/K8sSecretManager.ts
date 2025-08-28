import * as k8s from '@kubernetes/client-node';
import { BaseSecretManager } from '../base/BaseSecretManager';
import { OrchestratorConfig, OrchestratorError, ErrorCode } from '../types';

export class K8sSecretManager extends BaseSecretManager {
  private coreV1Api?: k8s.CoreV1Api;

  constructor(config: OrchestratorConfig) {
    super(config);
  }

  // Method to set the CoreV1Api after construction
  setCoreV1Api(coreV1Api: k8s.CoreV1Api): void {
    this.coreV1Api = coreV1Api;
  }

  private ensureCoreV1Api(): k8s.CoreV1Api {
    if (!this.coreV1Api) {
      throw new Error('CoreV1Api not initialized. Call setCoreV1Api first.');
    }
    return this.coreV1Api;
  }

  /**
   * Get existing password from secret or create new user credentials
   */
  async getOrCreateUserCredentials(username: string, createPostgresUser: (username: string, password: string) => Promise<void>): Promise<string> {
    const secretName = `peerbot-user-secret-${username.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}`;
    const coreV1Api = this.ensureCoreV1Api();
    
    try {
      // Try to read existing secret first
      const existingSecret = await coreV1Api.readNamespacedSecret(secretName, this.config.kubernetes.namespace);
      const existingPassword = Buffer.from(existingSecret.body.data?.['DB_PASSWORD'] || '', 'base64').toString();
      
      if (existingPassword) {
        console.log(`Found existing secret for user ${username}, using existing credentials`);
        return existingPassword;
      }
    } catch (error) {
      // Secret doesn't exist, will create new credentials
      console.log(`Secret ${secretName} does not exist, creating new credentials`);
    }
    
    // Generate new credentials
    const password = this.generatePassword();
    
    console.log(`Creating new credentials for user ${username}`);
    await createPostgresUser(username, password);
    await this.createUserSecret(username, password);
    return password;
  }

  /**
   * Create Kubernetes secret with PostgreSQL credentials
   */
  async createUserSecret(username: string, password: string): Promise<void> {
    const secretName = `peerbot-user-secret-${username.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}`;
    const coreV1Api = this.ensureCoreV1Api();
    
    try {
      // Check if secret already exists
      try {
        await coreV1Api.readNamespacedSecret(secretName, this.config.kubernetes.namespace);
        console.log(`Secret ${secretName} already exists`);
        return;
      } catch (error) {
        // Secret doesn't exist, create it
      }

      const dbHost = this.config.database.host;
      const dbPort = this.config.database.port;
      const dbName = this.config.database.database;
      
      const secretData = {
        'DATABASE_URL': Buffer.from(`postgres://${username}:${password}@${dbHost}:${dbPort}/${dbName}`).toString('base64'),
        'DB_USERNAME': Buffer.from(username).toString('base64'),
        'DB_PASSWORD': Buffer.from(password).toString('base64')
      };

      const secret = {
        apiVersion: 'v1',
        kind: 'Secret',
        metadata: {
          name: secretName,
          namespace: this.config.kubernetes.namespace,
          labels: {
            'app.kubernetes.io/name': 'peerbot',
            'app.kubernetes.io/component': 'worker',
            'peerbot/managed-by': 'orchestrator'
          }
        },
        type: 'Opaque',
        data: secretData
      };

      await coreV1Api.createNamespacedSecret(this.config.kubernetes.namespace, secret);
      console.log(`✅ Created secret: ${secretName}`);
    } catch (error) {
      throw new OrchestratorError(
        ErrorCode.DEPLOYMENT_CREATE_FAILED,
        `Failed to create user secret: ${error instanceof Error ? error.message : String(error)}`,
        { username, secretName, error },
        true
      );
    }
  }

  /**
   * Delete user secret
   */
  async deleteUserSecret(username: string): Promise<void> {
    const secretName = `peerbot-user-secret-${username.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}`;
    const coreV1Api = this.ensureCoreV1Api();
    
    try {
      await coreV1Api.deleteNamespacedSecret(secretName, this.config.kubernetes.namespace);
      console.log(`✅ Deleted secret: ${secretName}`);
    } catch (error: any) {
      if (error.statusCode === 404) {
        console.log(`⚠️  Secret ${secretName} not found (already deleted)`);
      } else {
        console.log(`⚠️  Failed to delete secret ${secretName}:`, error.message);
      }
    }
  }
}