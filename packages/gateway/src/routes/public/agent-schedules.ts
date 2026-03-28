/**
 * Agent Schedules Routes
 *
 * Schedule management endpoints mounted under /api/v1/agents/{agentId}/schedules
 */

import { timingSafeEqual } from "node:crypto";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { AgentMetadataStore } from "../../auth/agent-metadata-store";
import type { UserAgentsStore } from "../../auth/user-agents-store";
import type { ScheduledWakeupService } from "../../orchestration/scheduled-wakeup";
import { createTokenVerifier } from "../shared/token-verifier";
import { verifySettingsSession } from "./settings-auth";

const TAG = "Schedules";
const ErrorResponse = z.object({ error: z.string() });
const TokenQuery = z.object({ token: z.string().optional() });

// --- Route Definitions ---

const listSchedulesRoute = createRoute({
  method: "get",
  path: "/",
  tags: [TAG],
  summary: "List agent schedules",
  request: { query: TokenQuery },
  responses: {
    200: {
      description: "Schedules",
      content: {
        "application/json": {
          schema: z.object({
            schedules: z.array(
              z.object({
                scheduleId: z.string(),
                conversationId: z.string(),
                task: z.string(),
                scheduledAt: z.number(),
                scheduledFor: z.number(),
                status: z.string(),
              })
            ),
          }),
        },
      },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: ErrorResponse } },
    },
  },
});

const cancelScheduleRoute = createRoute({
  method: "delete",
  path: "/{scheduleId}",
  tags: [TAG],
  summary: "Cancel agent schedule",
  request: {
    query: TokenQuery,
    params: z.object({ scheduleId: z.string() }),
  },
  responses: {
    200: {
      description: "Cancelled",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            message: z.string().optional(),
          }),
        },
      },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: ErrorResponse } },
    },
  },
});

const createScheduleRoute = createRoute({
  method: "post",
  path: "/",
  tags: [TAG],
  summary: "Create agent schedule",
  request: {
    query: TokenQuery,
    body: {
      content: {
        "application/json": {
          schema: z.object({
            task: z.string().max(2000),
            cron: z.string().optional(),
            delayMinutes: z.number().min(1).max(1440).optional(),
            maxIterations: z.number().min(1).optional(),
            context: z.record(z.string(), z.unknown()).optional(),
            source: z.string().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Schedule created",
      content: {
        "application/json": {
          schema: z.object({
            scheduleId: z.string(),
            scheduledFor: z.string(),
            isRecurring: z.boolean(),
            cron: z.string().optional(),
            maxIterations: z.number(),
          }),
        },
      },
    },
    400: {
      description: "Bad request",
      content: { "application/json": { schema: ErrorResponse } },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: ErrorResponse } },
    },
  },
});

export interface AgentSchedulesRoutesConfig {
  scheduledWakeupService?: ScheduledWakeupService;
  userAgentsStore?: UserAgentsStore;
  agentMetadataStore?: AgentMetadataStore;
  adminPassword?: string;
}

function verifyAdminBearer(
  authHeader: string | undefined,
  adminPassword: string | undefined
): boolean {
  if (!authHeader?.startsWith("Bearer ") || !adminPassword) return false;
  const token = authHeader.substring(7);
  const a = Buffer.from(token);
  const b = Buffer.from(adminPassword);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createAgentSchedulesRoutes(
  config: AgentSchedulesRoutesConfig
): OpenAPIHono {
  const app = new OpenAPIHono();

  const verifyToken = createTokenVerifier(config);

  // POST / — create schedule (accepts admin Bearer OR settings session)
  app.openapi(createScheduleRoute, async (c): Promise<any> => {
    const agentId = c.req.param("agentId") || "";

    // Auth: admin Bearer token OR settings session
    const isAdmin = verifyAdminBearer(
      c.req.header("Authorization"),
      config.adminPassword
    );
    if (!isAdmin) {
      const payload = await verifyToken(verifySettingsSession(c), agentId);
      if (!payload) return c.json({ error: "Unauthorized" }, 401);
    }

    if (!config.scheduledWakeupService) {
      return c.json({ error: "Scheduling not configured" }, 500);
    }

    const body = c.req.valid("json");
    if (!body.cron && !body.delayMinutes) {
      return c.json({ error: "Must specify either cron or delayMinutes" }, 400);
    }
    if (body.cron && body.delayMinutes) {
      return c.json(
        { error: "Cannot specify both cron and delayMinutes" },
        400
      );
    }

    try {
      const schedule = await config.scheduledWakeupService.scheduleExternal({
        agentId,
        task: body.task,
        context: body.context,
        cron: body.cron,
        delayMinutes: body.delayMinutes,
        maxIterations: body.maxIterations,
        source: body.source,
      });

      return c.json({
        scheduleId: schedule.id,
        scheduledFor: schedule.triggerAt,
        isRecurring: schedule.isRecurring,
        cron: schedule.cron,
        maxIterations: schedule.maxIterations,
      });
    } catch (error) {
      return c.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Failed to create schedule",
        },
        400
      );
    }
  });

  app.openapi(listSchedulesRoute, async (c): Promise<any> => {
    const agentId = c.req.param("agentId") || "";
    const payload = await verifyToken(verifySettingsSession(c), agentId);
    if (!payload) return c.json({ error: "Unauthorized" }, 401);

    if (!config.scheduledWakeupService) return c.json({ schedules: [] });

    const schedules =
      await config.scheduledWakeupService.listPendingForAgent(agentId);
    return c.json({
      schedules: schedules.map((s) => ({
        scheduleId: s.id,
        conversationId: s.conversationId,
        task: s.task,
        scheduledAt: s.scheduledAt,
        scheduledFor: s.triggerAt,
        status: s.status,
      })),
    });
  });

  app.openapi(cancelScheduleRoute, async (c): Promise<any> => {
    const agentId = c.req.param("agentId") || "";
    const payload = await verifyToken(verifySettingsSession(c), agentId);
    if (!payload) return c.json({ error: "Unauthorized" }, 401);

    if (!config.scheduledWakeupService) {
      return c.json({ error: "Not configured" }, 500);
    }

    const { scheduleId } = c.req.valid("param");
    const success = await config.scheduledWakeupService.cancelByAgent(
      scheduleId,
      agentId
    );

    return c.json({
      success,
      message: success ? undefined : "Not found or already triggered",
    });
  });

  return app;
}
