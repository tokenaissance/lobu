import Anthropic from "@anthropic-ai/sdk";
import type { JudgeClient, JudgeVerdict } from "./types";

/**
 * Anthropic-backed judge transport. Calls the Messages API and parses the
 * strict JSON verdict. Any parse failure becomes a thrown error so the
 * caller can record it as a circuit-breaker failure.
 *
 * API key comes from `ANTHROPIC_API_KEY`. The judge is a gateway-level
 * dependency — it does NOT use any agent's own API key, to avoid leaking
 * agent context into audit logs or bills.
 */
export class AnthropicJudgeClient implements JudgeClient {
  private readonly client: Anthropic;
  private readonly timeoutMs: number;

  constructor(options?: { apiKey?: string; timeoutMs?: number }) {
    const apiKey = options?.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        "Egress judge requires ANTHROPIC_API_KEY — set it in the gateway environment or pass apiKey explicitly"
      );
    }
    this.client = new Anthropic({ apiKey });
    this.timeoutMs = options?.timeoutMs ?? 5000;
  }

  async judge(args: {
    model: string;
    systemPrompt: string;
    userPrompt: string;
  }): Promise<JudgeVerdict> {
    const response = await this.client.messages.create(
      {
        model: args.model,
        max_tokens: 256,
        system: args.systemPrompt,
        messages: [{ role: "user", content: args.userPrompt }],
      },
      { timeout: this.timeoutMs }
    );

    const textBlock = response.content.find((block) => block.type === "text");
    if (!textBlock || textBlock.type !== "text" || !textBlock.text) {
      throw new Error("Judge response contained no text");
    }
    return parseVerdict(textBlock.text);
  }
}

/**
 * Parse a strict `{ verdict, reason }` JSON response. Tolerates leading or
 * trailing whitespace, a JSON-in-markdown code fence, and trailing commas
 * from underscored models — but does not try to extract JSON from prose.
 * Invalid shape throws.
 */
export function parseVerdict(raw: string): JudgeVerdict {
  const cleaned = stripCodeFence(raw.trim());
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(
      `Judge response was not valid JSON: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Judge response was not a JSON object");
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.verdict !== "allow" && obj.verdict !== "deny") {
    throw new Error(
      `Judge verdict must be "allow" or "deny", got: ${JSON.stringify(obj.verdict)}`
    );
  }
  const reason = typeof obj.reason === "string" ? obj.reason.trim() : "";
  return { verdict: obj.verdict, reason: reason || "(no reason given)" };
}

function stripCodeFence(text: string): string {
  // ```json ... ``` or ``` ... ```
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced?.[1] ? fenced[1].trim() : text;
}
