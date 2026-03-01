/**
 * Model resolution and session management helpers.
 * Extracted from worker.ts for clarity.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createLogger } from "@lobu/core";
import { SessionManager } from "@mariozechner/pi-coding-agent";

const logger = createLogger("model-resolver");

/** Hardcoded fallback map for provider base URL env vars. */
export const DEFAULT_PROVIDER_BASE_URL_ENV: Record<string, string> = {
  anthropic: "ANTHROPIC_BASE_URL",
  openai: "OPENAI_BASE_URL",
  "openai-codex": "OPENAI_BASE_URL",
  google: "GEMINI_API_BASE_URL",
  nvidia: "NVIDIA_API_BASE_URL",
  "z-ai": "Z_AI_API_BASE_URL",
};

/** Default model IDs per provider, used when no explicit model is configured. */
export const DEFAULT_PROVIDER_MODELS: Record<string, string> = {
  anthropic: "claude-sonnet-4-20250514",
  openai: "gpt-4.1",
  "openai-codex": "gpt-5.1-codex-mini",
  google: "gemini-2.5-pro",
  "z-ai": "glm-4.7",
};

/**
 * Map gateway provider slugs to model-registry provider names.
 * The gateway uses slugs like "z-ai" while the model registry uses "zai".
 */
export const PROVIDER_REGISTRY_ALIASES: Record<string, string> = {
  "z-ai": "zai",
};

export function resolveModelRef(rawModelRef: string): {
  provider: string;
  modelId: string;
} {
  const defaultModelRef = process.env.AGENT_DEFAULT_MODEL || "";
  const defaultProvider = process.env.AGENT_DEFAULT_PROVIDER || "";

  const normalizedRaw = rawModelRef?.trim();
  let modelRef = normalizedRaw || defaultModelRef;

  // When no model is configured but a provider is known, use the provider's
  // default model so auto-mode provider selection works end-to-end.
  if (!modelRef && defaultProvider) {
    const fallbackModel = DEFAULT_PROVIDER_MODELS[defaultProvider];
    if (fallbackModel) {
      logger.info(
        `No model configured, using default for ${defaultProvider}: ${fallbackModel}`
      );
      modelRef = fallbackModel;
    }
  }

  if (!modelRef) {
    throw new Error(
      "No model configured. Please add a model provider in your settings."
    );
  }

  const parts = modelRef.split("/").filter(Boolean);
  if (parts.length >= 2) {
    const provider = parts[0]!;
    let modelId = parts.slice(1).join("/");
    // Resolve "auto" to the provider's default model
    if (modelId === "auto") {
      const fallback = DEFAULT_PROVIDER_MODELS[provider];
      if (fallback) {
        logger.info(`Resolved auto model for ${provider}: ${fallback}`);
        modelId = fallback;
      }
    }
    return { provider, modelId };
  }

  if (!defaultProvider) {
    throw new Error(
      `No provider specified for model "${modelRef}". Use "provider/model" format or set AGENT_DEFAULT_PROVIDER.`
    );
  }

  return { provider: defaultProvider, modelId: modelRef };
}

export async function openOrCreateSessionManager(
  sessionFile: string,
  workspaceDir: string
): Promise<SessionManager> {
  try {
    await fs.stat(sessionFile);
    return SessionManager.open(sessionFile);
  } catch {
    const sessionManager = SessionManager.create(
      workspaceDir,
      path.dirname(sessionFile)
    );
    sessionManager.setSessionFile(sessionFile);
    return sessionManager;
  }
}
