import {
  type BrowserAuthOptions,
  captureBrowserAuth,
} from "./_lib/browser-auth-cmd.js";

export async function memoryBrowserAuthCommand(
  options: BrowserAuthOptions
): Promise<void> {
  await captureBrowserAuth(options);
}
