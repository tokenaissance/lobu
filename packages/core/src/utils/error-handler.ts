import type { Logger } from "../logger";
import { BaseError } from "../errors";

/**
 * Standard error handling utilities
 * Provides consistent error logging, wrapping, and recovery patterns
 */
export class ErrorHandler {
  constructor(private logger: Logger) {}

  /**
   * Wrap an async function with error handling
   * Logs errors and re-throws them
   *
   * @example
   * const result = await errorHandler.wrapAsync(
   *   async () => await someOperation(),
   *   { operation: "someOperation", userId }
   * );
   */
  async wrapAsync<T>(
    fn: () => Promise<T>,
    context: Record<string, unknown> = {}
  ): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      this.logAndRethrow(error, context);
    }
  }

  /**
   * Try an operation, returning a default value on error
   * Logs the error but doesn't throw
   *
   * @example
   * const value = errorHandler.tryOrDefault(
   *   () => JSON.parse(data),
   *   {},
   *   { operation: "parseJSON" }
   * );
   */
  tryOrDefault<T>(
    fn: () => T,
    defaultValue: T,
    context: Record<string, unknown> = {}
  ): T {
    try {
      return fn();
    } catch (error) {
      this.logger.error("Operation failed, using default value", {
        ...context,
        error: this.formatError(error),
        defaultValue,
      });
      return defaultValue;
    }
  }

  /**
   * Try an async operation, returning a default value on error
   * Logs the error but doesn't throw
   */
  async tryOrDefaultAsync<T>(
    fn: () => Promise<T>,
    defaultValue: T,
    context: Record<string, unknown> = {}
  ): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      this.logger.error("Async operation failed, using default value", {
        ...context,
        error: this.formatError(error),
        defaultValue,
      });
      return defaultValue;
    }
  }

  /**
   * Log an error with context and re-throw it
   * Preserves error type and stack trace
   */
  logAndRethrow(error: unknown, context: Record<string, unknown> = {}): never {
    const formattedError = this.formatError(error);

    if (error instanceof BaseError) {
      this.logger.error(error.getFullMessage(), {
        ...context,
        errorType: error.name,
        ...error.toJSON(),
      });
    } else {
      this.logger.error("Unexpected error occurred", {
        ...context,
        error: formattedError,
      });
    }

    throw error;
  }

  /**
   * Format an error for logging
   * Extracts relevant information from various error types
   */
  private formatError(error: unknown): Record<string, unknown> {
    if (error instanceof BaseError) {
      return error.toJSON();
    }

    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
        stack: error.stack,
        // Include any additional properties
        ...Object.getOwnPropertyNames(error).reduce(
          (acc, key) => {
            if (key !== "name" && key !== "message" && key !== "stack") {
              acc[key] = (error as any)[key];
            }
            return acc;
          },
          {} as Record<string, unknown>
        ),
      };
    }

    // For non-Error objects
    return {
      value: String(error),
      type: typeof error,
    };
  }

  /**
   * Wrap an error in a custom error type
   * Preserves the original error as cause
   *
   * @example
   * throw errorHandler.wrap(
   *   new WorkerError("deployment", "Failed to deploy"),
   *   originalError
   * );
   */
  wrap<T extends BaseError>(customError: T, originalError: unknown): T {
    if (originalError instanceof Error) {
      customError.cause = originalError;
    }
    return customError;
  }
}

/**
 * Create an error handler instance
 */
export function createErrorHandler(logger: Logger): ErrorHandler {
  return new ErrorHandler(logger);
}
