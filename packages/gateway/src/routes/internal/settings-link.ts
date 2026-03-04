/**
 * Internal Settings Link Routes
 *
 * Worker-facing endpoint for generating settings magic links.
 * Uses server-side Redis sessions (no encrypted tokens in URLs).
 */

import { createLogger, verifyWorkerToken } from "@lobu/core";
import { Hono } from "hono";
import type { AuthSessionStore } from "../../auth/settings/session-store";
import { buildSessionUrl } from "../../auth/settings/session-store";
import {
	buildTelegramSettingsUrl,
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
	sessionStore: AuthSessionStore,
	interactionService?: InteractionService,
	grantStore?: GrantStore,
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
	 * Generate a settings link for the current user/agent context.
	 * Context is stored server-side in Redis — only an opaque session ID
	 * appears in the URL.
	 *
	 * POST /internal/settings-link
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
					reason || "Domain access requested",
				);

				return c.json({
					type: "inline_grant",
					message:
						"Approval buttons sent to user in chat. The user will approve or deny the request.",
				});
			}

			// Telegram plain "Open Settings" links use stable URLs (no session needed)
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
					"settings",
				);

				return c.json({
					type: "settings_link",
					message: "Settings link sent as a button to the user.",
				});
			}

			// Create server-side session (no encrypted token in URL)
			const ttlMs = getSettingsTokenTtlMs();
			const { sessionId, expiresAt } = await sessionStore.createSession(
				{
					userId,
					platform,
					agentId,
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
				},
				ttlMs,
			);

			const url = buildSessionUrl(sessionId);

			logger.info("Settings link generated (session-based)", {
				agentId,
				userId,
				expiresAt: new Date(expiresAt).toISOString(),
			});

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
						: "settings",
				);

				return c.json({
					type: "settings_link",
					message: "Settings link sent as a button to the user.",
				});
			}

			// Fallback: no interaction service (shouldn't happen in practice).
			// Never return the raw URL to the worker.
			logger.warn(
				"No interactionService available — settings link generated but cannot be delivered to user",
				{ agentId, userId },
			);
			return c.json({
				type: "settings_link",
				message:
					"Settings link generated but could not be delivered (no interaction service).",
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
				500,
			);
		}
	});

	logger.info("Internal settings link routes registered");

	return router;
}
