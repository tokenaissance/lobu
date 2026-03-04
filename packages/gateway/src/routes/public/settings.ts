/**
 * Settings Page Routes
 *
 * Serves the unified settings/agent-selector page.
 * Authentication uses server-side Redis sessions (no encrypted tokens in URLs).
 *
 * Supports three entry modes:
 * - Session-based: opaque session ID in URL, context lives in Redis
 * - Telegram initData: HMAC-signed by bot token, creates Redis session
 * - OAuth (optional): configurable provider for identity verification
 *
 * API endpoints (agent config, schedules, etc.) remain in separate files.
 */

import { OpenAPIHono } from "@hono/zod-openapi";
import { createLogger } from "@lobu/core";
import type {
	AgentMetadata,
	AgentMetadataStore,
} from "../../auth/agent-metadata-store";
import { collectProviderModelOptions } from "../../auth/provider-model-options";
import type { AgentSettingsStore } from "../../auth/settings";
import type { OAuthIdentityStore } from "../../auth/settings/identity-store";
import type { SettingsOAuthProvider } from "../../auth/settings/oauth-provider";
import type { AuthSessionStore } from "../../auth/settings/session-store";
import type { UserAgentsStore } from "../../auth/user-agents-store";
import type { ChannelBindingService } from "../../channels";
import { getModelProviderModules } from "../../modules/module-system";
import { verifyTelegramWebAppData } from "../../telegram/webapp-auth";
import {
	clearSettingsSessionCookie,
	setSettingsSessionCookie,
	verifySettingsSession,
} from "./settings-auth";
import type { ProviderMeta } from "./settings-page";
import {
	renderErrorPage,
	renderPickerPage,
	renderSettingsPage,
	renderTelegramBootstrapPage,
} from "./settings-page";

const logger = createLogger("settings-routes");

export interface SettingsPageConfig {
	agentSettingsStore: AgentSettingsStore;
	userAgentsStore: UserAgentsStore;
	agentMetadataStore: AgentMetadataStore;
	channelBindingService: ChannelBindingService;
	sessionStore: AuthSessionStore;
	oauthProvider?: SettingsOAuthProvider;
	identityStore?: OAuthIdentityStore;
	integrationConfigService?: import("../../auth/integration/config-service").IntegrationConfigService;
	integrationCredentialStore?: import("../../auth/integration/credential-store").IntegrationCredentialStore;
	connectionManager?: import("../../gateway/connection-manager").WorkerConnectionManager;
	systemSkillsService?: import("../../services/system-skills-service").SystemSkillsService;
}

function buildProviderMeta(
	m: ReturnType<typeof getModelProviderModules>[number],
): ProviderMeta {
	return {
		id: m.providerId,
		name: m.providerDisplayName,
		iconUrl: m.providerIconUrl || "",
		authType: (m.authType || "oauth") as ProviderMeta["authType"],
		supportedAuthTypes:
			(m.supportedAuthTypes as ProviderMeta["supportedAuthTypes"]) || [
				m.authType || "oauth",
			],
		apiKeyInstructions: m.apiKeyInstructions || "",
		apiKeyPlaceholder: m.apiKeyPlaceholder || "",
		catalogDescription: m.catalogDescription || "",
	};
}

export function createSettingsPageRoutes(
	config: SettingsPageConfig,
): OpenAPIHono {
	const app = new OpenAPIHono();

	// =========================================================================
	// POST /settings/session — establish a session cookie
	// =========================================================================
	app.post("/settings/session", async (c) => {
		const body = await c.req
			.json<{
				sessionId?: string;
				initData?: string;
				chatId?: string;
			}>()
			.catch(
				(): { sessionId?: string; initData?: string; chatId?: string } => ({}),
			);

		// Path A: Telegram WebApp initData authentication
		if (body.initData) {
			const botToken = process.env.TELEGRAM_BOT_TOKEN;
			if (!botToken) {
				return c.json({ error: "Telegram not configured" }, 500);
			}

			const chatId = (body.chatId ?? "").trim();
			if (!chatId) {
				return c.json({ error: "Missing chatId" }, 400);
			}

			const webAppData = verifyTelegramWebAppData(body.initData, botToken);
			if (!webAppData) {
				clearSettingsSessionCookie(c);
				return c.json({ error: "Invalid or expired Telegram data" }, 401);
			}

			const userId = String(webAppData.user.id);

			// DM validation: chatId must equal userId
			const chatIdNum = Number(chatId);
			if (chatIdNum > 0 && chatId !== userId) {
				return c.json({ error: "Chat ID mismatch" }, 403);
			}

			// Create a server-side session (replaces the old encrypt-to-cookie approach)
			const sessionTtlMs = 60 * 60 * 1000;
			const { sessionId } = await config.sessionStore.createSession(
				{
					userId,
					platform: "telegram",
					channelId: chatId,
				},
				sessionTtlMs,
			);

			const payload = await config.sessionStore.getSession(sessionId);
			if (!payload) {
				clearSettingsSessionCookie(c);
				return c.json({ error: "Failed to create session" }, 500);
			}

			setSettingsSessionCookie(c, sessionId, payload);
			return c.json({ success: true });
		}

		// Path B: Session-based authentication (opaque session ID)
		const sessionId = (body.sessionId ?? "").trim();
		if (!sessionId) return c.json({ error: "Missing session ID" }, 400);

		const payload = await config.sessionStore.getSession(sessionId);
		if (!payload) {
			clearSettingsSessionCookie(c);
			return c.json({ error: "Invalid or expired session" }, 401);
		}

		// If OAuth provider is configured, redirect to OAuth instead of setting cookie directly
		if (config.oauthProvider) {
			const authUrl = await config.oauthProvider.startAuth(
				payload.userId,
				sessionId,
				payload.platform,
			);
			return c.json({ oauthRedirect: authUrl });
		}

		setSettingsSessionCookie(c, sessionId, payload);
		return c.json({ success: true });
	});

	// =========================================================================
	// GET /settings/oauth/callback — OAuth identity verification callback
	// =========================================================================
	if (config.oauthProvider && config.identityStore) {
		const oauthProvider = config.oauthProvider;
		const identityStore = config.identityStore;

		app.get("/settings/oauth/callback", async (c) => {
			const code = c.req.query("code");
			const state = c.req.query("state");
			const error = c.req.query("error");

			if (error) {
				logger.warn("Settings OAuth error", {
					error,
					description: c.req.query("error_description"),
				});
				return c.html(
					renderErrorPage(
						`Authentication failed: ${error}. Please request a new settings link.`,
					),
					401,
				);
			}

			if (!code || !state) {
				return c.html(
					renderErrorPage("Invalid OAuth callback (missing code or state)."),
					400,
				);
			}

			try {
				const result = await oauthProvider.handleCallback(code, state);
				if (!result) {
					return c.html(
						renderErrorPage(
							"Authentication failed. The link may have expired — request a new one.",
						),
						401,
					);
				}

				const { stateData, userInfo } = result;

				// Verify/establish identity mapping
				const { linked, existingUserId } = await identityStore.linkIdentity(
					oauthProvider.providerName,
					userInfo.sub,
					stateData.userId,
					stateData.platform,
				);

				if (!linked) {
					logger.warn("OAuth identity mismatch", {
						oauthSub: userInfo.sub,
						sessionUserId: stateData.userId,
						existingUserId,
					});
					return c.html(
						renderErrorPage(
							"This OAuth account is already linked to a different user.",
						),
						403,
					);
				}

				// Load the session and set the cookie
				const payload = await config.sessionStore.getSession(
					stateData.sessionId,
				);
				if (!payload) {
					return c.html(
						renderErrorPage("Session expired. Please request a new link."),
						401,
					);
				}

				setSettingsSessionCookie(c, stateData.sessionId, payload);
				return c.redirect("/settings", 303);
			} catch (err) {
				logger.error("Settings OAuth callback failed", { error: err });
				return c.html(
					renderErrorPage(
						"Authentication failed due to a server error. Please try again.",
					),
					500,
				);
			}
		});
	}

	// =========================================================================
	// GET /settings — HTML Settings Page
	// =========================================================================
	app.get("/settings", async (c) => {
		c.header("Referrer-Policy", "no-referrer");
		c.header("Cache-Control", "no-store, max-age=0");
		c.header("Pragma", "no-cache");

		// Handle ?s= query param: validate session, set cookie, redirect clean
		const querySessionId = c.req.query("s");
		if (querySessionId) {
			const payload = await config.sessionStore.getSession(querySessionId);
			if (!payload) {
				clearSettingsSessionCookie(c);
				return c.html(
					renderErrorPage(
						"Invalid or expired link. Use /configure to request a new settings link.",
					),
					401,
				);
			}

			// If OAuth configured, redirect through OAuth first
			if (config.oauthProvider) {
				const authUrl = await config.oauthProvider.startAuth(
					payload.userId,
					querySessionId,
					payload.platform,
				);
				return c.redirect(authUrl, 303);
			}

			setSettingsSessionCookie(c, querySessionId, payload);
			return c.redirect("/settings", 303);
		}

		// Telegram stable URLs: /settings?platform=telegram&chat=<chatId>
		// These need client-side bootstrap to extract Telegram initData from the hash
		const isTelegramStableUrl =
			c.req.query("platform") === "telegram" && c.req.query("chat");
		if (isTelegramStableUrl) {
			return c.html(renderTelegramBootstrapPage());
		}

		const payload = await verifySettingsSession(c);
		if (!payload) {
			return c.html(
				renderErrorPage(
					"Your session has expired or is invalid. Use /configure to request a new settings link.",
				),
				401,
			);
		}

		// Determine the agentId to show settings for
		let agentId = payload.agentId;

		if (!agentId && payload.channelId) {
			// Channel-based entry: try to resolve via existing binding
			const binding = await config.channelBindingService.getBinding(
				payload.platform,
				payload.channelId,
				payload.teamId,
			);
			if (binding) {
				agentId = binding.agentId;
			}
		}

		if (!agentId) {
			// No agent resolved: show agent picker / creation form
			const agentIds = await config.userAgentsStore.listAgents(
				payload.platform,
				payload.userId,
			);

			const agents: (AgentMetadata & { channelCount: number })[] = [];
			for (const id of agentIds) {
				const metadata = await config.agentMetadataStore.getMetadata(id);
				if (metadata) {
					const bindings = await config.channelBindingService.listBindings(id);
					agents.push({ ...metadata, channelCount: bindings.length });
				}
			}

			return c.html(renderPickerPage(payload, agents));
		}

		// We have an agentId: render settings page
		const [settings, agentMetadata] = await Promise.all([
			config.agentSettingsStore.getSettings(agentId),
			config.agentMetadataStore.getMetadata(agentId),
		]);

		// Build provider metadata from registry
		const allModules = getModelProviderModules();
		const allProviderMeta = allModules
			.filter((m) => m.catalogVisible !== false)
			.map(buildProviderMeta);

		// Resolve installed providers in order
		const installedIds = (settings?.installedProviders || []).map(
			(ip) => ip.providerId,
		);
		const installedSet = new Set(installedIds);
		const installedProviders = installedIds
			.map((id) => allProviderMeta.find((p) => p.id === id))
			.filter((p): p is ProviderMeta => p !== undefined);

		// Catalog providers = all that are not installed
		const catalogProviders = allProviderMeta.filter(
			(p) => !installedSet.has(p.id),
		);

		const providerModelOptions = await collectProviderModelOptions(
			agentId,
			payload.userId,
		);

		// Determine if agent switcher should be shown
		const showSwitcher = !!payload.channelId;

		// Get agents list for switcher (only if switcher is enabled)
		const agents: (AgentMetadata & { channelCount: number })[] = [];
		if (showSwitcher) {
			const agentIds = await config.userAgentsStore.listAgents(
				payload.platform,
				payload.userId,
			);
			for (const id of agentIds) {
				const metadata = await config.agentMetadataStore.getMetadata(id);
				if (metadata) {
					const bindings = await config.channelBindingService.listBindings(id);
					agents.push({ ...metadata, channelCount: bindings.length });
				}
			}

			// Ensure the currently active agent appears in switcher even when it is
			// not part of the user's direct agent list (e.g. workspace-bound agent).
			if (
				agentMetadata &&
				!agents.some((agent) => agent.agentId === agentMetadata.agentId)
			) {
				const bindings = await config.channelBindingService.listBindings(
					agentMetadata.agentId,
				);
				agents.unshift({ ...agentMetadata, channelCount: bindings.length });
			}
		}

		// Load system skills to prepend to initial skills
		let systemSkills: import("@lobu/core").SkillConfig[] = [];
		if (config.systemSkillsService) {
			try {
				systemSkills = await config.systemSkillsService.getSystemSkills();
			} catch {
				// System skills service may fail, continue without them
			}
		}

		// Fetch integration status keyed by integration ID
		const integrationStatus: Record<
			string,
			{
				connected: boolean;
				accounts: { accountId: string; grantedScopes: string[] }[];
				availableScopes: string[];
			}
		> = {};
		if (config.integrationConfigService && config.integrationCredentialStore) {
			try {
				const allConfigs = await config.integrationConfigService.getAll();
				for (const [id, cfg] of Object.entries(allConfigs)) {
					const accountList =
						await config.integrationCredentialStore.listAccounts(agentId, id);
					integrationStatus[id] = {
						connected: accountList.length > 0,
						accounts: accountList.map((a) => ({
							accountId: a.accountId,
							grantedScopes: a.credentials.grantedScopes,
						})),
						availableScopes: cfg.scopes?.available ?? [],
					};
				}
			} catch {
				// Integration services may not be configured
			}
		}

		// Ensure the payload has agentId for the template (may have been resolved from binding)
		const effectivePayload = { ...payload, agentId };

		return c.html(
			renderSettingsPage(effectivePayload, settings, {
				providers: installedProviders,
				catalogProviders,
				providerModelOptions,
				showSwitcher,
				agents,
				agentName: agentMetadata?.name,
				agentDescription: agentMetadata?.description,
				hasChannelId: !!payload.channelId,
				systemSkills,
				integrationStatus,
			}),
		);
	});

	// Disconnect an OAuth integration account
	app.post("/api/v1/integrations/oauth/disconnect", async (c) => {
		const session = await verifySettingsSession(c);
		if (!session) return c.json({ error: "Not authenticated" }, 401);

		const { agentId, integrationId, accountId } = await c.req.json<{
			agentId: string;
			integrationId: string;
			accountId?: string;
		}>();

		if (!agentId || !integrationId) {
			return c.json({ error: "Missing agentId or integrationId" }, 400);
		}

		if (!config.integrationCredentialStore) {
			return c.json({ error: "Integration services not configured" }, 500);
		}

		await config.integrationCredentialStore.deleteCredentials(
			agentId,
			integrationId,
			accountId || "default",
		);

		// Notify active workers so they get updated integration status
		config.connectionManager?.notifyAgent(agentId, "config_changed", {
			changes: [`integration:${integrationId}:disconnected`],
		});

		return c.json({ success: true });
	});

	// Save an API key for an api-key integration
	app.post("/api/v1/integrations/apikey/save", async (c) => {
		const session = await verifySettingsSession(c);
		if (!session) return c.json({ error: "Not authenticated" }, 401);

		const { agentId, integrationId, apiKey } = await c.req.json<{
			agentId: string;
			integrationId: string;
			apiKey: string;
		}>();

		if (!agentId || !integrationId || !apiKey) {
			return c.json(
				{ error: "Missing agentId, integrationId, or apiKey" },
				400,
			);
		}

		if (
			!config.integrationConfigService ||
			!config.integrationCredentialStore
		) {
			return c.json({ error: "Integration services not configured" }, 500);
		}

		// Verify the integration exists and is api-key type
		const integrationConfig =
			await config.integrationConfigService.getIntegration(
				integrationId,
				agentId,
			);
		if (!integrationConfig) {
			return c.json({ error: "Integration not found" }, 404);
		}
		if ((integrationConfig.authType || "oauth") !== "api-key") {
			return c.json({ error: "Integration is not an API key type" }, 400);
		}

		// Store the API key as a credential
		await config.integrationCredentialStore.setCredentials(
			agentId,
			integrationId,
			{
				accessToken: apiKey,
				tokenType: "api-key",
				grantedScopes: [],
			},
		);

		// Notify active workers
		config.connectionManager?.notifyAgent(agentId, "config_changed", {
			changes: [`integration:${integrationId}:default:connected`],
		});

		return c.json({ success: true });
	});

	return app;
}
