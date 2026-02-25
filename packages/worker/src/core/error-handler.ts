import { createLogger, type WorkerTransport } from "@lobu/core";

const logger = createLogger("worker");

/**
 * Format error message for display
 * Generic error formatter that works for any AI agent
 */
function formatErrorMessage(error: unknown): string {
  let errorMsg = `💥 Worker crashed`;

  if (error instanceof Error) {
    errorMsg += `: ${error.message}`;
    // Add error type if it's not generic
    if (
      error.constructor.name !== "Error" &&
      error.constructor.name !== "WorkspaceError"
    ) {
      errorMsg = `💥 Worker crashed (${error.constructor.name}): ${error.message}`;
    }
  } else {
    errorMsg += ": Unknown error";
  }

  return errorMsg;
}

/**
 * Handle execution error - decides between authentication and generic errors
 * Generic error handler that works for any AI agent
 */
export async function handleExecutionError(
  error: unknown,
  transport: WorkerTransport
): Promise<void> {
  logger.error("Worker execution failed:", error);

  try {
    const errorMsg = formatErrorMessage(error);
    await transport.sendStreamDelta(errorMsg, true, true);
    await transport.signalError(
      error instanceof Error ? error : new Error(String(error))
    );
  } catch (gatewayError) {
    logger.error("Failed to send error via gateway:", gatewayError);
    // Re-throw the original error
    throw error;
  }
}
