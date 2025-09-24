/**
 * Centralized database utilities module
 * Consolidates database connection and operation logic
 */

// Re-export existing database utilities
export * from "./connection-pool";
export * from "./operations";

// Export types for better TypeScript support
export type { DatabasePool } from "./connection-pool";
export type {
  UserChannelEnvironment,
  UserRepositoryEnvironment,
  UserEnvironment,
} from "./operations";

// Re-export the main database pool function with a cleaner name
export { getDbPool as createDatabasePool } from "./connection-pool";