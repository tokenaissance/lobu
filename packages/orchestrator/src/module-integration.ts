import { moduleRegistry } from "../../../modules";

export async function buildModuleEnvVars(
  userId: string,
  baseEnv: Record<string, string>
): Promise<Record<string, string>> {
  let envVars = { ...baseEnv };

  const orchestratorModules = moduleRegistry.getOrchestratorModules();
  for (const module of orchestratorModules) {
    if (module.buildEnvVars) {
      try {
        envVars = await module.buildEnvVars(userId, envVars);
      } catch (error) {
        console.error(
          `Failed to build env vars for module ${module.name}:`,
          error
        );
      }
    }
  }

  return envVars;
}
