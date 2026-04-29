import {
  type ConfigureOptions,
  configureMemoryPlugin,
} from "./_lib/openclaw-cmd.js";

export function memoryConfigureCommand(options: ConfigureOptions): void {
  configureMemoryPlugin(options);
}
