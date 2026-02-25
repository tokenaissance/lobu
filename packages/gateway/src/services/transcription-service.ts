/**
 * Multi-Provider Audio Service
 *
 * Supports speech-to-text and text-to-speech via auth profiles (installed providers):
 * - OpenAI (chatgpt auth profile) - Whisper for STT, TTS API for speech
 * - Google Gemini (gemini auth profile) - Audio input/output
 * - ElevenLabs (elevenlabs auth profile) - STT and high-quality TTS
 *
 * Provider selection: first installed provider wins (openai → gemini → elevenlabs).
 * No env vars needed — TTS is a free capability of installed providers.
 */

import { createLogger } from "@lobu/core";
import type { AuthProfilesManager } from "../auth/settings/auth-profiles-manager";

const logger = createLogger("transcription-service");

export type TranscriptionProvider = "openai" | "gemini" | "elevenlabs";

interface TranscriptionConfig {
  provider: TranscriptionProvider;
  apiKey: string;
}

export interface TranscriptionSuccess {
  text: string;
  provider: TranscriptionProvider;
}

export interface TranscriptionError {
  error: string;
  availableProviders: TranscriptionProvider[];
}

export type TranscriptionResult = TranscriptionSuccess | TranscriptionError;

export interface SynthesisSuccess {
  audioBuffer: Buffer;
  mimeType: string;
  provider: TranscriptionProvider;
}

export interface SynthesisError {
  error: string;
  availableProviders: TranscriptionProvider[];
}

export type SynthesisResult = SynthesisSuccess | SynthesisError;

// Voice options for TTS
export interface VoiceOptions {
  voice?: string; // Provider-specific voice ID
  speed?: number; // Speech speed (0.5-2.0, default 1.0)
}

// Auth profile providerId → TTS provider mapping (single source of truth)
const TTS_CAPABLE_PROVIDERS: {
  profileProviderId: string;
  ttsProvider: TranscriptionProvider;
  displayName: string;
}[] = [
  {
    profileProviderId: "chatgpt",
    ttsProvider: "openai",
    displayName: "OpenAI",
  },
  {
    profileProviderId: "gemini",
    ttsProvider: "gemini",
    displayName: "Google Gemini",
  },
  {
    profileProviderId: "elevenlabs",
    ttsProvider: "elevenlabs",
    displayName: "ElevenLabs",
  },
];

function displayName(provider: TranscriptionProvider): string {
  return (
    TTS_CAPABLE_PROVIDERS.find((p) => p.ttsProvider === provider)
      ?.displayName ?? provider
  );
}

export class TranscriptionService {
  constructor(private readonly authProfilesManager: AuthProfilesManager) {}

  /**
   * Transcribe audio buffer to text
   */
  async transcribe(
    audioBuffer: Buffer,
    agentId: string,
    mimeType = "audio/ogg"
  ): Promise<TranscriptionResult> {
    const config = await this.getConfig(agentId);

    if (!config) {
      return this.noProviderError(
        "No transcription provider configured",
        agentId
      );
    }

    logger.info("Transcribing audio", {
      agentId,
      provider: config.provider,
      bufferSize: audioBuffer.length,
      mimeType,
    });

    try {
      const text = await this.transcribeWithProvider(
        audioBuffer,
        config,
        mimeType
      );
      logger.info("Transcription successful", {
        agentId,
        provider: config.provider,
        textLength: text.length,
      });
      return { text, provider: config.provider };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error("Transcription failed", {
        agentId,
        provider: config.provider,
        error: errorMessage,
      });
      return {
        error: `Transcription failed with ${displayName(config.provider)}: ${errorMessage}`,
        availableProviders: [],
      };
    }
  }

  /**
   * Get transcription config for an agent by checking installed auth profiles.
   * First TTS-capable provider with a valid profile wins (openai → gemini → elevenlabs).
   */
  async getConfig(agentId: string): Promise<TranscriptionConfig | null> {
    for (const { profileProviderId, ttsProvider } of TTS_CAPABLE_PROVIDERS) {
      const profile = await this.authProfilesManager.getBestProfile(
        agentId,
        profileProviderId
      );
      if (profile) {
        return { provider: ttsProvider, apiKey: profile.credential };
      }
    }
    return null;
  }

  /**
   * Get provider info for documentation/help messages
   */
  getProviderInfo(): Array<{ provider: TranscriptionProvider; name: string }> {
    return TTS_CAPABLE_PROVIDERS.map(({ ttsProvider, displayName }) => ({
      provider: ttsProvider,
      name: displayName,
    }));
  }

  // ==========================================================================
  // Text-to-Speech (Synthesis)
  // ==========================================================================

  /**
   * Synthesize text to audio
   */
  async synthesize(
    text: string,
    agentId: string,
    options: VoiceOptions = {}
  ): Promise<SynthesisResult> {
    const config = await this.getConfig(agentId);

    if (!config) {
      return this.noProviderError("No audio provider configured", agentId);
    }

    logger.info("Synthesizing audio", {
      agentId,
      provider: config.provider,
      textLength: text.length,
      voice: options.voice,
    });

    try {
      const result = await this.synthesizeWithProvider(text, config, options);
      logger.info("Synthesis successful", {
        agentId,
        provider: config.provider,
        audioSize: result.audioBuffer.length,
      });
      return { ...result, provider: config.provider };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error("Synthesis failed", {
        agentId,
        provider: config.provider,
        error: errorMessage,
      });
      return {
        error: `Synthesis failed with ${displayName(config.provider)}: ${errorMessage}`,
        availableProviders: [],
      };
    }
  }

  private noProviderError(message: string, agentId: string) {
    const availableProviders = TTS_CAPABLE_PROVIDERS.map((p) => p.ttsProvider);
    logger.info(message, { agentId, availableProviders });
    return { error: message, availableProviders };
  }

  // ==========================================================================
  // Provider-specific implementations - Transcription (STT)
  // ==========================================================================

  private async transcribeWithProvider(
    buffer: Buffer,
    config: TranscriptionConfig,
    mimeType: string
  ): Promise<string> {
    switch (config.provider) {
      case "openai":
        return this.transcribeWithOpenAI(buffer, config.apiKey, mimeType);
      case "gemini":
        return this.transcribeWithGemini(buffer, config.apiKey, mimeType);
      case "elevenlabs":
        return this.transcribeWithElevenLabs(buffer, config.apiKey, mimeType);
      default:
        throw new Error(`Unknown provider: ${config.provider}`);
    }
  }

  private async transcribeWithOpenAI(
    buffer: Buffer,
    apiKey: string,
    mimeType: string
  ): Promise<string> {
    const formData = new FormData();
    const ext = this.getExtensionFromMime(mimeType);
    formData.append(
      "file",
      new Blob([buffer], { type: mimeType }),
      `audio.${ext}`
    );
    formData.append("model", "whisper-1");

    const resp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    });

    if (!resp.ok) {
      const error = await resp.text();
      throw new Error(`OpenAI API error: ${resp.status} - ${error}`);
    }

    const data = (await resp.json()) as { text: string };
    return data.text;
  }

  private async transcribeWithGemini(
    buffer: Buffer,
    apiKey: string,
    mimeType: string
  ): Promise<string> {
    // Gemini uses inline audio data with base64 encoding
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: "Transcribe this audio exactly as spoken. Return only the transcription text, nothing else:",
                },
                {
                  inline_data: {
                    mime_type: mimeType,
                    data: buffer.toString("base64"),
                  },
                },
              ],
            },
          ],
        }),
      }
    );

    if (!resp.ok) {
      const error = await resp.text();
      throw new Error(`Gemini API error: ${resp.status} - ${error}`);
    }

    const data = (await resp.json()) as {
      candidates: Array<{
        content: { parts: Array<{ text: string }> };
      }>;
    };
    return data.candidates[0]?.content?.parts[0]?.text || "";
  }

  private async transcribeWithElevenLabs(
    buffer: Buffer,
    apiKey: string,
    mimeType: string
  ): Promise<string> {
    // ElevenLabs speech-to-text API
    const formData = new FormData();
    const ext = this.getExtensionFromMime(mimeType);
    formData.append(
      "audio",
      new Blob([buffer], { type: mimeType }),
      `audio.${ext}`
    );

    const resp = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST",
      headers: { "xi-api-key": apiKey },
      body: formData,
    });

    if (!resp.ok) {
      const error = await resp.text();
      throw new Error(`ElevenLabs API error: ${resp.status} - ${error}`);
    }

    const data = (await resp.json()) as { text: string };
    return data.text;
  }

  // ==========================================================================
  // Provider-specific implementations - Synthesis (TTS)
  // ==========================================================================

  private async synthesizeWithProvider(
    text: string,
    config: TranscriptionConfig,
    options: VoiceOptions
  ): Promise<{ audioBuffer: Buffer; mimeType: string }> {
    switch (config.provider) {
      case "openai":
        return this.synthesizeWithOpenAI(text, config.apiKey, options);
      case "gemini":
        return this.synthesizeWithGemini(text, config.apiKey);
      case "elevenlabs":
        return this.synthesizeWithElevenLabs(text, config.apiKey, options);
      default:
        throw new Error(`Unknown provider: ${config.provider}`);
    }
  }

  private async synthesizeWithOpenAI(
    text: string,
    apiKey: string,
    options: VoiceOptions
  ): Promise<{ audioBuffer: Buffer; mimeType: string }> {
    // OpenAI TTS API
    // Voices: alloy, echo, fable, onyx, nova, shimmer
    const voice = options.voice || "alloy";
    const speed = options.speed || 1.0;

    const resp = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "tts-1",
        input: text,
        voice,
        speed,
        response_format: "opus", // Good for WhatsApp
      }),
    });

    if (!resp.ok) {
      const error = await resp.text();
      throw new Error(`OpenAI TTS API error: ${resp.status} - ${error}`);
    }

    const arrayBuffer = await resp.arrayBuffer();
    return {
      audioBuffer: Buffer.from(arrayBuffer),
      mimeType: "audio/opus",
    };
  }

  private async synthesizeWithGemini(
    text: string,
    apiKey: string
  ): Promise<{ audioBuffer: Buffer; mimeType: string }> {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: `Please speak this text aloud: "${text}"` }],
            },
          ],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: "Aoede", // Default Gemini voice
                },
              },
            },
          },
        }),
      }
    );

    if (!resp.ok) {
      const error = await resp.text();
      throw new Error(`Gemini TTS API error: ${resp.status} - ${error}`);
    }

    const data = (await resp.json()) as {
      candidates: Array<{
        content: {
          parts: Array<{
            inlineData?: { mimeType: string; data: string };
          }>;
        };
      }>;
    };

    const audioPart = data.candidates[0]?.content?.parts?.find((p) =>
      p.inlineData?.mimeType?.startsWith("audio/")
    );

    if (!audioPart?.inlineData) {
      throw new Error("Gemini did not return audio data");
    }

    return {
      audioBuffer: Buffer.from(audioPart.inlineData.data, "base64"),
      mimeType: audioPart.inlineData.mimeType,
    };
  }

  private async synthesizeWithElevenLabs(
    text: string,
    apiKey: string,
    options: VoiceOptions
  ): Promise<{ audioBuffer: Buffer; mimeType: string }> {
    // ElevenLabs TTS API
    // Default voice: Rachel (21m00Tcm4TlvDq8ikWAM)
    const voiceId = options.voice || "21m00Tcm4TlvDq8ikWAM";

    const resp = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_monolingual_v1",
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.5,
          },
        }),
      }
    );

    if (!resp.ok) {
      const error = await resp.text();
      throw new Error(`ElevenLabs TTS API error: ${resp.status} - ${error}`);
    }

    const arrayBuffer = await resp.arrayBuffer();
    return {
      audioBuffer: Buffer.from(arrayBuffer),
      mimeType: "audio/mpeg",
    };
  }

  // ==========================================================================
  // Utility methods
  // ==========================================================================

  private getExtensionFromMime(mimeType: string): string {
    const mimeToExt: Record<string, string> = {
      "audio/ogg": "ogg",
      "audio/opus": "opus",
      "audio/mpeg": "mp3",
      "audio/mp3": "mp3",
      "audio/wav": "wav",
      "audio/webm": "webm",
      "audio/m4a": "m4a",
      "audio/mp4": "m4a",
    };
    return mimeToExt[mimeType] || "ogg";
  }
}
