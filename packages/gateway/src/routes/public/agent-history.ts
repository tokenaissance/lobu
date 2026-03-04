/**
 * Agent history routes — proxy session data from worker HTTP server.
 * Auth: settings session cookie (verifySettingsSession).
 */

import { createLogger } from "@lobu/core";
import type { Context } from "hono";
import { Hono } from "hono";
import type { WorkerConnectionManager } from "../../gateway/connection-manager";
import { verifySettingsSession } from "./settings-auth";

const logger = createLogger("agent-history-routes");

async function getAgentId(c: Context): Promise<string | null> {
  const session = await verifySettingsSession(c);
  if (!session) return null;
  return c.req.param("agentId") || session.agentId || null;
}

export function createAgentHistoryRoutes(deps: {
  connectionManager: WorkerConnectionManager;
}) {
  const app = new Hono();
  const { connectionManager } = deps;

  // Agent status (connected, httpUrl available)
  app.get("/status", async (c) => {
    const agentId = await getAgentId(c);
    if (!agentId) return c.json({ error: "Unauthorized" }, 401);

    const deployments = connectionManager.getDeploymentsForAgent(agentId);
    const httpUrl = connectionManager.getHttpUrl(agentId);

    return c.json({
      connected: deployments.length > 0,
      hasHttpServer: !!httpUrl,
      deploymentCount: deployments.length,
    });
  });

  // Proxy session messages to worker
  app.get("/session/messages", async (c) => {
    const agentId = await getAgentId(c);
    if (!agentId) return c.json({ error: "Unauthorized" }, 401);

    const httpUrl = connectionManager.getHttpUrl(agentId);
    if (!httpUrl) {
      return c.json(
        {
          error: "Agent offline",
          connected: false,
          messages: [],
          nextCursor: null,
          hasMore: false,
        },
        503
      );
    }

    try {
      const cursor = c.req.query("cursor") || "";
      const limit = c.req.query("limit") || "50";
      const workerUrl = `${httpUrl}/session/messages?cursor=${cursor}&limit=${limit}`;

      const response = await fetch(workerUrl, {
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) {
        logger.error(`Worker responded with ${response.status}`);
        return c.json({ error: "Worker error" }, 502);
      }

      const data = await response.json();
      return c.json(data);
    } catch (error) {
      logger.error("Failed to proxy to worker", { error });
      return c.json({ error: "Failed to reach worker" }, 502);
    }
  });

  // Proxy session stats to worker
  app.get("/session/stats", async (c) => {
    const agentId = await getAgentId(c);
    if (!agentId) return c.json({ error: "Unauthorized" }, 401);

    const httpUrl = connectionManager.getHttpUrl(agentId);
    if (!httpUrl) {
      return c.json({ error: "Agent offline", connected: false }, 503);
    }

    try {
      const workerUrl = `${httpUrl}/session/stats`;
      const response = await fetch(workerUrl, {
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) {
        return c.json({ error: "Worker error" }, 502);
      }

      const data = await response.json();
      return c.json(data);
    } catch (error) {
      logger.error("Failed to proxy stats to worker", { error });
      return c.json({ error: "Failed to reach worker" }, 502);
    }
  });

  return app;
}
