import chalk from "chalk";
import { getToken } from "../api/credentials.js";
import { isLoadError, loadConfig } from "../config/loader.js";
import { renderMarkdown } from "../utils/markdown.js";

/**
 * `lobu chat "prompt"` — send a prompt to an agent and stream the response.
 *
 * Requires `lobu dev` running. Connects to the local gateway,
 * creates a session, sends the message, streams output, then exits.
 */
export async function chatCommand(
  cwd: string,
  prompt: string,
  options: { agent?: string; gateway?: string }
): Promise<void> {
  const gatewayUrl = (options.gateway ?? "http://localhost:8080").replace(
    /\/$/,
    ""
  );

  // Resolve auth token: CLI JWT (from `lobu login`) → ADMIN_PASSWORD env var
  const authToken = (await getToken()) ?? process.env.ADMIN_PASSWORD;
  if (!authToken) {
    console.error(
      chalk.red(
        "\n  Authentication required. Run `lobu login` or set ADMIN_PASSWORD.\n"
      )
    );
    process.exit(1);
  }

  // Resolve agent ID from flag or first agent in lobu.toml
  const agentId = options.agent ?? (await resolveAgentId(cwd));

  // 1. Create agent session
  const createRes = await fetch(`${gatewayUrl}/api/v1/agents`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify({ agentId }),
  });

  if (!createRes.ok) {
    const body = await createRes.text().catch(() => "");
    if (createRes.status === 401) {
      console.error(
        chalk.red(
          "\n  Authentication required. Run `lobu login` or set ADMIN_PASSWORD.\n"
        )
      );
      process.exit(1);
    }
    console.error(
      chalk.red(`\n  Failed to create session (${createRes.status}): ${body}\n`)
    );
    process.exit(1);
  }

  const session = (await createRes.json()) as {
    agentId: string;
    token: string;
  };

  // Build URLs from gateway flag (returned URLs may point to a public domain)
  const base = `${gatewayUrl}/api/v1/agents/${session.agentId}`;
  const sseUrl = `${base}/events`;
  const messagesUrl = `${base}/messages`;

  // 2. Open SSE connection before sending message so we don't miss events
  const sseController = new AbortController();
  const streaming = streamResponse(sseUrl, session.token, sseController);

  // 3. Send the prompt
  const msgRes = await fetch(messagesUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.token}`,
    },
    body: JSON.stringify({ content: prompt }),
  });

  if (!msgRes.ok) {
    sseController.abort();
    const body = await msgRes.text().catch(() => "");
    console.error(
      chalk.red(`\n  Failed to send message (${msgRes.status}): ${body}\n`)
    );
    process.exit(1);
  }

  // 4. Wait for streaming to complete
  await streaming;
}

async function resolveAgentId(cwd: string): Promise<string> {
  const result = await loadConfig(cwd);
  if (isLoadError(result)) {
    console.error(chalk.red(`\n  ${result.error}\n`));
    return process.exit(1);
  }

  const ids = Object.keys(result.config.agents);
  if (ids.length === 0) {
    console.error(chalk.red("\n  No agents found in lobu.toml\n"));
    return process.exit(1);
  }

  return ids[0]!;
}

/**
 * Connect to SSE, print deltas to stdout, resolve on complete/error.
 */
async function streamResponse(
  sseUrl: string,
  token: string,
  controller: AbortController
): Promise<void> {
  const OVERALL_TIMEOUT_MS = 5 * 60 * 1000;
  const IDLE_TIMEOUT_MS = 60 * 1000;

  const overallTimer = setTimeout(() => controller.abort(), OVERALL_TIMEOUT_MS);
  let idleTimer = setTimeout(() => controller.abort(), IDLE_TIMEOUT_MS);

  const resetIdleTimer = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => controller.abort(), IDLE_TIMEOUT_MS);
  };

  try {
    const res = await fetch(sseUrl, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });

    if (!res.ok || !res.body) {
      console.error(chalk.red(`\n  SSE connection failed (${res.status})\n`));
      process.exit(1);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let currentEvent = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      resetIdleTimer();
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.startsWith("event: ")) {
          currentEvent = line.slice(7).trim();
        } else if (line.startsWith("data: ") && currentEvent) {
          const data = parseJSON(line.slice(6));
          if (!data) continue;

          switch (currentEvent) {
            case "output":
              if (typeof data.content === "string")
                process.stdout.write(renderMarkdown(data.content));
              break;
            case "ephemeral":
              if (typeof data.content === "string") {
                console.error(`\n${renderMarkdown(data.content)}\n`);
              }
              controller.abort();
              process.exit(1);
              break;
            case "complete":
              process.stdout.write("\n");
              controller.abort();
              return;
            case "error":
              process.stdout.write("\n");
              console.error(
                chalk.red(`\n  Agent error: ${String(data.error)}\n`)
              );
              controller.abort();
              process.exit(1);
          }

          currentEvent = "";
        } else if (line === "") {
          currentEvent = "";
        }
      }
    }
  } catch (err: unknown) {
    // AbortError is expected when we call controller.abort() on complete
    if (err instanceof Error && err.name === "AbortError") return;
    throw err;
  } finally {
    clearTimeout(overallTimer);
    clearTimeout(idleTimer);
  }
}

function parseJSON(str: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(str);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}
