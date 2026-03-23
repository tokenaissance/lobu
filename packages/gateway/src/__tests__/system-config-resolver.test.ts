import { describe, expect, test } from "bun:test";
import type { ProviderConfigEntry, SkillConfig } from "@lobu/core";
import { SystemConfigResolver } from "../services/system-config-resolver";

class MockSystemSkillsService {
  constructor(
    private readonly providers: Record<string, ProviderConfigEntry>,
    private readonly skills: SkillConfig[]
  ) {}

  async getProviderConfigs(): Promise<Record<string, ProviderConfigEntry>> {
    return this.providers;
  }

  async getSystemSkills(): Promise<SkillConfig[]> {
    return this.skills;
  }
}

describe("SystemConfigResolver MCP and provider resolution", () => {
  test("builds global MCP server map and registry entries from system skills", async () => {
    const resolver = new SystemConfigResolver(
      new MockSystemSkillsService(
        {
          groq: {
            displayName: "Groq",
            iconUrl: "https://example.com/groq.png",
            envVarName: "GROQ_API_KEY",
            upstreamBaseUrl: "https://api.groq.com/openai",
            apiKeyInstructions: "Get key",
            apiKeyPlaceholder: "gsk_...",
          },
        },
        [
          {
            repo: "system/owletto",
            name: "Owletto",
            enabled: true,
            description: "Memory MCP",
            mcpServers: [
              {
                id: "owletto",
                name: "Owletto",
                url: "https://owletto.com/mcp",
              },
              { id: "local-tool", command: "mcp-local", args: ["--stdio"] },
            ],
          } as SkillConfig,
        ]
      ) as any
    );

    const globalMcp = await resolver.getGlobalMcpServers();
    const registryEntries = await resolver.getMcpRegistryServers();
    const providers = await resolver.getProviderConfigs();

    expect(globalMcp.owletto).toEqual({
      type: "sse",
      url: "https://owletto.com/mcp",
    });
    expect(globalMcp["local-tool"]).toEqual({
      type: "stdio",
      command: "mcp-local",
      args: ["--stdio"],
    });

    expect(registryEntries.map((entry) => entry.id)).toEqual([
      "owletto",
      "local-tool",
    ]);
    expect(registryEntries[1]?.type).toBe("command");

    expect(Object.keys(providers)).toEqual(["groq"]);
  });
});
