import { createLogger, verifyWorkerToken } from "@lobu/core";
import { Hono } from "hono";
import { SkillsFetcherService } from "../../services/skills-fetcher";

const logger = createLogger("internal-skills-discovery-routes");

type WorkerContext = {
  Variables: {
    worker: {
      userId: string;
      agentId?: string;
      deploymentName: string;
    };
  };
};

export function createSkillsDiscoveryRoutes(
  skillsFetcher = new SkillsFetcherService()
): Hono<WorkerContext> {
  const router = new Hono<WorkerContext>();

  const authenticateWorker = async (
    c: any,
    next: () => Promise<void>
  ): Promise<Response | undefined> => {
    const authHeader = c.req.header("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return c.json({ error: "Missing or invalid authorization" }, 401);
    }
    const workerToken = authHeader.substring(7);
    const tokenData = verifyWorkerToken(workerToken);
    if (!tokenData) {
      return c.json({ error: "Invalid worker token" }, 401);
    }
    c.set("worker", tokenData);
    await next();
  };

  router.get("/internal/skills/search", authenticateWorker, async (c) => {
    const query = (c.req.query("q") || "").trim();
    if (!query) {
      return c.json({ results: [] });
    }

    const requestedLimit = parseInt(c.req.query("limit") || "5", 10);
    const limit = Number.isFinite(requestedLimit)
      ? Math.max(1, Math.min(requestedLimit, 10))
      : 5;

    const results = await skillsFetcher.searchSkills(query, limit);
    logger.info("Skills discovery search", {
      query,
      limit,
      count: results.length,
    });

    return c.json({ results, limit });
  });

  logger.info("Internal skills discovery routes registered");
  return router;
}
