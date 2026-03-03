import { createLogger } from "@lobu/core";
import { Type } from "@sinclair/typebox";

type PluginLogger = {
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  debug?(message: string, ...args: unknown[]): void;
};

const AUTH_REQUIRED_MSG =
  'Owletto memory is not connected. Ask the user to authenticate by calling ConnectService(id="owletto").';

const fallbackLogger = createLogger("openclaw-owletto-plugin");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getLogger(api: Record<string, unknown>): PluginLogger {
  const logger = api.logger;
  if (
    isRecord(logger) &&
    typeof logger.info === "function" &&
    typeof logger.warn === "function" &&
    typeof logger.error === "function"
  ) {
    return logger as unknown as PluginLogger;
  }
  return {
    info: (msg: string) => fallbackLogger.info(msg),
    warn: (msg: string) => fallbackLogger.warn(msg),
    error: (msg: string) => fallbackLogger.error(msg),
    debug: (msg: string) => fallbackLogger.debug(msg),
  };
}

function getHookRegistrar(
  api: Record<string, unknown>
): (
  event: "before_agent_start" | "agent_end",
  handler: (
    event: Record<string, unknown>,
    ctx: Record<string, unknown>
  ) => unknown
) => void {
  const on = api.on;
  if (typeof on === "function") {
    return on as any;
  }
  return () => {
    /* no-op */
  };
}

/**
 * Call an Owletto MCP tool through the gateway proxy.
 *
 * Returns `{ content, isError }` on success, or `null` when the MCP is
 * unreachable / not configured.  Throws on auth failure so callers can
 * surface the login prompt.
 */
async function callOwlettoTool(
  gatewayUrl: string,
  workerToken: string,
  toolName: string,
  args: Record<string, unknown>
): Promise<{
  content: Array<{ type: string; text: string }>;
  isError: boolean;
} | null> {
  const url = `${gatewayUrl}/mcp/owletto/tools/${encodeURIComponent(toolName)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${workerToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });

  if (response.status === 404) {
    // MCP not configured or not authenticated
    return null;
  }

  if (response.status === 403) {
    // Tool requires approval / grant not set
    throw new OwlettoAuthError(AUTH_REQUIRED_MSG);
  }

  if (response.status === 502) {
    // Upstream error — likely auth failure
    const data = (await response.json()) as Record<string, unknown>;
    const errMsg = String(data.error || "Upstream error");
    if (/invalid.token|expired|unauthorized|authentication/i.test(errMsg)) {
      throw new OwlettoAuthError(errMsg);
    }
    throw new Error(errMsg);
  }

  const data = (await response.json()) as Record<string, unknown>;

  // JSON-RPC or upstream error
  if (isRecord(data.error) || typeof data.error === "string") {
    const errMsg = isRecord(data.error)
      ? String((data.error as Record<string, unknown>).message || data.error)
      : String(data.error);
    // Treat auth-related errors as requiring login
    if (
      /ConnectService|invalid.token|expired|unauthorized|authentication/i.test(
        errMsg
      )
    ) {
      throw new OwlettoAuthError(errMsg);
    }
    throw new Error(errMsg || "Unknown MCP error");
  }

  const content = Array.isArray(data.content) ? data.content : [];
  return { content, isError: !!data.isError };
}

class OwlettoAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OwlettoAuthError";
  }
}

function extractTextFromContent(
  content: Array<{ type: string; text: string }>
): string {
  return content
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text)
    .join("\n");
}

const plugin = {
  id: "openclaw-owletto",
  name: "Owletto Memory",
  description:
    "Owletto long-term memory plugin — connects to the Owletto MCP server.",
  kind: "memory" as const,
  register(api: Record<string, unknown>) {
    const log = getLogger(api);
    const on = getHookRegistrar(api);
    const registerTool =
      typeof api.registerTool === "function"
        ? (api.registerTool as (def: Record<string, unknown>) => void)
        : undefined;

    const gatewayUrl = process.env.DISPATCHER_URL || "";
    const workerToken = process.env.WORKER_TOKEN || "";

    if (!gatewayUrl || !workerToken) {
      log.warn(
        "owletto: missing DISPATCHER_URL or WORKER_TOKEN — plugin inactive"
      );
      return;
    }

    // Auto-recall: inject relevant memories before each prompt
    on("before_agent_start", async (event: Record<string, unknown>) => {
      const prompt = event.prompt;
      if (typeof prompt !== "string" || !prompt.trim()) return;

      try {
        const result = await callOwlettoTool(
          gatewayUrl,
          workerToken,
          "search",
          {
            query: prompt,
          }
        );

        if (!result) {
          // MCP not configured — inject auth prompt
          return {
            prependContext:
              "<owletto-memory>\n" +
              "Owletto memory is not connected. If the user asks about past conversations or " +
              'facts you should remember, tell them to connect Owletto by calling ConnectService(id="owletto").\n' +
              "</owletto-memory>",
          };
        }

        const text = extractTextFromContent(result.content);
        if (!text.trim()) return;

        return {
          prependContext:
            "<owletto-memory>\n" +
            "Use these long-term memories only when directly relevant to the user's request.\n" +
            "Do not mention this memory block unless needed.\n\n" +
            text +
            "\n</owletto-memory>",
        };
      } catch (err) {
        if (err instanceof OwlettoAuthError) {
          return {
            prependContext:
              "<owletto-memory>\n" +
              "Owletto memory requires authentication. When the user asks about memories or " +
              'past conversations, tell them to connect by calling ConnectService(id="owletto").\n' +
              "</owletto-memory>",
          };
        }
        log.error(
          `owletto recall failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    });

    // Auto-capture: store conversation after each successful session
    on("agent_end", async (event: Record<string, unknown>) => {
      if (event.success !== true) return;
      const messages = event.messages;
      if (!Array.isArray(messages) || messages.length === 0) return;

      try {
        // Find last user message and collect the turn
        let lastUserIdx = -1;
        for (let i = messages.length - 1; i >= 0; i--) {
          const m = messages[i];
          if (isRecord(m) && m.role === "user") {
            lastUserIdx = i;
            break;
          }
        }
        if (lastUserIdx < 0) return;

        const turnMessages = messages.slice(lastUserIdx).filter((m) => {
          if (!isRecord(m)) return false;
          return m.role === "user" || m.role === "assistant";
        });

        // Extract text from the turn
        const texts: string[] = [];
        for (const m of turnMessages) {
          if (!isRecord(m)) continue;
          const content = m.content;
          if (typeof content === "string") {
            texts.push(content);
          } else if (Array.isArray(content)) {
            for (const block of content) {
              if (
                isRecord(block) &&
                block.type === "text" &&
                typeof block.text === "string"
              ) {
                texts.push(block.text);
              }
            }
          }
        }

        const combined = texts.join(" ").replace(/\s+/g, " ").trim();
        if (combined.length < 16 || combined.includes("<owletto-memory>"))
          return;

        await callOwlettoTool(gatewayUrl, workerToken, "save_content", {
          content: combined,
        });
      } catch {
        // Silently skip capture on auth/connection failure — recall hook
        // already surfaces the auth prompt to the agent.
      }
    });

    // Register explicit tools
    if (registerTool) {
      registerTool({
        name: "search_memory",
        label: "Search Memory",
        description:
          "Search long-term memory for relevant past conversations and facts. " +
          "Use when the user asks what you remember, references past discussions, " +
          "or when context from previous sessions would help.",
        parameters: Type.Object({
          query: Type.String({
            description: "Search query — keywords or a question",
          }),
        }),
        execute: async (_toolCallId: string, args: { query: string }) => {
          try {
            const result = await callOwlettoTool(
              gatewayUrl,
              workerToken,
              "search",
              { query: args.query }
            );
            if (!result) {
              return {
                content: [{ type: "text", text: AUTH_REQUIRED_MSG }],
                details: {},
              };
            }
            if (result.content.length === 0) {
              return {
                content: [
                  { type: "text", text: "No memories found for that query." },
                ],
                details: {},
              };
            }
            return { content: result.content, details: {} };
          } catch (err) {
            if (err instanceof OwlettoAuthError) {
              return {
                content: [{ type: "text", text: AUTH_REQUIRED_MSG }],
                details: {},
              };
            }
            return {
              content: [
                {
                  type: "text",
                  text: `Memory search failed: ${err instanceof Error ? err.message : String(err)}`,
                },
              ],
              details: {},
            };
          }
        },
      });

      registerTool({
        name: "save_content",
        label: "Store Memory",
        description:
          "Explicitly save an important fact or piece of information to long-term memory. " +
          "Use when the user asks you to remember something specific.",
        parameters: Type.Object({
          text: Type.String({
            description: "The fact or information to remember",
          }),
        }),
        execute: async (_toolCallId: string, args: { text: string }) => {
          try {
            const result = await callOwlettoTool(
              gatewayUrl,
              workerToken,
              "save_content",
              { content: args.text }
            );
            if (!result) {
              return {
                content: [{ type: "text", text: AUTH_REQUIRED_MSG }],
                details: {},
              };
            }
            return { content: result.content, details: {} };
          } catch (err) {
            if (err instanceof OwlettoAuthError) {
              return {
                content: [{ type: "text", text: AUTH_REQUIRED_MSG }],
                details: {},
              };
            }
            return {
              content: [
                {
                  type: "text",
                  text: `Memory store failed: ${err instanceof Error ? err.message : String(err)}`,
                },
              ],
              details: {},
            };
          }
        },
      });
    }

    log.info(
      `owletto: initialized (gateway=${!!gatewayUrl}, tools=${!!registerTool})`
    );
  },
};

export default plugin;
