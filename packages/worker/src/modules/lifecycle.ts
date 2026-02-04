import {
  createLogger,
  type ModuleSessionContext,
  moduleRegistry,
  type SessionContext,
} from "@termosdev/core";

const logger = createLogger("worker");

export async function onSessionStart(
  context: SessionContext
): Promise<SessionContext> {
  // Convert to module session context
  const moduleContext: ModuleSessionContext = {
    userId: context.userId,
    threadId: context.threadId || "",
    systemPrompt: context.customInstructions || "",
    workspace: undefined,
  };

  let updatedContext = moduleContext;

  const workerModules = moduleRegistry.getWorkerModules();
  for (const module of workerModules) {
    try {
      updatedContext = await module.onSessionStart(updatedContext);
    } catch (error) {
      logger.error(
        `Failed to execute onSessionStart for module ${module.name}:`,
        error
      );
    }
  }

  // Merge back into original context, mapping systemPrompt back to customInstructions
  return {
    ...context,
    customInstructions:
      updatedContext.systemPrompt || context.customInstructions,
  };
}

/**
 * Configuration for module workspace initialization
 */
interface ModuleWorkspaceConfig {
  workspaceDir: string;
  username: string;
  sessionKey: string;
}

export async function initModuleWorkspace(
  config: ModuleWorkspaceConfig
): Promise<void> {
  const workerModules = moduleRegistry.getWorkerModules();
  for (const module of workerModules) {
    try {
      await module.initWorkspace(config);
    } catch (error) {
      logger.error(
        `Failed to initialize workspace for module ${module.name}:`,
        error
      );
    }
  }
}

export async function collectModuleData(context: {
  workspaceDir: string;
  userId: string;
  threadId: string;
}): Promise<Record<string, unknown>> {
  const moduleData: Record<string, unknown> = {};
  const workerModules = moduleRegistry.getWorkerModules();

  for (const module of workerModules) {
    try {
      const data = await module.onBeforeResponse(context);
      if (data !== null) {
        moduleData[module.name] = data;
      }
    } catch (error) {
      logger.error(`Failed to collect data from module ${module.name}:`, error);
    }
  }

  return moduleData;
}
