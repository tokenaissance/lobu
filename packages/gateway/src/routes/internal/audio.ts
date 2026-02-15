/**
 * Internal Audio Routes
 *
 * Worker-facing endpoints for audio generation (TTS).
 * Used by the GenerateAudio custom MCP tool.
 */

import { createLogger, verifyWorkerToken } from "@lobu/core";
import { Hono } from "hono";
import type { TranscriptionService } from "../../services/transcription-service";

const logger = createLogger("internal-audio-routes");

type WorkerContext = {
  Variables: {
    worker: {
      userId: string;
      threadId: string;
      channelId: string;
      teamId?: string;
      agentId?: string;
      deploymentName: string;
      platform?: string;
    };
  };
};

/**
 * Create internal audio routes (Hono)
 */
export function createAudioRoutes(
  transcriptionService: TranscriptionService
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
   * Generate audio from text (TTS)
   * POST /internal/audio/synthesize
   *
   * Body: {
   *   text: string (required) - Text to convert to speech
   *   voice?: string - Provider-specific voice ID
   *   speed?: number - Speech speed (0.5-2.0)
   * }
   *
   * Response: Audio file (binary) with Content-Type header
   */
  router.post("/internal/audio/synthesize", authenticateWorker, async (c) => {
    try {
      const worker = c.get("worker");
      const { text, voice, speed } = await c.req.json();

      if (!text || typeof text !== "string") {
        return c.json({ error: "text is required and must be a string" }, 400);
      }

      if (text.length > 4096) {
        return c.json({ error: "text must be 4096 characters or less" }, 400);
      }

      const agentId = worker.agentId;
      if (!agentId) {
        return c.json({ error: "Missing agentId in worker context" }, 400);
      }

      logger.info("Synthesizing audio", {
        agentId,
        textLength: text.length,
        voice,
      });

      const result = await transcriptionService.synthesize(text, agentId, {
        voice,
        speed,
      });

      if ("error" in result) {
        logger.warn("Audio synthesis failed", { error: result.error });
        return c.json(
          {
            error: result.error,
            availableProviders: result.availableProviders,
          },
          400
        );
      }

      // Return audio as binary response
      return new Response(result.audioBuffer, {
        headers: {
          "Content-Type": result.mimeType,
          "Content-Length": result.audioBuffer.length.toString(),
          "X-Audio-Provider": result.provider,
        },
      });
    } catch (error) {
      logger.error("Audio synthesis error", { error });
      return c.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Failed to synthesize audio",
        },
        500
      );
    }
  });

  /**
   * Check audio capabilities for current agent
   * GET /internal/audio/capabilities
   *
   * Response: {
   *   available: boolean,
   *   provider?: string,
   *   features: { transcription: boolean, synthesis: boolean }
   * }
   */
  router.get("/internal/audio/capabilities", authenticateWorker, async (c) => {
    try {
      const worker = c.get("worker");
      const agentId = worker.agentId;

      if (!agentId) {
        return c.json({ error: "Missing agentId in worker context" }, 400);
      }

      const config = await transcriptionService.getConfig(agentId);

      if (!config) {
        return c.json({
          available: false,
          features: { transcription: false, synthesis: false },
          providers: transcriptionService.getProviderInfo(),
        });
      }

      return c.json({
        available: true,
        provider: config.provider,
        features: { transcription: true, synthesis: true },
      });
    } catch (error) {
      logger.error("Capabilities check error", { error });
      return c.json({ error: "Failed to check capabilities" }, 500);
    }
  });

  logger.info("Internal audio routes registered");

  return router;
}
