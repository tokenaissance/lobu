import { checkMemoryHealth, type HealthOptions } from "./_lib/openclaw-cmd.js";

export async function memoryHealthCommand(
  options: HealthOptions
): Promise<void> {
  await checkMemoryHealth(options);
}
