import { describe, expect, test } from "bun:test";
import { McpRegistryService } from "../services/mcp-registry";
import {
  type SkillContent,
  type SkillRegistry,
  SkillRegistryCoordinator,
  type SkillRegistryResult,
} from "../services/skill-registry";
import type { SystemConfigResolver } from "../services/system-config-resolver";

function createMockRegistry(
  id: string,
  results: SkillRegistryResult[],
  skills: Record<string, SkillContent> = {}
): SkillRegistry {
  return {
    id,
    search: async (_query: string, limit: number) => results.slice(0, limit),
    fetch: async (skillId: string) => {
      const skill = skills[skillId];
      if (!skill) throw new Error(`Not found: ${skillId}`);
      return skill;
    },
  };
}

function createFailingRegistry(id: string): SkillRegistry {
  return {
    id,
    search: async () => {
      throw new Error("Registry unavailable");
    },
    fetch: async () => {
      throw new Error("Registry unavailable");
    },
  };
}

const skillA: SkillContent = {
  name: "Skill A",
  description: "First skill",
  content: "content-a",
};

const skillB: SkillContent = {
  name: "Skill B",
  description: "Second skill",
  content: "content-b",
};

describe("SkillRegistryCoordinator", () => {
  test("search aggregates results from multiple registries", async () => {
    const reg1 = createMockRegistry("r1", [
      { id: "s1", name: "Skill 1", source: "r1", score: 5 },
    ]);
    const reg2 = createMockRegistry("r2", [
      { id: "s2", name: "Skill 2", source: "r2", score: 3 },
    ]);
    const coordinator = new SkillRegistryCoordinator([reg1, reg2]);

    const results = await coordinator.search("test", 10);
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.id)).toEqual(["s1", "s2"]);
  });

  test("search deduplicates by id, first registry wins", async () => {
    const reg1 = createMockRegistry("r1", [
      { id: "dup", name: "From R1", source: "r1", score: 1 },
    ]);
    const reg2 = createMockRegistry("r2", [
      { id: "dup", name: "From R2", source: "r2", score: 10 },
    ]);
    const coordinator = new SkillRegistryCoordinator([reg1, reg2]);

    const results = await coordinator.search("test", 10);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("From R1");
    expect(results[0].source).toBe("r1");
  });

  test("search sorts by score descending", async () => {
    const reg1 = createMockRegistry("r1", [
      { id: "low", name: "Low", source: "r1", score: 1 },
      { id: "high", name: "High", source: "r1", score: 10 },
      { id: "mid", name: "Mid", source: "r1", score: 5 },
    ]);
    const coordinator = new SkillRegistryCoordinator([reg1]);

    const results = await coordinator.search("test", 10);
    expect(results.map((r) => r.id)).toEqual(["high", "mid", "low"]);
  });

  test("search respects limit", async () => {
    const reg1 = createMockRegistry("r1", [
      { id: "s1", name: "A", source: "r1", score: 3 },
      { id: "s2", name: "B", source: "r1", score: 2 },
      { id: "s3", name: "C", source: "r1", score: 1 },
    ]);
    const coordinator = new SkillRegistryCoordinator([reg1]);

    const results = await coordinator.search("test", 2);
    expect(results).toHaveLength(2);
  });

  test("search tolerates registry failures", async () => {
    const failing = createFailingRegistry("bad");
    const working = createMockRegistry("good", [
      { id: "s1", name: "Survivor", source: "good", score: 1 },
    ]);
    const coordinator = new SkillRegistryCoordinator([failing, working]);

    const results = await coordinator.search("test", 10);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("s1");
  });

  test("fetch returns from first registry that has the skill", async () => {
    const reg1 = createMockRegistry("r1", [], { "skill-a": skillA });
    const reg2 = createMockRegistry("r2", [], { "skill-b": skillB });
    const coordinator = new SkillRegistryCoordinator([reg1, reg2]);

    const result = await coordinator.fetch("skill-a");
    expect(result.name).toBe("Skill A");
  });

  test("fetch falls through to next registry on failure", async () => {
    const failing = createFailingRegistry("bad");
    const working = createMockRegistry("good", [], { "skill-b": skillB });
    const coordinator = new SkillRegistryCoordinator([failing, working]);

    const result = await coordinator.fetch("skill-b");
    expect(result.name).toBe("Skill B");
  });

  test("fetch throws when skill not found in any registry", async () => {
    const reg1 = createMockRegistry("r1", [], {});
    const reg2 = createMockRegistry("r2", [], {});
    const coordinator = new SkillRegistryCoordinator([reg1, reg2]);

    expect(coordinator.fetch("nonexistent")).rejects.toThrow(
      'Skill "nonexistent" not found in any registry'
    );
  });
});

// --- McpRegistryService ---

function createMockResolver(
  entries: Array<{
    id: string;
    name: string;
    description: string;
    type: "oauth" | "stdio" | "sse" | "api-key";
    config: Record<string, unknown>;
  }>
) {
  return {
    getMcpRegistryServers: async () => entries,
  } as unknown as SystemConfigResolver;
}

const mcpEntries = [
  {
    id: "github",
    name: "GitHub",
    description: "GitHub integration",
    type: "stdio" as const,
    config: { type: "stdio" },
  },
  {
    id: "sentry",
    name: "Sentry",
    description: "Error tracking",
    type: "sse" as const,
    config: { type: "sse" },
  },
  {
    id: "playwright",
    name: "Playwright",
    description: "Browser automation",
    type: "stdio" as const,
    config: {},
  },
  {
    id: "notion",
    name: "Notion",
    description: "Notion workspace",
    type: "oauth" as const,
    config: {},
  },
  {
    id: "linear",
    name: "Linear",
    description: "Issue tracker",
    type: "api-key" as const,
    config: {},
  },
  {
    id: "slack",
    name: "Slack",
    description: "Slack messaging",
    type: "oauth" as const,
    config: {},
  },
  {
    id: "jira",
    name: "Jira",
    description: "Project management",
    type: "api-key" as const,
    config: {},
  },
];

describe("McpRegistryService", () => {
  test("getCurated returns entries matching curated IDs", async () => {
    const service = new McpRegistryService(createMockResolver(mcpEntries));
    const curated = await service.getCurated();

    const ids = curated.map((e) => e.id);
    for (const curatedId of McpRegistryService.CURATED_MCP_IDS) {
      expect(ids).toContain(curatedId);
    }
    expect(curated).toHaveLength(5);
  });

  test("getCurated falls back to first 5 when no curated IDs match", async () => {
    const noCuratedEntries = [
      {
        id: "custom1",
        name: "Custom 1",
        description: "Desc",
        type: "sse" as const,
        config: {},
      },
      {
        id: "custom2",
        name: "Custom 2",
        description: "Desc",
        type: "sse" as const,
        config: {},
      },
      {
        id: "custom3",
        name: "Custom 3",
        description: "Desc",
        type: "sse" as const,
        config: {},
      },
      {
        id: "custom4",
        name: "Custom 4",
        description: "Desc",
        type: "sse" as const,
        config: {},
      },
      {
        id: "custom5",
        name: "Custom 5",
        description: "Desc",
        type: "sse" as const,
        config: {},
      },
      {
        id: "custom6",
        name: "Custom 6",
        description: "Desc",
        type: "sse" as const,
        config: {},
      },
    ];
    const service = new McpRegistryService(
      createMockResolver(noCuratedEntries)
    );
    const curated = await service.getCurated();

    expect(curated).toHaveLength(5);
    expect(curated.map((e) => e.id)).toEqual([
      "custom1",
      "custom2",
      "custom3",
      "custom4",
      "custom5",
    ]);
  });

  test("search matches by name, description, and id", async () => {
    const service = new McpRegistryService(createMockResolver(mcpEntries));

    const byName = await service.search("GitHub");
    expect(byName.some((e) => e.id === "github")).toBe(true);

    const byDesc = await service.search("Browser automation");
    expect(byDesc.some((e) => e.id === "playwright")).toBe(true);

    const byId = await service.search("linear");
    expect(byId.some((e) => e.id === "linear")).toBe(true);
  });

  test("search respects limit", async () => {
    const service = new McpRegistryService(createMockResolver(mcpEntries));
    // "a" appears in many names/descriptions
    const results = await service.search("a", 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  test("search with empty query returns all up to limit", async () => {
    const service = new McpRegistryService(createMockResolver(mcpEntries));

    const results = await service.search("", 3);
    expect(results).toHaveLength(3);

    const allResults = await service.search("");
    expect(allResults).toHaveLength(mcpEntries.length);
  });

  test("getAll returns complete list", async () => {
    const service = new McpRegistryService(createMockResolver(mcpEntries));
    const all = await service.getAll();
    expect(all).toHaveLength(mcpEntries.length);
  });

  test("getById returns specific entry", async () => {
    const service = new McpRegistryService(createMockResolver(mcpEntries));

    const entry = await service.getById("sentry");
    expect(entry).not.toBeNull();
    expect(entry!.name).toBe("Sentry");
  });

  test("getById returns null for unknown id", async () => {
    const service = new McpRegistryService(createMockResolver(mcpEntries));
    const entry = await service.getById("nonexistent");
    expect(entry).toBeNull();
  });

  test("no resolver returns empty results", async () => {
    const service = new McpRegistryService();

    expect(await service.getCurated()).toEqual([]);
    expect(await service.search("github")).toEqual([]);
    expect(await service.getAll()).toEqual([]);
    expect(await service.getById("github")).toBeNull();
  });
});
