/**
 * Internal Settings Link Routes
 *
 * Worker-facing endpoint for generating settings magic links.
 * Used by the GetSettingsLink custom MCP tool.
 */

import { createLogger, verifyWorkerToken } from "@lobu/core";
import { Hono } from "hono";
import {
  buildSettingsUrl,
  buildTelegramSettingsUrl,
  generateSettingsToken,
  getSettingsTokenTtlMs,
  type PrefillMcpServer,
  type PrefillSkill,
} from "../../auth/settings/token-service";
import type { InteractionService } from "../../interactions";
import type { GrantStore } from "../../permissions/grant-store";

const logger = createLogger("internal-settings-link-routes");

type WorkerContext = {
  Variables: {
    worker: {
      userId: string;
      conversationId: string;
      channelId: string;
      teamId?: string;
      agentId?: string;
      deploymentName: string;
      platform?: string;
    };
  };
};

/**
 * Create internal settings link routes (Hono)
 */
export function createSettingsLinkRoutes(
  interactionService?: InteractionService,
  grantStore?: GrantStore
): Hono<WorkerContext> {
  const router = new Hono<WorkerContext>();

  // Worker authentication middleware
  const authenticateWorker = async (c: any, next: () => Promise<void>) => {
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

  /**
   * Generate a settings magic link for the current user/agent context
   * POST /internal/settings-link
   *
   * Body: {
   *   reason?: string (optional explanation for what to configure)
   *   message?: string (optional message to display on settings page)
   *   prefillEnvVars?: string[] (optional env var keys to pre-fill)
   *   prefillSkills?: PrefillSkill[] (optional skills to pre-fill)
   *   prefillMcpServers?: PrefillMcpServer[] (optional MCP servers to pre-fill)
   * }
   *
   * Response: {
   *   url: string (settings page URL with magic token)
   *   expiresAt: string (ISO timestamp when link expires)
   * }
   */
  router.post("/internal/settings-link", authenticateWorker, async (c) => {
    try {
      const worker = c.get("worker");
      const body = await c.req.json().catch(() => ({}));
      const {
        reason,
        message,
        label,
        prefillEnvVars,
        prefillSkills,
        prefillMcpServers,
        prefillNixPackages,
        prefillGrants,
      } = body as {
        reason?: string;
        message?: string;
        label?: string;
        prefillEnvVars?: string[];
        prefillSkills?: PrefillSkill[];
        prefillMcpServers?: PrefillMcpServer[];
        prefillNixPackages?: string[];
        prefillGrants?: string[];
      };

      const agentId = worker.agentId;
      const userId = worker.userId;
      const platform = worker.platform || "unknown";

      if (!agentId) {
        logger.error("Missing agentId in worker token", { worker });
        return c.json({ error: "Missing agentId in worker context" }, 400);
      }

      logger.info("Generating settings link", {
        agentId,
        userId,
        platform,
        reason: reason?.substring(0, 100),
        hasMessage: !!message,
        prefillEnvVarsCount: prefillEnvVars?.length || 0,
        prefillSkillsCount: prefillSkills?.length || 0,
        prefillMcpServersCount: prefillMcpServers?.length || 0,
        prefillNixPackagesCount: prefillNixPackages?.length || 0,
        prefillGrantsCount: prefillGrants?.length || 0,
      });

      // Domain-only requests can use inline approval buttons
      const isDomainOnly =
        prefillGrants &&
        prefillGrants.length > 0 &&
        !prefillSkills?.length &&
        !prefillMcpServers?.length &&
        !prefillEnvVars?.length &&
        !prefillNixPackages?.length;

      if (isDomainOnly && interactionService && grantStore) {
        logger.info("Using inline grant approval", {
          agentId,
          domains: prefillGrants,
        });

        await interactionService.postGrantRequest(
          userId,
          agentId,
          worker.conversationId,
          worker.channelId,
          worker.teamId,
          prefillGrants,
          reason || "Domain access requested"
        );

        return c.json({
          type: "inline_grant",
          message:
            "Approval buttons sent to user in chat. The user will approve or deny the request.",
        });
      }

      // Telegram plain "Open Settings" links use stable URLs (no token needed)
      const hasPrefillData =
        prefillSkills?.length ||
        prefillMcpServers?.length ||
        prefillEnvVars?.length ||
        prefillNixPackages?.length ||
        prefillGrants?.length ||
        message;

      if (platform === "telegram" && !hasPrefillData && interactionService) {
        const stableUrl = buildTelegramSettingsUrl(worker.channelId);
        const buttonLabel = label || "Open Settings";

        await interactionService.postLinkButton(
          userId,
          worker.conversationId,
          worker.channelId,
          worker.teamId,
          platform,
          stableUrl,
          buttonLabel,
          "settings"
        );

        return c.json({
          type: "settings_link",
          message: "Settings link sent as a button to the user.",
        });
      }

      // Generate token with configured TTL (defaults to 1 hour)
      const ttlMs = getSettingsTokenTtlMs();
      const token = generateSettingsToken(agentId, userId, platform, {
        ttlMs,
        channelId: worker.channelId,
        teamId: worker.teamId,
        message,
        prefillEnvVars,
        prefillSkills,
        prefillMcpServers,
        prefillNixPackages,
        prefillGrants,
        sourceContext: {
          conversationId: worker.conversationId,
          channelId: worker.channelId,
          teamId: worker.teamId,
          platform,
        },
      });
      // Telegram web_app buttons replace URL hash fragments, so use query param
      const url = buildSettingsUrl(token, {
        useQueryParam: platform === "telegram",
      });
      const expiresAt = new Date(Date.now() + ttlMs).toISOString();

      logger.info("Settings link generated", { agentId, userId, expiresAt });

      // Fire link button event so platforms render natively
      if (interactionService) {
        const buttonLabel =
          label ||
          (prefillMcpServers?.length
            ? `Install ${prefillMcpServers[0]?.name || "MCP Server"}`
            : prefillSkills?.length
              ? "Install Skill"
              : "Open Settings");

        await interactionService.postLinkButton(
          userId,
          worker.conversationId,
          worker.channelId,
          worker.teamId,
          platform,
          url,
          buttonLabel,
          prefillSkills?.length || prefillMcpServers?.length
            ? "install"
            : "settings"
        );

        return c.json({
          type: "settings_link",
          message: "Settings link sent as a button to the user.",
        });
      }

      // Fallback: no interaction service (shouldn't happen in practice)
      return c.json({
        url,
        expiresAt,
      });
    } catch (error) {
      logger.error("Failed to generate settings link", { error });
      return c.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Failed to generate settings link",
        },
        500
      );
    }
  });

  logger.info("Internal settings link routes registered");

  return router;
}
