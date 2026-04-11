import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { join } from "node:path";

const createInterfaceMock = mock(() => ({
  question: (_prompt: string, callback: (answer: string) => void) =>
    callback("1"),
  close: () => undefined,
}));

mock.module("node:readline", () => ({
  createInterface: createInterfaceMock,
}));

let chatCommand: typeof import("../commands/chat").chatCommand;

const originalFetch = globalThis.fetch;
const originalStdoutWrite = process.stdout.write.bind(process.stdout);
const originalConsoleError = console.error;
const originalToken = process.env.LOBU_API_TOKEN;
const exampleDir = join(import.meta.dir, "../../../../examples/hr-assistant");

function createSseResponse(
  events: Array<{ event: string; data: Record<string, unknown> }>
): Response {
  const encoder = new TextEncoder();
  const payload = events
    .map(
      ({ event, data }) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
    )
    .join("");

  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(payload));
        controller.close();
      },
    }),
    {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    }
  );
}

beforeAll(async () => {
  ({ chatCommand } = await import("../commands/chat"));
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.stdout.write = originalStdoutWrite;
  console.error = originalConsoleError;
  if (originalToken === undefined) {
    delete process.env.LOBU_API_TOKEN;
  } else {
    process.env.LOBU_API_TOKEN = originalToken;
  }
  mock.restore();
});

describe("chatCommand example integration", () => {
  test("uses the hr example agent and completes approval plus login interaction flow", async () => {
    process.env.LOBU_API_TOKEN = "cli-token";

    const stdout: string[] = [];
    const stderr: string[] = [];
    const createBodies: Array<Record<string, unknown>> = [];
    const approvalBodies: Array<Record<string, unknown>> = [];

    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdout.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    console.error = (...args: unknown[]) => {
      stderr.push(args.map((arg) => String(arg)).join(" "));
    };

    globalThis.fetch = mock(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (
          url === "http://gateway.test/api/v1/agents" &&
          init?.method === "POST"
        ) {
          const body = JSON.parse(String(init.body)) as Record<string, unknown>;
          createBodies.push(body);
          return Response.json({
            agentId: "session-1",
            token: "session-token",
          });
        }

        if (
          url === "http://gateway.test/api/v1/agents/session-1/events" &&
          !init?.method
        ) {
          return createSseResponse([
            {
              event: "output",
              data: { content: "Starting request.\n" },
            },
            {
              event: "tool-approval",
              data: {
                requestId: "approval-1",
                mcpId: "github",
                toolName: "delete_issue",
                args: { issue_number: 42 },
              },
            },
            {
              event: "link-button",
              data: {
                label: "Connect GitHub",
                url: "https://auth.example.com/device",
              },
            },
            {
              event: "question",
              data: {
                question: "Pick one",
                options: ["A", "B"],
              },
            },
            {
              event: "suggestion",
              data: {
                prompts: ["retry", "show me the details"],
              },
            },
            {
              event: "complete",
              data: {},
            },
          ]);
        }

        if (
          url === "http://gateway.test/api/v1/agents/session-1/messages" &&
          init?.method === "POST"
        ) {
          return Response.json({ success: true });
        }

        if (
          url === "http://gateway.test/api/v1/agents/approve" &&
          init?.method === "POST"
        ) {
          const body = JSON.parse(String(init.body)) as Record<string, unknown>;
          approvalBodies.push(body);
          return Response.json({
            result: {
              content: [{ text: "Approved tool result." }],
            },
          });
        }

        throw new Error(`Unexpected fetch: ${url}`);
      }
    ) as unknown as typeof fetch;

    await chatCommand(exampleDir, "please run the workflow", {
      gateway: "http://gateway.test",
      new: true,
    });

    expect(createBodies).toEqual([
      {
        agentId: "hr-assistant",
        forceNew: true,
      },
    ]);
    expect(approvalBodies).toEqual([
      {
        requestId: "approval-1",
        decision: "once",
      },
    ]);

    const stdoutText = stdout.join("");
    const stderrText = stderr.join("");

    expect(stdoutText).toContain("Starting request.");
    expect(stdoutText).toContain("Approved tool result.");
    expect(stderrText).toContain("Tool Approval Required");
    expect(stderrText).toContain("github");
    expect(stderrText).toContain('"event":"link-button"');
    expect(stderrText).toContain("Connect GitHub");
    expect(stderrText).toContain('"event":"question"');
    expect(stderrText).toContain('"event":"suggestion"');
    expect(createInterfaceMock).toHaveBeenCalledTimes(1);
  });

  test("streams platform-mode output for image and voice requests from the example agent", async () => {
    process.env.LOBU_API_TOKEN = "cli-token";

    const stdout: string[] = [];
    const stderr: string[] = [];
    const messageBodies: Array<Record<string, unknown>> = [];

    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdout.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    console.error = (...args: unknown[]) => {
      stderr.push(args.map((arg) => String(arg)).join(" "));
    };

    globalThis.fetch = mock(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (
          url === "http://gateway.test/api/v1/agents/hr-assistant/messages" &&
          init?.method === "POST"
        ) {
          const body = JSON.parse(String(init.body)) as Record<string, unknown>;
          messageBodies.push(body);
          return Response.json({
            success: true,
            eventsUrl: "/api/v1/agents/hr-assistant/events?platform=telegram",
          });
        }

        if (
          url ===
            "http://gateway.test/api/v1/agents/hr-assistant/events?platform=telegram" &&
          !init?.method
        ) {
          return createSseResponse([
            {
              event: "output",
              data: {
                content:
                  "Image sent successfully (generated with openai).\nVoice message sent successfully (generated with openai).\n",
              },
            },
            { event: "complete", data: {} },
          ]);
        }

        throw new Error(`Unexpected fetch: ${url}`);
      }
    ) as unknown as typeof fetch;

    await chatCommand(exampleDir, "send an image and a voice reply", {
      gateway: "http://gateway.test",
      user: "telegram:chat-123",
    });

    expect(messageBodies).toEqual([
      {
        platform: "telegram",
        content: "send an image and a voice reply",
        telegram: { chatId: "chat-123" },
      },
    ]);

    expect(stdout.join("")).toContain("Image sent successfully");
    expect(stdout.join("")).toContain("Voice message sent successfully");
    expect(stderr.join("")).not.toContain("Failed");
  });
});
