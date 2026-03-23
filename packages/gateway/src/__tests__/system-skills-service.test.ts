import { afterEach, describe, expect, test } from "bun:test";
import { SystemSkillsService } from "../services/system-skills-service";

const testConfig = {
  skills: [
    {
      id: "github",
      name: "GitHub",
      description: "GitHub integration",
      mcpServers: [
        {
          id: "github-mcp",
          name: "GitHub MCP",
          url: "https://github-mcp.example.com",
        },
      ],
      nixPackages: ["git"],
      permissions: ["github.com", "api.github.com"],
    },
    {
      id: "owletto",
      name: "Owletto",
      description: "Owletto embedded",
      hidden: true,
      mcpServers: [
        { id: "owletto-mcp", url: "https://owletto.example.com/mcp" },
      ],
    },
  ],
};

let fetchCallCount = 0;
const originalFetch = globalThis.fetch;

function setupMockFetch(config: unknown, statusCode = 200) {
  fetchCallCount = 0;
  globalThis.fetch = async () => {
    fetchCallCount++;
    return new Response(JSON.stringify(config), {
      status: statusCode,
      headers: { "Content-Type": "application/json" },
    });
  };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  fetchCallCount = 0;
});

describe("SystemSkillsService", () => {
  test("loads config from HTTP URL and maps skills correctly", async () => {
    setupMockFetch(testConfig);
    const service = new SystemSkillsService("https://example.com/skills.json");
    const skills = await service.getSystemSkills();

    expect(skills).toHaveLength(2);
    expect(skills[0]).toEqual({
      repo: "system/github",
      name: "GitHub",
      description: "GitHub integration",
      enabled: true,
      system: true,
      mcpServers: [
        {
          id: "github-mcp",
          name: "GitHub MCP",
          url: "https://github-mcp.example.com",
        },
      ],
      nixPackages: ["git"],
      permissions: ["github.com", "api.github.com"],
    });
    expect(skills[1]).toEqual({
      repo: "system/owletto",
      name: "Owletto",
      description: "Owletto embedded",
      enabled: true,
      system: true,
      mcpServers: [
        { id: "owletto-mcp", url: "https://owletto.example.com/mcp" },
      ],
      nixPackages: undefined,
      permissions: undefined,
    });
  });

  test("returns empty array when fetch fails", async () => {
    setupMockFetch({ error: "not found" }, 500);
    const service = new SystemSkillsService("https://example.com/skills.json");
    const skills = await service.getSystemSkills();
    expect(skills).toEqual([]);
  });

  test("returns empty array when no configUrl is provided", async () => {
    const service = new SystemSkillsService();
    const skills = await service.getSystemSkills();
    expect(skills).toEqual([]);
  });

  test("getSearchableSkills filters out hidden entries", async () => {
    setupMockFetch(testConfig);
    const service = new SystemSkillsService("https://example.com/skills.json");
    const skills = await service.getSearchableSkills();

    expect(skills).toHaveLength(1);
    expect(skills[0].repo).toBe("system/github");
  });

  test("getRawSystemSkills returns unsubstituted env patterns", async () => {
    const envKey = `__TEST_SSS_KEY_${Date.now()}`;
    process.env[envKey] = "secret123";
    try {
      const configWithEnv = {
        skills: [
          {
            id: "test-skill",
            name: "Test",
            mcpServers: [
              {
                id: "test-mcp",
                url: `https://api.example.com/\${env:${envKey}}`,
              },
            ],
          },
        ],
      };
      setupMockFetch(configWithEnv);
      const service = new SystemSkillsService(
        "https://example.com/skills.json"
      );

      const raw = await service.getRawSystemSkills();
      expect(raw[0].mcpServers![0].url).toBe(
        `https://api.example.com/\${env:${envKey}}`
      );

      const substituted = await service.getSystemSkills();
      expect(substituted[0].mcpServers![0].url).toBe(
        "https://api.example.com/secret123"
      );
    } finally {
      delete process.env[envKey];
    }
  });

  test("env substitution replaces ${env:VAR} with process.env value", async () => {
    const envKey = `__TEST_SSS_API_${Date.now()}`;
    process.env[envKey] = "my-api-key-value";
    try {
      const configWithEnv = {
        skills: [
          {
            id: "env-skill",
            name: "Env Skill",
            mcpServers: [
              {
                id: "env-mcp",
                url: `https://api.example.com/mcp?key=\${env:${envKey}}`,
              },
            ],
          },
        ],
      };
      setupMockFetch(configWithEnv);
      const service = new SystemSkillsService(
        "https://example.com/skills.json"
      );
      const skills = await service.getSystemSkills();
      expect(skills[0].mcpServers![0].url).toBe(
        "https://api.example.com/mcp?key=my-api-key-value"
      );
    } finally {
      delete process.env[envKey];
    }
  });

  test("unset env var is replaced with empty string", async () => {
    const envKey = `__TEST_SSS_NONEXISTENT_${Date.now()}`;
    delete process.env[envKey];
    const configWithEnv = {
      skills: [
        {
          id: "missing-env",
          name: "Missing Env",
          mcpServers: [
            {
              id: "missing-mcp",
              url: `https://api.example.com/\${env:${envKey}}/path`,
            },
          ],
        },
      ],
    };
    setupMockFetch(configWithEnv);
    const service = new SystemSkillsService("https://example.com/skills.json");
    const skills = await service.getSystemSkills();
    expect(skills[0].mcpServers![0].url).toBe("https://api.example.com//path");
  });

  test("getProviderConfigs extracts providers by skill id", async () => {
    const configWithProviders = {
      skills: [
        {
          id: "groq",
          name: "Groq",
          providers: [
            {
              displayName: "Groq",
              iconUrl: "https://example.com/groq.png",
              envVarName: "GROQ_API_KEY",
              upstreamBaseUrl: "https://api.groq.com/openai",
              apiKeyInstructions: "Get key from groq.com",
              apiKeyPlaceholder: "gsk_...",
            },
          ],
        },
        {
          id: "no-providers",
          name: "No Providers",
        },
      ],
    };
    setupMockFetch(configWithProviders);
    const service = new SystemSkillsService("https://example.com/skills.json");
    const providers = await service.getProviderConfigs();

    expect(Object.keys(providers)).toEqual(["groq"]);
    expect(providers.groq.displayName).toBe("Groq");
    expect(providers.groq.envVarName).toBe("GROQ_API_KEY");
  });

  test("reload clears cache and allows re-fetch", async () => {
    setupMockFetch(testConfig);
    const service = new SystemSkillsService("https://example.com/skills.json");

    const first = await service.getSystemSkills();
    expect(first).toHaveLength(2);
    expect(fetchCallCount).toBe(1);

    const updatedConfig = {
      skills: [{ id: "new-skill", name: "New Skill" }],
    };
    setupMockFetch(updatedConfig);
    service.reload();

    const second = await service.getSystemSkills();
    expect(second).toHaveLength(1);
    expect(second[0].repo).toBe("system/new-skill");
    expect(fetchCallCount).toBe(1);
  });

  test("reload with new URL uses the new URL", async () => {
    setupMockFetch(testConfig);
    const service = new SystemSkillsService("https://example.com/old.json");
    await service.getSystemSkills();

    const newConfig = {
      skills: [{ id: "from-new-url", name: "From New URL" }],
    };
    setupMockFetch(newConfig);
    service.reload("https://example.com/new.json");

    const skills = await service.getSystemSkills();
    expect(skills).toHaveLength(1);
    expect(skills[0].repo).toBe("system/from-new-url");
  });

  test("caches config and only fetches once", async () => {
    setupMockFetch(testConfig);
    const service = new SystemSkillsService("https://example.com/skills.json");

    await service.getSystemSkills();
    await service.getSystemSkills();
    await service.getSearchableSkills();
    await service.getProviderConfigs();

    expect(fetchCallCount).toBe(1);
  });

  test("getRuntimeSystemSkills returns runtime format with content", async () => {
    setupMockFetch(testConfig);
    const service = new SystemSkillsService("https://example.com/skills.json");
    const runtime = await service.getRuntimeSystemSkills();

    expect(runtime).toHaveLength(2);
    expect(runtime[0].id).toBe("github");
    expect(runtime[0].repo).toBe("system/github");
    expect(runtime[0].name).toBe("GitHub");
    expect(runtime[0].description).toBe("GitHub integration");
    expect(runtime[0].content).toContain("# GitHub");
    expect(runtime[0].content).toContain("System skill ID: `system/github`");
    expect(runtime[0].content).toContain("## MCP Servers");
    expect(runtime[0].content).toContain("GitHub MCP (`github-mcp`)");
    expect(runtime[0].content).toContain("## Network Permissions");
    expect(runtime[0].content).toContain("github.com, api.github.com");
    expect(runtime[0].content).toContain("## Nix Packages");
    expect(runtime[0].content).toContain("git");
  });

  test("toSkillConfig passes instructions through", async () => {
    const configWithInstructions = {
      skills: [
        {
          id: "owletto",
          name: "Owletto Memory",
          description: "Long-term memory",
          instructions: "Check memory at conversation start.",
          hidden: true,
          mcpServers: [
            { id: "owletto-mcp", url: "https://owletto.example.com" },
          ],
        },
        {
          id: "github",
          name: "GitHub",
          description: "GitHub integration",
        },
      ],
    };
    setupMockFetch(configWithInstructions);
    const service = new SystemSkillsService("https://example.com/skills.json");
    const skills = await service.getSystemSkills();

    expect(skills[0].instructions).toBe("Check memory at conversation start.");
    expect(skills[1].instructions).toBeUndefined();
  });

  test("getRuntimeSystemSkills includes instructions in content and metadata", async () => {
    const configWithInstructions = {
      skills: [
        {
          id: "owletto",
          name: "Owletto Memory",
          description: "Long-term memory",
          instructions: "Check memory at conversation start.",
          mcpServers: [
            { id: "owletto-mcp", url: "https://owletto.example.com" },
          ],
        },
      ],
    };
    setupMockFetch(configWithInstructions);
    const service = new SystemSkillsService("https://example.com/skills.json");
    const runtime = await service.getRuntimeSystemSkills();

    expect(runtime[0].instructions).toBe("Check memory at conversation start.");
    expect(runtime[0].content).toContain(
      "**Instructions:** Check memory at conversation start."
    );
    expect(runtime[0].content).toContain("Long-term memory");
  });

  test("getRuntimeSystemSkills without instructions omits instructions block", async () => {
    setupMockFetch(testConfig);
    const service = new SystemSkillsService("https://example.com/skills.json");
    const runtime = await service.getRuntimeSystemSkills();

    expect(runtime[0].instructions).toBeUndefined();
    expect(runtime[0].content).not.toContain("**Instructions:**");
  });
});
