import { BaseSecretManager } from '../base/BaseSecretManager';
import { OrchestratorConfig, OrchestratorError, ErrorCode } from '../types';
import { DatabasePool } from '../database-pool';

export class PostgresSecretManager extends BaseSecretManager {
  private dbPool: DatabasePool;

  constructor(config: OrchestratorConfig, dbPool: DatabasePool) {
    super(config);
    this.dbPool = dbPool;
  }

  /**
   * Get existing password from database or create new user credentials
   */
  async getOrCreateUserCredentials(username: string, createPostgresUser: (username: string, password: string) => Promise<void>): Promise<string> {
    try {
      // Try to read existing credentials from database
      const result = await this.dbPool.query(
        `SELECT environment_variables->'DB_PASSWORD' as password FROM user_configs WHERE environment_variables ? 'DB_USERNAME' AND environment_variables->>'DB_USERNAME' = $1`,
        [username]
      );
      
      if (result.rows.length > 0 && result.rows[0].password) {
        const existingPassword = result.rows[0].password.replace(/"/g, ''); // Remove JSON quotes
        console.log(`Found existing credentials for user ${username}`);
        return existingPassword;
      }
    } catch (error) {
      console.log(`Error reading existing credentials for ${username}, creating new ones:`, error);
    }
    
    // Generate new credentials
    const password = this.generatePassword();
    
    console.log(`Creating new credentials for user ${username}`);
    await createPostgresUser(username, password);
    await this.createUserSecret(username, password);
    return password;
  }

  /**
   * Store user credentials in database HSTORE field
   */
  async createUserSecret(username: string, password: string): Promise<void> {
    try {
      const dbHost = this.config.database.host;
      const dbPort = this.config.database.port;
      const dbName = this.config.database.database;
      
      const envVars = {
        DATABASE_URL: `postgres://${username}:${password}@${dbHost}:${dbPort}/${dbName}`,
        DB_USERNAME: username,
        DB_PASSWORD: password
      };

      // Insert or update user config with environment variables
      await this.dbPool.query(`
        INSERT INTO user_configs (user_id, environment_variables, created_at, updated_at) 
        VALUES ($1, $2, NOW(), NOW())
        ON CONFLICT (user_id) 
        DO UPDATE SET 
          environment_variables = user_configs.environment_variables || $2,
          updated_at = NOW()
      `, [username, JSON.stringify(envVars)]);

      console.log(`✅ Stored credentials in database for user: ${username}`);
    } catch (error) {
      throw new OrchestratorError(
        ErrorCode.DEPLOYMENT_CREATE_FAILED,
        `Failed to store user credentials in database: ${error instanceof Error ? error.message : String(error)}`,
        { username, error },
        true
      );
    }
  }

  /**
   * Delete user credentials from database
   */
  async deleteUserSecret(username: string): Promise<void> {
    try {
      // Remove the specific environment variables for this user
      await this.dbPool.query(`
        UPDATE user_configs 
        SET environment_variables = environment_variables - 'DATABASE_URL' - 'DB_USERNAME' - 'DB_PASSWORD',
            updated_at = NOW()
        WHERE environment_variables->>'DB_USERNAME' = $1
      `, [username]);

      console.log(`✅ Removed credentials from database for user: ${username}`);
    } catch (error) {
      console.log(`⚠️  Failed to delete credentials for user ${username}:`, error instanceof Error ? error.message : String(error));
    }
  }
}