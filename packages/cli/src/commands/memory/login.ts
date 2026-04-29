import { type LoginOptions, memoryLogin } from "./_lib/openclaw-cmd.js";

export async function memoryLoginCommand(
  url: string | undefined,
  options: LoginOptions
): Promise<void> {
  await memoryLogin({ ...options, url: url ?? options.url });
}
