/**
 * Translate between OpenAI Chat Completions and Gemini generateContent shapes.
 * Scope is the subset the worker actually uses: chat messages with optional
 * tool calls + tool results + streaming.
 */

export interface OpenAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | Array<{ type: string; text?: string }> | null;
  name?: string;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

export interface OpenAIChatRequest {
  model: string;
  messages: OpenAIMessage[];
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  tools?: Array<{
    type: "function";
    function: {
      name: string;
      description?: string;
      parameters?: Record<string, unknown>;
    };
  }>;
  tool_choice?: unknown;
}

interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}

interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

export interface GeminiRequest {
  contents: GeminiContent[];
  systemInstruction?: { parts: GeminiPart[] };
  tools?: Array<{
    functionDeclarations: Array<{
      name: string;
      description?: string;
      parameters?: Record<string, unknown>;
    }>;
  }>;
  generationConfig?: Record<string, unknown>;
}

/**
 * Gemini's OpenAPI schema subset rejects JSON-Schema keywords like `const`,
 * `$schema`, `additionalProperties`, `$ref`, etc. Sanitize recursively so the
 * adapter never forwards an unsupported keyword into a function declaration.
 * `const: "foo"` is rewritten to `enum: ["foo"]` so single-value constraints
 * survive the translation.
 */
const GEMINI_UNSUPPORTED_SCHEMA_KEYS = new Set([
  "$schema",
  "$id",
  "$ref",
  "$comment",
  "additionalProperties",
  "definitions",
  "examples",
  "patternProperties",
  "propertyNames",
  "if",
  "then",
  "else",
  "not",
  "allOf",
  "oneOf",
  "default",
]);

function sanitizeGeminiSchema(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeGeminiSchema(item));
  }
  if (value === null || typeof value !== "object") return value;

  const source = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};

  if ("const" in source && !("enum" in source)) {
    output.enum = [source.const];
  }

  for (const [key, val] of Object.entries(source)) {
    if (key === "const") continue;
    if (GEMINI_UNSUPPORTED_SCHEMA_KEYS.has(key)) continue;
    output[key] = sanitizeGeminiSchema(val);
  }
  return output;
}

function extractText(content: OpenAIMessage["content"]): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  return content
    .map((part) => (part.type === "text" ? part.text || "" : ""))
    .join("");
}

function toolCallId(callId: string, name?: string): string {
  // Code Assist matches functionResponse.name to the originating functionCall.name.
  // Keep the name stable; id is OpenAI-specific.
  return name || callId;
}

export function openaiRequestToGemini(req: OpenAIChatRequest): {
  model: string;
  request: GeminiRequest;
} {
  const contents: GeminiContent[] = [];
  let systemText = "";

  for (const msg of req.messages) {
    if (msg.role === "system") {
      systemText += (systemText ? "\n" : "") + extractText(msg.content);
      continue;
    }

    if (msg.role === "user") {
      contents.push({
        role: "user",
        parts: [{ text: extractText(msg.content) }],
      });
      continue;
    }

    if (msg.role === "assistant") {
      const parts: GeminiPart[] = [];
      const text = extractText(msg.content);
      if (text) parts.push({ text });
      if (msg.tool_calls?.length) {
        for (const call of msg.tool_calls) {
          let args: Record<string, unknown> = {};
          try {
            args = call.function.arguments
              ? JSON.parse(call.function.arguments)
              : {};
          } catch {
            args = { _raw: call.function.arguments };
          }
          parts.push({ functionCall: { name: call.function.name, args } });
        }
      }
      if (parts.length === 0) parts.push({ text: "" });
      contents.push({ role: "model", parts });
      continue;
    }

    if (msg.role === "tool") {
      const text = extractText(msg.content);
      let parsed: unknown;
      try {
        parsed = text ? JSON.parse(text) : text;
      } catch {
        parsed = text;
      }
      contents.push({
        role: "user",
        parts: [
          {
            functionResponse: {
              name: toolCallId(msg.tool_call_id || "", msg.name),
              response:
                typeof parsed === "object" && parsed !== null
                  ? (parsed as Record<string, unknown>)
                  : { output: parsed },
            },
          },
        ],
      });
    }
  }

  const request: GeminiRequest = { contents };
  if (systemText) {
    request.systemInstruction = { parts: [{ text: systemText }] };
  }
  if (req.tools?.length) {
    request.tools = [
      {
        functionDeclarations: req.tools.map((t) => ({
          name: t.function.name,
          description: t.function.description,
          parameters: t.function.parameters
            ? (sanitizeGeminiSchema(t.function.parameters) as Record<
                string,
                unknown
              >)
            : undefined,
        })),
      },
    ];
  }
  const generationConfig: Record<string, unknown> = {};
  if (typeof req.temperature === "number")
    generationConfig.temperature = req.temperature;
  if (typeof req.top_p === "number") generationConfig.topP = req.top_p;
  if (typeof req.max_tokens === "number")
    generationConfig.maxOutputTokens = req.max_tokens;
  if (Object.keys(generationConfig).length > 0) {
    request.generationConfig = generationConfig;
  }

  return { model: req.model, request };
}

interface GeminiCandidatePart {
  text?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
}

interface GeminiStreamChunk {
  response?: {
    candidates?: Array<{
      content?: { parts?: GeminiCandidatePart[]; role?: string };
      finishReason?: string;
    }>;
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      totalTokenCount?: number;
    };
  };
}

const FINISH_MAP: Record<string, string> = {
  STOP: "stop",
  MAX_TOKENS: "length",
  SAFETY: "content_filter",
  RECITATION: "content_filter",
  OTHER: "stop",
  FINISH_REASON_UNSPECIFIED: "stop",
};

/**
 * Convert a Code Assist SSE stream to an OpenAI-compatible SSE stream.
 * Each incoming line of form `data: {...}` becomes one or more
 * OpenAI-style `data: {...}` chunks with choices[0].delta fields.
 */
export function transformStream(
  upstream: ReadableStream<Uint8Array>,
  model: string
): ReadableStream<Uint8Array> {
  const id = `chatcmpl-${Date.now().toString(36)}${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  let buffer = "";
  let emittedRole = false;
  const toolCallIndex = new Map<string, number>();
  let toolCallCounter = 0;

  const baseChunk = (delta: Record<string, unknown>, finishReason?: string) => {
    const payload = {
      id,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index: 0,
          delta,
          finish_reason: finishReason ?? null,
        },
      ],
    };
    return encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
  };

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const reader = upstream.getReader();

      const pump = async (): Promise<void> => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed.startsWith("data:")) continue;
              const json = trimmed.slice(5).trim();
              if (!json || json === "[DONE]") continue;
              let chunk: GeminiStreamChunk;
              try {
                chunk = JSON.parse(json);
              } catch {
                continue;
              }
              const candidate = chunk.response?.candidates?.[0];
              if (!candidate) continue;

              if (!emittedRole) {
                controller.enqueue(baseChunk({ role: "assistant" }));
                emittedRole = true;
              }

              for (const part of candidate.content?.parts ?? []) {
                if (part.text) {
                  controller.enqueue(baseChunk({ content: part.text }));
                } else if (part.functionCall) {
                  const name = part.functionCall.name;
                  let index = toolCallIndex.get(name);
                  if (index === undefined) {
                    index = toolCallCounter++;
                    toolCallIndex.set(name, index);
                    controller.enqueue(
                      baseChunk({
                        tool_calls: [
                          {
                            index,
                            id: `call_${index}_${name}`,
                            type: "function",
                            function: { name, arguments: "" },
                          },
                        ],
                      })
                    );
                  }
                  const args = part.functionCall.args
                    ? JSON.stringify(part.functionCall.args)
                    : "";
                  controller.enqueue(
                    baseChunk({
                      tool_calls: [
                        {
                          index,
                          function: { arguments: args },
                        },
                      ],
                    })
                  );
                }
              }

              if (candidate.finishReason) {
                const mapped =
                  FINISH_MAP[candidate.finishReason] ||
                  (toolCallCounter > 0 ? "tool_calls" : "stop");
                controller.enqueue(baseChunk({}, mapped));
              }
            }
          }
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } catch (err) {
          controller.error(err);
        }
      };

      void pump();
    },
  });
}

export function geminiResponseToOpenAI(
  response: unknown,
  model: string
): Record<string, unknown> {
  const data = response as GeminiStreamChunk;
  const candidate = data.response?.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];

  let text = "";
  const toolCalls: OpenAIToolCall[] = [];
  for (const part of parts) {
    if (part.text) text += part.text;
    else if (part.functionCall) {
      toolCalls.push({
        id: `call_${toolCalls.length}_${part.functionCall.name}`,
        type: "function",
        function: {
          name: part.functionCall.name,
          arguments: JSON.stringify(part.functionCall.args ?? {}),
        },
      });
    }
  }

  const usage = data.response?.usageMetadata;

  return {
    id: `chatcmpl-${Date.now().toString(36)}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: text || null,
          ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: toolCalls.length
          ? "tool_calls"
          : FINISH_MAP[candidate?.finishReason ?? ""] || "stop",
      },
    ],
    usage: {
      prompt_tokens: usage?.promptTokenCount ?? 0,
      completion_tokens: usage?.candidatesTokenCount ?? 0,
      total_tokens: usage?.totalTokenCount ?? 0,
    },
  };
}
