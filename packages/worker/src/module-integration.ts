import {
  moduleRegistry,
  type SessionContext,
  type ActionButton,
} from "../../../modules";

export async function onSessionStart(
  context: SessionContext
): Promise<SessionContext> {
  let updatedContext = context;

  const workerModules = moduleRegistry.getWorkerModules();
  for (const module of workerModules) {
    if (module.onSessionStart) {
      try {
        updatedContext = await module.onSessionStart(updatedContext);
      } catch (error) {
        console.error(
          `Failed to execute onSessionStart for module ${module.name}:`,
          error
        );
      }
    }
  }

  return updatedContext;
}

export async function onSessionEnd(
  context: SessionContext
): Promise<ActionButton[]> {
  const allButtons: ActionButton[] = [];

  const workerModules = moduleRegistry.getWorkerModules();
  for (const module of workerModules) {
    if (module.onSessionEnd) {
      try {
        const buttons = await module.onSessionEnd(context);
        allButtons.push(...buttons);
      } catch (error) {
        console.error(
          `Failed to execute onSessionEnd for module ${module.name}:`,
          error
        );
      }
    }
  }

  return allButtons;
}

export async function initModuleWorkspace(config: any): Promise<void> {
  const workerModules = moduleRegistry.getWorkerModules();
  for (const module of workerModules) {
    if (module.initWorkspace) {
      try {
        await module.initWorkspace(config);
      } catch (error) {
        console.error(
          `Failed to initialize workspace for module ${module.name}:`,
          error
        );
      }
    }
  }
}
