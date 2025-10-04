import { BaseError } from "@peerbot/shared";

/**
 * Error class for GitHub repository operations
 */
export class GitHubRepositoryError extends BaseError {
  readonly name = "GitHubRepositoryError";

  constructor(
    public operation: string,
    public username: string,
    message: string,
    cause?: Error
  ) {
    super(message, cause);
  }

  toJSON(): Record<string, any> {
    return {
      ...super.toJSON(),
      operation: this.operation,
      username: this.username,
    };
  }
}
