import type { PcmAudioChunk } from "../types/audio";

const DEFAULT_BACKEND_URL = "http://127.0.0.1:8765";
const DEFAULT_TIMEOUT_MS = 4000;
const DEFAULT_FINALIZE_TIMEOUT_MS = 200000;
const configuredBackendUrl = (import.meta.env as { readonly VITE_BACKEND_URL?: string })
  .VITE_BACKEND_URL;

export type AudioBackendErrorCode = "unavailable" | "timeout" | "validation" | "cancelled";

export class AudioBackendError extends Error {
  readonly code: AudioBackendErrorCode;
  readonly status?: number;

  constructor(code: AudioBackendErrorCode, message: string, status?: number) {
    super(message);
    this.name = "AudioBackendError";
    this.code = code;
    this.status = status;
  }
}

export interface AudioChunkAcknowledgement {
  received_bytes: number;
  sequence: number;
  session_id: string;
  status: "recording";
}

export interface SpeechSessionStart {
  sessionId: string;
  status: "recording";
  audioFormat: {
    encoding: "pcm_s16le";
    sampleRate: 16000;
    channels: 1;
  };
}

export interface AlignedTranscriptSegment {
  utterance_id: string;
  speaker: string;
  text: string;
  start: number;
  end: number;
}

export interface SpeechSessionResult {
  sessionId: string;
  status: "completed" | "completed_with_errors";
  transcript: {
    session_id: string;
    segments: AlignedTranscriptSegment[];
  };
  errors: UtteranceError[];
}

export interface UtteranceError {
  utteranceId: string;
  message: string;
}

export interface SpeechSessionProgress {
  sessionId: string;
  status: "recording" | "processing" | "completed" | "completed_with_errors";
  transcript: SpeechSessionResult["transcript"];
  pendingUtterances: number;
  errors: UtteranceError[];
}

interface AudioBackendClientOptions {
  baseUrl?: string;
  fetchImplementation?: typeof fetch;
  timeoutMs?: number;
}

export class AudioBackendClient {
  private readonly baseUrl: string;
  private readonly fetchImplementation: typeof fetch;
  private readonly timeoutMs: number;

  constructor({
    baseUrl = configuredBackendUrl || DEFAULT_BACKEND_URL,
    fetchImplementation = fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  }: AudioBackendClientOptions = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.fetchImplementation = fetchImplementation;
    this.timeoutMs = timeoutMs;
  }

  async startSession(externalSignal?: AbortSignal): Promise<SpeechSessionStart> {
    return this.requestJson<SpeechSessionStart>("/api/sessions/start", "POST", externalSignal);
  }

  async finishSession(
    sessionId: string,
    externalSignal?: AbortSignal,
  ): Promise<SpeechSessionResult> {
    return this.requestJson<SpeechSessionResult>(
      `/api/sessions/${encodeURIComponent(sessionId)}/finish`,
      "POST",
      externalSignal,
      DEFAULT_FINALIZE_TIMEOUT_MS,
    );
  }

  async getSessionTranscript(
    sessionId: string,
    externalSignal?: AbortSignal,
  ): Promise<SpeechSessionProgress> {
    return this.requestJson<SpeechSessionProgress>(
      `/api/sessions/${encodeURIComponent(sessionId)}/transcript`,
      "GET",
      externalSignal,
    );
  }

  async sendChunk(
    chunk: PcmAudioChunk,
    sessionId: string,
    externalSignal?: AbortSignal,
  ): Promise<AudioChunkAcknowledgement> {
    const requestController = new AbortController();
    let timedOut = false;
    const handleExternalAbort = () => requestController.abort();
    externalSignal?.addEventListener("abort", handleExternalAbort, { once: true });
    const timeout = globalThis.setTimeout(() => {
      timedOut = true;
      requestController.abort();
    }, this.timeoutMs);

    const bytes = new Uint8Array(chunk.data.byteLength);
    bytes.set(new Uint8Array(chunk.data.buffer, chunk.data.byteOffset, chunk.data.byteLength));

    try {
      const response = await this.fetchImplementation(`${this.baseUrl}/api/audio/chunks`, {
        body: bytes,
        headers: {
          "Content-Type": "application/octet-stream",
          "X-Noto-Channels": "1",
          "X-Noto-Sample-Rate": String(chunk.sampleRate),
          "X-Noto-Sequence": String(chunk.sequence),
          "X-Noto-Session-Id": sessionId,
        },
        method: "POST",
        signal: requestController.signal,
      });

      if (!response.ok) {
        throw new AudioBackendError(
          "validation",
          await readErrorMessage(response),
          response.status,
        );
      }
      return (await response.json()) as AudioChunkAcknowledgement;
    } catch (error) {
      if (error instanceof AudioBackendError) throw error;
      if (timedOut) {
        throw new AudioBackendError("timeout", "The local audio backend did not respond in time.");
      }
      if (externalSignal?.aborted) {
        throw new AudioBackendError("cancelled", "The audio request was cancelled.");
      }
      throw new AudioBackendError(
        "unavailable",
        "The local audio backend is unavailable. Recording continues locally.",
      );
    } finally {
      globalThis.clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", handleExternalAbort);
    }
  }

  private async requestJson<T>(
    path: string,
    method: "GET" | "POST",
    externalSignal?: AbortSignal,
    timeoutMs = this.timeoutMs,
  ): Promise<T> {
    const requestController = new AbortController();
    let timedOut = false;
    const handleExternalAbort = () => requestController.abort();
    externalSignal?.addEventListener("abort", handleExternalAbort, { once: true });
    const timeout = globalThis.setTimeout(() => {
      timedOut = true;
      requestController.abort();
    }, timeoutMs);
    try {
      const response = await this.fetchImplementation(`${this.baseUrl}${path}`, {
        method,
        signal: requestController.signal,
      });
      if (!response.ok) {
        throw new AudioBackendError(
          "validation",
          await readErrorMessage(response),
          response.status,
        );
      }
      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof AudioBackendError) throw error;
      if (timedOut) {
        throw new AudioBackendError("timeout", "The local audio backend did not respond in time.");
      }
      if (externalSignal?.aborted) {
        throw new AudioBackendError("cancelled", "The audio request was cancelled.");
      }
      throw new AudioBackendError("unavailable", "The local audio backend is unavailable.");
    } finally {
      globalThis.clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", handleExternalAbort);
    }
  }
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { detail?: unknown };
    if (typeof payload.detail === "string") return payload.detail;
    if (
      payload.detail &&
      typeof payload.detail === "object" &&
      "message" in payload.detail &&
      typeof payload.detail.message === "string"
    ) {
      return payload.detail.message;
    }
  } catch {
    // A validation response is not required to contain JSON.
  }
  return `The local backend rejected the audio chunk (HTTP ${response.status}).`;
}
