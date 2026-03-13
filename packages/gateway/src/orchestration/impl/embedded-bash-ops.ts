/**
 * Adapter from just-bash to the BashOperations interface used by
 * pi-coding-agent's bash tool.
 *
 * Routes exec(command, cwd) to a just-bash Bash instance and converts the
 * buffered result into the streaming onData callback expected by BashOperations.
 */

/**
 * BashOperations interface from @mariozechner/pi-coding-agent.
 * Duplicated here to avoid a direct dependency on the worker's packages.
 */
export interface BashOperations {
  exec: (
    command: string,
    cwd: string,
    options: {
      onData: (data: Buffer) => void;
      signal?: AbortSignal;
      timeout?: number;
      env?: NodeJS.ProcessEnv;
    }
  ) => Promise<{ exitCode: number | null }>;
}

/** Minimal interface for the just-bash Bash instance to avoid static imports. */
interface JustBashInstance {
  exec: (
    command: string,
    options?: {
      cwd?: string;
      signal?: AbortSignal;
      env?: Record<string, string>;
    }
  ) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
}

/**
 * Create a BashOperations adapter backed by a just-bash Bash instance.
 *
 * The just-bash exec() returns a complete result (stdout/stderr/exitCode).
 * This adapter buffers then emits the output via the onData callback
 * that pi-coding-agent expects.
 */
export function createJustBashOperations(
  bashInstance: JustBashInstance
): BashOperations {
  return {
    async exec(command, cwd, { onData, signal, timeout }) {
      const timeoutMs =
        timeout !== undefined && timeout > 0 ? timeout * 1000 : undefined;

      const result = await bashInstance.exec(command, {
        cwd,
        signal,
        env: { TIMEOUT_MS: timeoutMs ? String(timeoutMs) : "" },
      });

      // Emit stdout then stderr as Buffer chunks (just-bash returns strings)
      if (result.stdout) {
        onData(Buffer.from(result.stdout));
      }
      if (result.stderr) {
        onData(Buffer.from(result.stderr));
      }

      return { exitCode: result.exitCode };
    },
  };
}
