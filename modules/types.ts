export interface ModuleInterface {
  /** Module identifier */
  name: string;

  /** Check if module should be enabled based on environment */
  isEnabled(): boolean;

  /** Initialize module - called once at startup */
  init?(): Promise<void>;
}

export interface HomeTabModule extends ModuleInterface {
  /** Render home tab elements */
  renderHomeTab?(userId: string): Promise<any[]>;

  /** Handle home tab interactions */
  handleHomeTabAction?(
    actionId: string,
    userId: string,
    value?: any
  ): Promise<void>;
}

export interface WorkerModule extends ModuleInterface {
  /** Initialize workspace - called when worker starts session */
  initWorkspace?(config: any): Promise<void>;

  /** Called at session start - can modify system prompt */
  onSessionStart?(context: SessionContext): Promise<SessionContext>;

  /** Called at session end - can add action buttons */
  onSessionEnd?(context: SessionContext): Promise<ActionButton[]>;
}

export interface OrchestratorModule extends ModuleInterface {
  /** Build environment variables for worker container */
  buildEnvVars?(
    userId: string,
    baseEnv: Record<string, string>
  ): Promise<Record<string, string>>;

  /** Get container address for module-specific services */
  getContainerAddress?(): string;
}

export interface DispatcherModule extends ModuleInterface {
  /** Generate action buttons for thread responses */
  generateActionButtons?(context: ThreadContext): Promise<ActionButton[]>;

  /** Handle action button clicks */
  handleAction?(
    actionId: string,
    userId: string,
    context: any
  ): Promise<boolean>;
}

export interface SessionContext {
  userId: string;
  threadId: string;
  repositoryUrl?: string;
  systemPrompt: string;
  workspace?: any;
}

export interface ActionButton {
  text: string;
  action_id: string;
  style?: "primary" | "danger";
  value?: string;
}

export interface ThreadContext {
  userId: string;
  channelId: string;
  threadTs: string;
  gitBranch?: string;
  hasGitChanges?: boolean;
  pullRequestUrl?: string;
  userMappings: Map<string, string>;
  slackClient?: any;
}
