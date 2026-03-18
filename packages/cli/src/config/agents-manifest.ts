/**
 * Agents manifest — written to .lobu/agents.json by the CLI,
 * read by the gateway on startup to seed agent settings into Redis.
 */
// NOTE: Keep in sync with packages/gateway/src/services/agent-seeder.ts

export interface AgentsManifest {
  version: 1;
  agents: AgentManifestEntry[];
}

export interface AgentManifestEntry {
  agentId: string;
  name: string;
  description?: string;
  settings: {
    identityMd?: string;
    soulMd?: string;
    userMd?: string;
    installedProviders?: Array<{
      providerId: string;
    }>;
    modelSelection?: {
      mode: "auto" | "pinned";
      pinnedModel?: string;
    };
    providerModelPreferences?: Record<string, string>;
    nixConfig?: {
      packages?: string[];
      flakeUrl?: string;
    };
    skillsConfig?: {
      skills: Array<{
        repo: string;
        name: string;
        description?: string;
        content: string;
        enabled: boolean;
        system?: boolean;
        integrations?: Array<{
          id: string;
          label?: string;
          authType?: string;
          scopesConfig?: { default: string[]; available: string[] };
          scopes?: string[];
          apiDomains?: string[];
        }>;
        mcpServers?: Array<{
          id: string;
          name?: string;
          url?: string;
          type?: string;
          command?: string;
          args?: string[];
        }>;
        nixPackages?: string[];
        permissions?: string[];
        providers?: string[];
        modelPreference?: string;
        thinkingLevel?: "off" | "low" | "medium" | "high";
      }>;
    };
    networkConfig?: {
      allowedDomains?: string[];
      deniedDomains?: string[];
    };
    mcpServers?: Record<
      string,
      {
        url?: string;
        command?: string;
        args?: string[];
        env?: Record<string, string>;
        headers?: Record<string, string>;
        oauth?: {
          authUrl: string;
          tokenUrl: string;
          clientId?: string;
          clientSecret?: string;
          scopes?: string[];
          tokenEndpointAuthMethod?: string;
        };
      }
    >;
  };
  credentials?: Array<{
    providerId: string;
    key: string;
  }>;
  connections?: Array<{
    type: string;
    config: Record<string, string>;
  }>;
}
