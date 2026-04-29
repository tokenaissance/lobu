import { type SeedOptions, seedMemoryWorkspace } from "./_lib/seed-cmd.js";

export async function memorySeedCommand(
  pathArg: string | undefined,
  options: SeedOptions
): Promise<void> {
  await seedMemoryWorkspace({ ...options, path: pathArg ?? options.path });
}
