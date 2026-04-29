import { printMemoryToken, type TokenOptions } from "./_lib/openclaw-cmd.js";

export async function memoryTokenCommand(options: TokenOptions): Promise<void> {
  await printMemoryToken(options);
}
