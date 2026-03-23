import * as nodeFs from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createLogger } from "@lobu/core";
import FormData from "form-data";
import { fetchAudioProviderSuggestions } from "./audio-provider-suggestions";

const logger = createLogger("shared-tools");

/** Standard text result shape used by both SDK wrappers */
export interface TextResult {
  [key: string]: unknown;
  content: Array<{ [key: string]: unknown; type: "text"; text: string }>;
}

function textResult(text: string): TextResult {
  return { content: [{ type: "text" as const, text }] };
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function withErrorHandling(
  label: string,
  fn: () => Promise<TextResult>
): Promise<TextResult> {
  return fn().catch((error) => {
    logger.error(`${label} error:`, error);
    return textResult(`Error: ${formatError(error)}`);
  });
}

async function parseErrorBody(response: Response): Promise<{ error?: string }> {
  return response
    .json()
    .catch(() => ({ error: response.statusText })) as Promise<{
    error?: string;
  }>;
}

interface GatewayRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

async function gatewayFetch<T>(
  gw: GatewayParams,
  urlPath: string,
  options: GatewayRequestOptions = {},
  errorPrefix: string
): Promise<{ data?: T; error?: TextResult }> {
  const { method, body, headers: extraHeaders } = options;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${gw.workerToken}`,
    ...extraHeaders,
  };
  if (body) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(`${gw.gatewayUrl}${urlPath}`, {
    method,
    headers,
    body,
  });

  if (!response.ok) {
    const errorData = await parseErrorBody(response);
    logger.error(`${errorPrefix}: ${response.status}`, errorData);
    return {
      error: textResult(`Error: ${errorData.error || errorPrefix}`),
    };
  }

  const data = (await response.json()) as T;
  return { data };
}

/**
 * Gateway connection params shared by all tool implementations.
 */
export interface GatewayParams {
  gatewayUrl: string;
  workerToken: string;
  channelId: string;
  conversationId: string;
  platform?: string;
}

// ============================================================================
// Utility: Content type detection
// ============================================================================

const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".csv": "text/csv",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".json": "application/json",
  ".html": "text/html",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".py": "text/x-python",
  ".js": "text/javascript",
  ".ts": "text/typescript",
  ".zip": "application/zip",
  ".tar": "application/x-tar",
  ".gz": "application/gzip",
};

export function getContentType(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  return CONTENT_TYPES[ext] || "application/octet-stream";
}

// ============================================================================
// Utility: FormData buffer serialisation
// ============================================================================

export async function formDataToBuffer(formData: FormData): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    formData.on("data", (chunk: string | Buffer) => {
      if (typeof chunk === "string") {
        chunks.push(Buffer.from(chunk));
      } else {
        chunks.push(chunk);
      }
    });
    formData.on("end", () => resolve(Buffer.concat(chunks)));
    formData.on("error", (err: Error) => reject(err));
    formData.resume();
  });
}

// ============================================================================
// UploadUserFile
// ============================================================================

export async function uploadUserFile(
  gw: GatewayParams,
  args: { file_path: string; description?: string }
): Promise<TextResult> {
  return withErrorHandling("Show file tool", async () => {
    logger.info(
      `Show file to user: ${args.file_path}, description: ${args.description || "none"}`
    );

    const filePath = path.isAbsolute(args.file_path)
      ? args.file_path
      : path.join(process.cwd(), args.file_path);

    const stats = await fs.stat(filePath).catch(() => null);
    if (!stats || !stats.isFile()) {
      return textResult(
        `Error: Cannot show file - not found or is not a file: ${args.file_path}`
      );
    }
    if (stats.size === 0) {
      return textResult(`Error: Cannot show empty file: ${args.file_path}`);
    }

    const fileName = path.basename(filePath);
    const fileBuffer = await fs.readFile(filePath);

    const formData = new FormData();
    formData.append("file", fileBuffer, {
      filename: fileName,
      contentType: getContentType(fileName),
    });
    formData.append("filename", fileName);
    if (args.description) {
      formData.append("comment", args.description);
    }

    const formDataBuffer = await formDataToBuffer(formData);
    const fdHeaders = formData.getHeaders();

    const response = await fetch(`${gw.gatewayUrl}/internal/files/upload`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${gw.workerToken}`,
        "X-Channel-Id": gw.channelId,
        "X-Conversation-Id": gw.conversationId,
        ...fdHeaders,
        "Content-Length": formDataBuffer.length.toString(),
      },
      body: formDataBuffer,
    });

    if (!response.ok) {
      const error = await response.text();
      logger.error(`Failed to show file: ${response.status} - ${error}`);
      return textResult(
        `Error: Failed to show file to user: ${response.status} - ${error}`
      );
    }

    const result = (await response.json()) as {
      fileId: string;
      name: string;
      permalink: string;
    };
    logger.info(
      `Successfully showed file to user: ${result.fileId} - ${result.name}`
    );
    return textResult(`Successfully showed ${fileName} to the user`);
  });
}

// ============================================================================
// AskUserQuestion
// ============================================================================

export async function askUserQuestion(
  gw: GatewayParams,
  args: { question: string; options: unknown }
): Promise<TextResult> {
  return withErrorHandling("AskUserQuestion", async () => {
    logger.info(`AskUserQuestion: ${args.question}`);

    const { error } = await gatewayFetch<{ id: string }>(
      gw,
      "/internal/interactions/create",
      {
        method: "POST",
        body: JSON.stringify({
          interactionType: "question",
          question: args.question,
          options: args.options,
        }),
      },
      "Failed to post question"
    );
    if (error) return error;

    return textResult(
      "Question posted with buttons. Your session will end now. The user's answer will arrive as your next message."
    );
  });
}

// ============================================================================
// ScheduleReminder
// ============================================================================

export async function scheduleReminder(
  gw: GatewayParams,
  args: {
    task: string;
    delayMinutes?: number;
    cron?: string;
    maxIterations?: number;
  }
): Promise<TextResult> {
  return withErrorHandling("ScheduleReminder", async () => {
    const scheduleType = args.cron
      ? `cron: ${args.cron}`
      : `${args.delayMinutes} minutes`;
    logger.info(
      `ScheduleReminder: ${scheduleType} - ${args.task.substring(0, 50)}...`
    );

    interface ScheduleResult {
      scheduleId: string;
      scheduledFor: string;
      isRecurring: boolean;
      cron?: string;
      maxIterations: number;
      message: string;
    }

    const { data, error } = await gatewayFetch<ScheduleResult>(
      gw,
      "/internal/schedule",
      {
        method: "POST",
        body: JSON.stringify({
          delayMinutes: args.delayMinutes,
          cron: args.cron,
          maxIterations: args.maxIterations,
          task: args.task,
        }),
      },
      "Failed to schedule reminder"
    );
    if (error) return error;
    const result = data!;

    logger.info(
      `Scheduled reminder: ${result.scheduleId} for ${result.scheduledFor}${result.isRecurring ? ` (recurring: ${result.cron})` : ""}`
    );

    const recurringInfo = result.isRecurring
      ? `\nRecurring: ${result.cron} (max ${result.maxIterations} iterations)`
      : "";

    return textResult(
      `Reminder scheduled successfully!\n\nSchedule ID: ${result.scheduleId}\nFirst trigger: ${new Date(result.scheduledFor).toLocaleString()}${recurringInfo}\n\nYou can cancel this with CancelReminder if needed.`
    );
  });
}

// ============================================================================
// CancelReminder
// ============================================================================

export async function cancelReminder(
  gw: GatewayParams,
  args: { scheduleId: string }
): Promise<TextResult> {
  return withErrorHandling("CancelReminder", async () => {
    logger.info(`CancelReminder: ${args.scheduleId}`);

    interface CancelResult {
      success: boolean;
      message: string;
    }

    const { data, error } = await gatewayFetch<CancelResult>(
      gw,
      `/internal/schedule/${encodeURIComponent(args.scheduleId)}`,
      { method: "DELETE" },
      "Failed to cancel reminder"
    );
    if (error) return error;
    const result = data!;

    return textResult(
      result.success
        ? "Reminder cancelled successfully."
        : `Could not cancel reminder: ${result.message}`
    );
  });
}

// ============================================================================
// ListReminders
// ============================================================================

export async function listReminders(gw: GatewayParams): Promise<TextResult> {
  return withErrorHandling("ListReminders", async () => {
    logger.info("ListReminders");

    interface ReminderEntry {
      scheduleId: string;
      task: string;
      scheduledFor: string;
      minutesRemaining: number;
      isRecurring: boolean;
      cron?: string;
      iteration: number;
      maxIterations: number;
    }

    const { data, error } = await gatewayFetch<{ reminders: ReminderEntry[] }>(
      gw,
      "/internal/schedule",
      {},
      "Failed to list reminders"
    );
    if (error) return error;
    const { reminders } = data!;

    if (reminders.length === 0) {
      return textResult("No pending reminders scheduled.");
    }

    const formatted = reminders
      .map((r, i) => {
        const timeStr =
          r.minutesRemaining < 60
            ? `${r.minutesRemaining} minutes`
            : `${Math.round(r.minutesRemaining / 60)} hours`;
        const recurringInfo = r.isRecurring
          ? `\n   Recurring: ${r.cron} (iteration ${r.iteration}/${r.maxIterations})`
          : "";
        return `${i + 1}. [${r.scheduleId}]\n   Task: ${r.task}\n   Next trigger in: ${timeStr} (${new Date(r.scheduledFor).toLocaleString()})${recurringInfo}`;
      })
      .join("\n\n");

    return textResult(
      `Pending reminders (${reminders.length}):\n\n${formatted}`
    );
  });
}

// ============================================================================
// SearchSkills (unified search for skills + MCP servers)
// ============================================================================

interface SkillIntegrationRef {
  id: string;
  label?: string;
  authType?: string;
  scopes?: string[];
  apiDomains?: string[];
}

interface SkillMcpServerRef {
  id: string;
  name?: string;
  url?: string;
  type?: string;
  command?: string;
  args?: string[];
}

interface SkillSearchResult {
  id: string;
  name: string;
  description: string;
  source: string;
  score?: number;
  uri?: string;
  integrations?: SkillIntegrationRef[];
  mcpServers?: SkillMcpServerRef[];
  nixPackages?: string[];
  permissions?: string[];
  providers?: string[];
}

interface McpSearchResult {
  id: string;
  name: string;
  description: string;
  source: string;
}

function formatSkillSearchResults(results: SkillSearchResult[]): string {
  return results
    .map((item, index) => {
      const lines = [
        `${index + 1}. ${item.name} (${item.id})`,
        `   ${item.description || "No description"}`,
        `   source: ${item.source}${item.score != null ? ` | score: ${Math.round(item.score * 100) / 100}` : ""}${item.uri ? ` | ${item.uri}` : ""}`,
      ];
      const deps: string[] = [];
      if (item.nixPackages?.length)
        deps.push(`packages: ${item.nixPackages.join(", ")}`);
      if (item.permissions?.length)
        deps.push(`domains: ${item.permissions.join(", ")}`);
      if (item.integrations?.length)
        deps.push(
          `integrations: ${item.integrations.map((i) => i.label || i.id).join(", ")}`
        );
      if (item.mcpServers?.length)
        deps.push(
          `mcpServers: ${item.mcpServers.map((m) => m.name || m.id).join(", ")}`
        );
      if (item.providers?.length)
        deps.push(`providers: ${item.providers.join(", ")}`);
      if (deps.length) lines.push(`   requires: ${deps.join(" | ")}`);
      return lines.join("\n");
    })
    .join("\n\n");
}

function formatMcpSearchResults(
  results: McpSearchResult[],
  startIndex: number
): string {
  return results
    .map(
      (item, index) =>
        `${startIndex + index + 1}. ${item.name} (${item.id})\n   ${item.description || "No description"}`
    )
    .join("\n\n");
}

export async function searchSkills(
  gw: GatewayParams,
  args: { query: string; limit?: number }
): Promise<TextResult> {
  return withErrorHandling("SearchSkills", async () => {
    const query = (args.query || "").trim();
    const limit = Math.min(args.limit || 5, 10);

    // Empty query → list installed capabilities
    if (!query) {
      return listInstalledCapabilities(gw);
    }

    let skills: SkillSearchResult[] = [];
    let mcps: McpSearchResult[] = [];

    try {
      const response = await fetch(
        `${gw.gatewayUrl}/internal/integrations/search?q=${encodeURIComponent(query)}&limit=${limit}`,
        { headers: { Authorization: `Bearer ${gw.workerToken}` } }
      );
      if (response.ok) {
        const data = (await response.json()) as {
          skills: Array<{
            id: string;
            name: string;
            description?: string;
            source: string;
            score?: number;
            uri?: string;
            integrations?: SkillIntegrationRef[];
            mcpServers?: SkillMcpServerRef[];
            nixPackages?: string[];
            permissions?: string[];
            providers?: string[];
          }>;
          mcps: Array<{
            id: string;
            name: string;
            description: string;
            source: string;
          }>;
        };
        skills = (data.skills || []).map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description || "",
          source: s.source || "registry",
          score: s.score,
          uri: s.uri,
          integrations: s.integrations,
          mcpServers: s.mcpServers,
          nixPackages: s.nixPackages,
          permissions: s.permissions,
          providers: s.providers,
        }));
        mcps = (data.mcps || []).map((m) => ({
          id: m.id,
          name: m.name,
          description: m.description || "",
          source: m.source || "mcp-registry",
        }));
      }
    } catch (error) {
      logger.error("Failed to search integrations from gateway:", error);
    }

    if (!skills.length && !mcps.length) {
      return textResult(
        `No results found for "${query}". Try a broader query.`
      );
    }

    const sections: string[] = [];
    if (skills.length) {
      sections.push(
        `Skills (${skills.length}):\n\n${formatSkillSearchResults(skills)}`
      );
    }
    if (mcps.length) {
      sections.push(
        `MCP Servers (${mcps.length}):\n\n${formatMcpSearchResults(mcps, skills.length)}`
      );
    }

    return textResult(
      `${sections.join("\n\n")}\n\n` +
        `Prefer system skills (source: system) — they are curated and pre-configured.\n` +
        `Use InstallSkill with the selected id to install a skill from these results.`
    );
  });
}

/**
 * List installed capabilities (skills, integrations, MCP servers) for the current agent.
 */
async function listInstalledCapabilities(
  gw: GatewayParams
): Promise<TextResult> {
  interface InstalledSkill {
    id: string;
    name: string;
    enabled: boolean;
    integrations?: SkillIntegrationRef[];
  }
  interface InstalledIntegration {
    id: string;
    label: string;
    authType: string;
    connected: boolean;
    accounts: Array<{ accountId: string; grantedScopes: string[] }>;
  }
  interface InstalledMcp {
    id: string;
    enabled: boolean;
    type?: string;
  }

  const { data, error } = await gatewayFetch<{
    skills: InstalledSkill[];
    integrations: InstalledIntegration[];
    mcpServers: InstalledMcp[];
  }>(
    gw,
    "/internal/integrations/installed",
    {},
    "Failed to list installed capabilities"
  );
  if (error) return error;

  const { skills, integrations, mcpServers } = data!;

  if (!skills.length && !integrations.length && !mcpServers.length) {
    return textResult(
      "No capabilities installed yet. Use SearchSkills with a query to find skills and MCP servers to install."
    );
  }

  const sections: string[] = [];

  if (skills.length) {
    const formatted = skills
      .map((s, i) => {
        const status = s.enabled ? "enabled" : "disabled";
        const integrationsInfo = s.integrations?.length
          ? ` [integrations: ${s.integrations.map((ig) => ig.label || ig.id).join(", ")}]`
          : "";
        return `${i + 1}. ${s.name} (${s.id}) — ${status}${integrationsInfo}`;
      })
      .join("\n");
    sections.push(`Skills (${skills.length}):\n${formatted}`);
  }

  if (integrations.length) {
    const formatted = integrations
      .map((ig, i) => {
        const status = ig.connected
          ? `${ig.accounts.length} account(s) connected`
          : "not connected";
        return `${i + 1}. [${ig.authType}] ${ig.label} (${ig.id}) — ${status}`;
      })
      .join("\n");
    sections.push(`Integrations (${integrations.length}):\n${formatted}`);
  }

  if (mcpServers.length) {
    const formatted = mcpServers
      .map((m, i) => {
        const status = m.enabled ? "enabled" : "disabled";
        return `${i + 1}. ${m.id} [${m.type || "unknown"}] — ${status}`;
      })
      .join("\n");
    sections.push(`MCP Servers (${mcpServers.length}):\n${formatted}`);
  }

  return textResult(sections.join("\n\n"));
}

// ============================================================================
// InstallSkill (resolve manifest, generate settings link for user confirmation)
// ============================================================================

interface ConfigureArgs {
  reason: string;
  message?: string;
  providers?: string[];
  skills?: Array<{
    repo: string;
    name?: string;
    description?: string;
  }>;
  nixPackages?: string[];
  grants?: string[];
  mcpServers?: Array<{
    id: string;
    name?: string;
    url?: string;
    type?: string;
    command?: string;
    args?: string[];
  }>;
}

export async function installPackage(
  gw: GatewayParams,
  args: { packages: string[]; reason: string }
): Promise<TextResult> {
  return withErrorHandling("InstallPackage", async () => {
    logger.info(`InstallPackage: ${args.packages.join(", ")} — ${args.reason}`);

    interface SettingsLinkResult {
      type?: string;
      message?: string;
    }

    const { data, error } = await gatewayFetch<SettingsLinkResult>(
      gw,
      "/internal/settings-link",
      {
        method: "POST",
        body: JSON.stringify({
          nixPackages: args.packages,
          reason: args.reason,
        }),
      },
      "Failed to request package install"
    );
    if (error) return error;
    const result = data!;

    if (result.type === "inline_package") {
      return textResult(
        "Approval buttons have been sent to the user in chat. Stop working and wait for the user's response — packages will be available after approval on the next message."
      );
    }

    return textResult(
      result.message || "Package install request sent to user."
    );
  });
}

export async function requestNetworkAccess(
  gw: GatewayParams,
  args: { domains: string[]; reason: string }
): Promise<TextResult> {
  return configure(gw, {
    reason: args.reason,
    grants: args.domains,
  });
}

export async function installSkill(
  gw: GatewayParams,
  args: { id: string; upgrade?: boolean }
): Promise<TextResult> {
  return withErrorHandling("InstallSkill", async () => {
    const action = args.upgrade ? "Upgrade" : "Install";

    interface InstallResult {
      type: "auto_installed" | "needs_setup" | "manifest";
      id?: string;
      name: string;
      source?: string;
      uri?: string | null;
      description?: string;
      message?: string;
      integrations?: SkillIntegrationRef[];
      mcpServers?: SkillMcpServerRef[];
      nixPackages?: string[];
      permissions?: string[];
      providers?: string[];
      missing?: string[];
      prefillMcpServer?: {
        id: string;
        name: string;
        url: string;
        type?: string;
      };
    }

    const { data, error } = await gatewayFetch<InstallResult>(
      gw,
      "/internal/integrations/install",
      {
        method: "POST",
        body: JSON.stringify({ id: args.id, upgrade: args.upgrade }),
      },
      "Failed to install integration"
    );
    if (error) return error;
    const result = data!;

    // Auto-installed — no settings page needed
    if (result.type === "auto_installed") {
      return textResult(result.message || `${result.name} has been enabled.`);
    }

    // needs_setup or manifest — build ConfigureArgs and show settings link
    const skillId = result.id || args.id;
    const prefill: ConfigureArgs = {
      reason: `${action} "${result.name}"`,
    };

    // Add skill entry
    if (!result.prefillMcpServer) {
      prefill.skills = [
        {
          repo: skillId,
          name: result.name,
          description: result.description,
        },
      ];
    }

    // Collect grants from permissions + integration apiDomains
    const grants: string[] = [...(result.permissions || [])];
    if (result.integrations) {
      for (const ig of result.integrations) {
        if (ig.apiDomains) {
          grants.push(...ig.apiDomains);
        }
      }
    }
    if (grants.length) {
      prefill.grants = [...new Set(grants)];
    }

    if (result.nixPackages?.length) {
      prefill.nixPackages = result.nixPackages;
    }
    if (result.providers?.length) {
      prefill.providers = result.providers;
    }

    // Pre-fill MCP servers
    if (result.mcpServers?.length) {
      prefill.mcpServers = result.mcpServers.map((m) => ({
        id: m.id,
        name: m.name,
        url: m.url,
        type: m.type,
        command: m.command,
        args: m.args,
      }));
    } else if (result.prefillMcpServer) {
      prefill.mcpServers = [result.prefillMcpServer];
    }

    return configure(gw, prefill);
  });
}

// ============================================================================
// Configure
// ============================================================================

export async function configure(
  gw: GatewayParams,
  args: ConfigureArgs
): Promise<TextResult> {
  return withErrorHandling("Configure", async () => {
    logger.info(`Configure: ${args.reason}`);

    interface SettingsLinkResult {
      url?: string;
      expiresAt?: string;
      type?: string;
      message?: string;
    }

    const { data, error } = await gatewayFetch<SettingsLinkResult>(
      gw,
      "/internal/settings-link",
      {
        method: "POST",
        body: JSON.stringify({
          reason: args.reason,
          message: args.message,
          providers: args.providers,
          nixPackages: args.nixPackages,
          grants: args.grants,
          skills: args.skills,
          mcpServers: args.mcpServers,
        }),
      },
      "Failed to generate settings link"
    );
    if (error) return error;
    const result = data!;

    // Inline grant approval — buttons sent directly in chat
    if (result.type === "inline_grant") {
      logger.info("Inline grant approval sent to user");
      return textResult(
        "Approval buttons have been sent to the user in chat. Stop working and wait for the user's response — it will arrive as the next message. Do NOT continue until you receive the approval."
      );
    }

    // Settings link sent as native platform button
    if (result.type === "settings_link") {
      logger.info("Settings link button sent to user");
      return textResult(
        "A settings button has been sent to the user in chat. Do not include any URL in your response. Ask the user to tap the button to configure their settings."
      );
    }

    logger.info(`Generated settings link: ${result.url}`);

    const expiresLabel = result.expiresAt
      ? `Expires: ${new Date(result.expiresAt).toLocaleString()}`
      : "";

    return textResult(
      `Settings link generated successfully!\n\nURL: ${result.url}\n\n${expiresLabel}\n\nReason: ${args.reason}\n\nShare this link with the user so they can configure their settings.`
    );
  });
}

// ============================================================================
// GenerateImage
// ============================================================================

function imageExtFromMime(mimeType: string): string {
  if (mimeType.includes("jpeg")) return "jpg";
  if (mimeType.includes("webp")) return "webp";
  return "png";
}

export async function generateImage(
  gw: GatewayParams,
  args: {
    prompt: string;
    size?: "1024x1024" | "1024x1536" | "1536x1024" | "auto";
    quality?: "low" | "medium" | "high" | "auto";
    background?: "transparent" | "opaque" | "auto";
    format?: "png" | "jpeg" | "webp";
  }
): Promise<TextResult> {
  return withErrorHandling("GenerateImage", async () => {
    logger.info(`GenerateImage: ${args.prompt.substring(0, 80)}...`);

    const capResponse = await fetch(
      `${gw.gatewayUrl}/internal/images/capabilities`,
      {
        headers: { Authorization: `Bearer ${gw.workerToken}` },
      }
    );

    if (capResponse.ok) {
      const capabilities = (await capResponse.json()) as {
        available: boolean;
        providers?: Array<{ provider: string; name: string }>;
      };
      if (!capabilities.available) {
        const providerList =
          capabilities.providers?.map((p) => p.name).join(", ") || "OpenAI";
        return textResult(
          `Image generation is not configured. Supported providers: ${providerList}.\n\nConnect a provider via the settings page to enable image generation.`
        );
      }
    }

    const response = await fetch(`${gw.gatewayUrl}/internal/images/generate`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${gw.workerToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: args.prompt,
        size: args.size,
        quality: args.quality,
        background: args.background,
        format: args.format,
      }),
    });

    if (!response.ok) {
      const errorData = (await parseErrorBody(response)) as {
        error?: string;
        availableProviders?: string[];
      };
      const errorMessage = errorData.error || "Unknown error";
      const lowerError = errorMessage.toLowerCase();
      const missingImagePermission =
        lowerError.includes("missing scopes") ||
        lowerError.includes("missing_scope") ||
        (lowerError.includes("scope") &&
          (lowerError.includes("image") ||
            lowerError.includes("model.request")));

      if (errorData.availableProviders?.length) {
        return textResult(
          `Image generation failed: ${errorMessage}.\n\nConnect a provider via the settings page to enable image generation.`
        );
      }

      if (missingImagePermission) {
        return textResult(
          `Image generation failed because the current credential lacks required image permissions.\n\nConnect a different provider with image generation access via the settings page.`
        );
      }

      return textResult(`Error generating image: ${errorMessage}`);
    }

    const imageBuffer = await response.arrayBuffer();
    const mimeType = response.headers.get("Content-Type") || "image/png";
    const provider = response.headers.get("X-Image-Provider") || "unknown";
    const ext = imageExtFromMime(mimeType);

    let tempPath: string | null = null;
    try {
      tempPath = `/tmp/image_${Date.now()}.${ext}`;
      await fs.writeFile(tempPath, Buffer.from(imageBuffer));

      const formData = new FormData();
      formData.append("file", nodeFs.createReadStream(tempPath), {
        filename: `generated_image.${ext}`,
        contentType: mimeType,
      });
      formData.append("filename", `generated_image.${ext}`);
      formData.append("comment", "Generated image");

      const formDataBuffer = await formDataToBuffer(formData);
      const fdHeaders = formData.getHeaders();

      const uploadResponse = await fetch(
        `${gw.gatewayUrl}/internal/files/upload`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${gw.workerToken}`,
            "X-Channel-Id": gw.channelId,
            "X-Conversation-Id": gw.conversationId,
            ...fdHeaders,
            "Content-Length": formDataBuffer.length.toString(),
          },
          body: formDataBuffer,
        }
      );

      if (!uploadResponse.ok) {
        const uploadError = await uploadResponse.text();
        return textResult(`Generated image but failed to send: ${uploadError}`);
      }
    } finally {
      if (tempPath) {
        await fs.unlink(tempPath).catch(() => undefined);
      }
    }

    logger.info(`Image generated and sent using ${provider}`);
    return textResult(`Image sent successfully (generated with ${provider}).`);
  });
}

// ============================================================================
// GenerateAudio
// ============================================================================

function audioExtFromMime(mimeType: string): string {
  if (mimeType.includes("opus")) return "opus";
  if (mimeType.includes("ogg")) return "ogg";
  return "mp3";
}

export async function generateAudio(
  gw: GatewayParams,
  args: { text: string; voice?: string; speed?: number }
): Promise<TextResult> {
  return withErrorHandling("GenerateAudio", async () => {
    logger.info(`GenerateAudio: ${args.text.substring(0, 50)}...`);

    const suggestions = await fetchAudioProviderSuggestions({
      gatewayUrl: gw.gatewayUrl,
      workerToken: gw.workerToken,
    });
    const providerList =
      suggestions.providerDisplayList || "an audio-capable provider";

    if (suggestions.available === false) {
      return textResult(
        `Audio generation is not configured. To enable it, connect one of the available providers: ${providerList}.\n\nConnect an audio provider via the settings page.`
      );
    }

    const response = await fetch(`${gw.gatewayUrl}/internal/audio/synthesize`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${gw.workerToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: args.text,
        voice: args.voice,
        speed: args.speed,
      }),
    });

    if (!response.ok) {
      const errorData = (await parseErrorBody(response)) as {
        error?: string;
        availableProviders?: string[];
      };
      const errorMessage = errorData.error || "Unknown error";
      const lowerError = errorMessage.toLowerCase();
      const missingOpenAiAudioScope =
        (lowerError.includes("missing scopes") ||
          lowerError.includes("missing_scope")) &&
        lowerError.includes("api.model.audio.request");

      if (errorData.availableProviders?.length) {
        return textResult(
          `Audio generation failed: ${errorMessage}. No provider configured.\n\nConnect an audio provider via the settings page.`
        );
      }

      if (missingOpenAiAudioScope) {
        return textResult(
          `Audio generation failed because the current OpenAI token lacks api.model.audio.request.\n\nConnect a provider with audio permission via the settings page, or connect an alternative audio provider (${providerList}).`
        );
      }

      return textResult(`Error generating audio: ${errorMessage}`);
    }

    const audioBuffer = await response.arrayBuffer();
    const mimeType = response.headers.get("Content-Type") || "audio/mpeg";
    const provider = response.headers.get("X-Audio-Provider") || "unknown";
    const ext = audioExtFromMime(mimeType);

    let tempPath: string | null = null;
    try {
      tempPath = `/tmp/audio_${Date.now()}.${ext}`;
      await fs.writeFile(tempPath, Buffer.from(audioBuffer));

      const formData = new FormData();
      formData.append("file", nodeFs.createReadStream(tempPath), {
        filename: `voice_response.${ext}`,
        contentType: mimeType,
      });
      formData.append("filename", `voice_response.${ext}`);
      formData.append("comment", "Voice response");

      const formDataBuffer = await formDataToBuffer(formData);
      const fdHeaders = formData.getHeaders();

      const uploadResponse = await fetch(
        `${gw.gatewayUrl}/internal/files/upload`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${gw.workerToken}`,
            "X-Channel-Id": gw.channelId,
            "X-Conversation-Id": gw.conversationId,
            "X-Voice-Message": "true",
            ...fdHeaders,
            "Content-Length": formDataBuffer.length.toString(),
          },
          body: formDataBuffer,
        }
      );

      if (!uploadResponse.ok) {
        const uploadError = await uploadResponse.text();
        return textResult(`Generated audio but failed to send: ${uploadError}`);
      }
    } finally {
      if (tempPath) {
        await fs.unlink(tempPath).catch(() => undefined);
      }
    }

    logger.info(`Audio generated and sent using ${provider}`);
    return textResult(
      `Voice message sent successfully (generated with ${provider}).`
    );
  });
}

// ============================================================================
// GetChannelHistory
// ============================================================================

export async function getChannelHistory(
  gw: GatewayParams,
  args: { limit?: number; before?: string }
): Promise<TextResult> {
  return withErrorHandling("GetChannelHistory", async () => {
    const limit = Math.min(Math.max(args.limit || 50, 1), 100);
    const platform = gw.platform || "slack";
    logger.info(
      `GetChannelHistory: limit=${limit}, before=${args.before || "none"}`
    );

    const params = new URLSearchParams({
      platform,
      channelId: gw.channelId,
      conversationId: gw.conversationId,
      limit: String(limit),
    });

    if (args.before) {
      params.set("before", args.before);
    }

    interface HistoryResult {
      messages: Array<{
        timestamp: string;
        user: string;
        text: string;
        isBot?: boolean;
      }>;
      nextCursor: string | null;
      hasMore: boolean;
      note?: string;
    }

    const { data, error } = await gatewayFetch<HistoryResult>(
      gw,
      `/internal/history?${params}`,
      {},
      "Failed to fetch channel history"
    );
    if (error) return error;
    const history = data!;

    if (history.note) {
      return textResult(history.note);
    }

    if (history.messages.length === 0) {
      return textResult("No messages found in channel history.");
    }

    const formatted = history.messages
      .map((msg) => {
        const time = new Date(msg.timestamp).toLocaleString();
        const sender = msg.isBot ? `[Bot] ${msg.user}` : msg.user;
        return `[${time}] ${sender}: ${msg.text}`;
      })
      .join("\n\n");

    let result = `Found ${history.messages.length} messages:\n\n${formatted}`;

    if (history.hasMore && history.nextCursor) {
      result += `\n\n---\nMore messages available. Use before="${history.nextCursor}" to fetch older messages.`;
    }

    return textResult(result);
  });
}

// ============================================================================
// MCP Tools (route to MCP proxy /mcp/{mcpId}/tools/{toolName})
// ============================================================================

export async function callMcpTool(
  gw: GatewayParams,
  mcpId: string,
  toolName: string,
  args: Record<string, unknown>
): Promise<TextResult> {
  return withErrorHandling(`${mcpId}/${toolName}`, async () => {
    const response = await fetch(
      `${gw.gatewayUrl}/mcp/${mcpId}/tools/${toolName}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${gw.workerToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(args),
      }
    );

    const data = (await response.json()) as {
      content?: Array<{ type: string; text: string }>;
      error?: string;
      isError?: boolean;
    };

    if (!response.ok || data.isError) {
      const contentText = data.content
        ?.filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("\n");
      const errorMsg =
        data.error || contentText || `${toolName} failed (${response.status})`;
      return textResult(`Error: ${errorMsg}`);
    }

    const text = data.content
      ?.filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n");
    return textResult(text || `${toolName} completed.`);
  });
}
