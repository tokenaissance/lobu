class CliError extends Error {
  constructor(
    message: string,
    public exitCode: number = 1
  ) {
    super(message);
    this.name = "CliError";
  }
}

export class ValidationError extends CliError {
  constructor(message: string) {
    super(message, 2);
    this.name = "ValidationError";
  }
}

export class ApiError extends CliError {
  constructor(
    message: string,
    public status?: number
  ) {
    super(message, 3);
    this.name = "ApiError";
  }
}
