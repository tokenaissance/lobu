export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Error class for client-input failures inside MCP/REST tools (bad path,
 * not-found, validation errors). Carries an HTTP status so the REST proxy
 * can return the right code, and is recognised by `trackMCPToolCall` to
 * avoid noisy Sentry alerts on 4xx-class outcomes.
 */
export class ToolUserError extends Error {
  readonly httpStatus: number;

  constructor(message: string, httpStatus = 400) {
    super(message);
    this.name = 'ToolUserError';
    this.httpStatus = httpStatus;
  }
}
