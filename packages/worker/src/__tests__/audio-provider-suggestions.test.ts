import { afterEach, describe, expect, mock, test } from "bun:test";
import { OpenClawWorker } from "../openclaw/worker";
import {
  fetchAudioProviderSuggestions,
  normalizeAudioProviderSuggestions,
} from "../shared/audio-provider-suggestions";
import { generateAudio } from "../shared/tool-implementations";

const originalFetch = globalThis.fetch;

function extractText(result: {
  content: Array<{ type: "text"; text: string }>;
}): string {
  return result.content[0]?.text || "";
}

function extractConnectServiceHint(text: string): string | null {
  const match = text.match(/ConnectService\s*\(e\.g\.\s*id='([^']+)'\)/);
  return match?.[1] ?? null;
}

describe("audio provider suggestions", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    mock.restore();
  });

  test("normalizes gateway capability providers into prefill IDs + display list", () => {
    const normalized = normalizeAudioProviderSuggestions({
      available: false,
      providers: [
        { provider: "openai", name: "OpenAI" },
        { provider: "gemini", name: "Google Gemini" },
      ],
    });

    expect(normalized.available).toBe(false);
    expect(normalized.usedFallback).toBe(false);
    expect(normalized.providerIds).toEqual(["chatgpt", "openai", "gemini"]);
    expect(normalized.providerDisplayList).toBe("OpenAI, Google Gemini");
  });

  test("falls back safely when capability payload is malformed", () => {
    const normalized = normalizeAudioProviderSuggestions({
      available: true,
      providers: [{ unexpected: "value" }],
    });

    expect(normalized.available).toBe(true);
    expect(normalized.usedFallback).toBe(true);
    expect(normalized.providerIds).toEqual(["chatgpt", "gemini", "elevenlabs"]);
    expect(normalized.providerDisplayList).toBe("");
  });

  test("falls back safely when capability fetch fails", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;

    const normalized = await fetchAudioProviderSuggestions({
      gatewayUrl: "http://gateway",
      workerToken: "token",
    });

    expect(normalized.available).toBeNull();
    expect(normalized.usedFallback).toBe(true);
    expect(normalized.providerIds).toEqual(["chatgpt", "gemini", "elevenlabs"]);
    expect(normalized.providerDisplayList).toBe("");
  });
});

describe("GenerateAudio dynamic provider messaging", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    mock.restore();
  });

  test("uses dynamic capability providers in missing-scope guidance and ConnectService hint", async () => {
    const fetchMock = mock(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url.endsWith("/internal/audio/capabilities")) {
          return new Response(
            JSON.stringify({
              available: true,
              providers: [
                { provider: "openai", name: "OpenAI" },
                { provider: "gemini", name: "Google Gemini" },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }

        if (url.endsWith("/internal/audio/synthesize")) {
          expect(init?.method).toBe("POST");
          return new Response(
            JSON.stringify({
              error: "missing_scope: api.model.audio.request",
            }),
            { status: 400, headers: { "Content-Type": "application/json" } }
          );
        }

        throw new Error(`Unexpected URL: ${url}`);
      }
    );

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await generateAudio(
      {
        gatewayUrl: "http://gateway",
        workerToken: "token",
        channelId: "ch",
        conversationId: "conv",
        platform: "telegram",
      },
      { text: "hello world" }
    );

    const text = extractText(result as any);
    const hintProvider = extractConnectServiceHint(text);

    expect(text).toContain("OpenAI, Google Gemini");
    expect(text).toContain("ConnectService");
    expect(hintProvider).toBe("chatgpt");
  });
});

describe("OpenClawWorker audio permission hint", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    mock.restore();
  });

  test("uses dynamic providers when creating settings-link payload", async () => {
    let settingsLinkBody: Record<string, unknown> | null = null;

    const fetchMock = mock(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/internal/audio/capabilities")) {
          return new Response(
            JSON.stringify({
              available: true,
              providers: [
                { provider: "openai", name: "OpenAI" },
                { provider: "elevenlabs", name: "ElevenLabs" },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        if (url.endsWith("/internal/settings-link")) {
          settingsLinkBody = JSON.parse(String(init?.body || "{}")) as Record<
            string,
            unknown
          >;
          return new Response(JSON.stringify({ type: "settings_link" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        throw new Error(`Unexpected URL: ${url}`);
      }
    );

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const hint = await (
      OpenClawWorker.prototype as any
    ).maybeBuildAudioPermissionHintMessage(
      "Audio generation failed because token lacks api.model.audio.request",
      "http://gateway",
      "token"
    );

    expect(hint).toContain("OpenAI, ElevenLabs");
    expect(settingsLinkBody?.providers).toEqual([
      "chatgpt",
      "openai",
      "elevenlabs",
    ]);
  });

  test("falls back to generic provider suggestions when capabilities lookup fails", async () => {
    let callCount = 0;
    let settingsLinkBody: Record<string, unknown> | null = null;

    const fetchMock = mock(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        callCount += 1;
        if (callCount === 1) {
          throw new Error("capabilities unavailable");
        }
        settingsLinkBody = JSON.parse(String(init?.body || "{}")) as Record<
          string,
          unknown
        >;
        return new Response(JSON.stringify({ type: "settings_link" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
    );

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const hint = await (
      OpenClawWorker.prototype as any
    ).maybeBuildAudioPermissionHintMessage(
      "api.model.audio.request is missing",
      "http://gateway",
      "token"
    );

    expect(hint).toContain("audio-capable provider");
    expect(settingsLinkBody?.providers).toEqual([
      "chatgpt",
      "gemini",
      "elevenlabs",
    ]);
  });
});
