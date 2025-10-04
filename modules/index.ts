import type {
  ModuleInterface,
  HomeTabModule,
  WorkerModule,
  OrchestratorModule,
  DispatcherModule,
} from "./types";
import { GitHubModule } from "./github";

export class ModuleRegistry {
  private modules: Map<string, ModuleInterface> = new Map();

  register(module: ModuleInterface): void {
    if (module.isEnabled()) {
      this.modules.set(module.name, module);
    }
  }

  async initAll(): Promise<void> {
    // Auto-register available modules if not already registered
    this.autoRegisterModules();

    for (const module of this.modules.values()) {
      if (module.init) {
        await module.init();
      }
    }
  }

  private autoRegisterModules(): void {
    // Auto-register GitHub module
    const gitHubModule = new GitHubModule();
    if (!this.modules.has(gitHubModule.name)) {
      this.register(gitHubModule);
    }
  }

  getHomeTabModules(): HomeTabModule[] {
    return Array.from(this.modules.values()).filter(
      (m): m is HomeTabModule => "renderHomeTab" in m
    );
  }

  getWorkerModules(): WorkerModule[] {
    return Array.from(this.modules.values()).filter(
      (m): m is WorkerModule => "onSessionStart" in m || "onSessionEnd" in m
    );
  }

  getOrchestratorModules(): OrchestratorModule[] {
    return Array.from(this.modules.values()).filter(
      (m): m is OrchestratorModule => "buildEnvVars" in m
    );
  }

  getDispatcherModules(): DispatcherModule[] {
    return Array.from(this.modules.values()).filter(
      (m): m is DispatcherModule => "generateActionButtons" in m
    );
  }

  getModule<T extends ModuleInterface>(name: string): T | undefined {
    return this.modules.get(name) as T;
  }
}

// Global registry instance
export const moduleRegistry = new ModuleRegistry();

export * from "./types";
